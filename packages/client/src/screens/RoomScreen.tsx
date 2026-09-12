/**
 * 房间页：从这里进联机对局（迁移第 27 条后半）。
 *
 * 三条路都通到同一个地方（协议的 `lobby:room`）：排队匹配、开一个私人房、按四位码进房。
 * 拿到房间码之后**自己断开大厅**，另开一条连接连房间对象（见 net/lobbyClient.ts）。
 *
 * ```
 *   idle ──匹配/开房/加入──▶ busy ──lobby:room──▶ room ──双方 ready──▶ /match
 *     ▲                       │                    │
 *     └───────取消 / 报错──────┴────离开 / 房间收摊──┘
 * ```
 *
 * 画面整页在画布上（`RoomStage` → canvas 的 scenes/room），这一层只管流程。
 * 唯一的例外是「加入」那个四位码输入框——文字输入必须是真的 `<input>`
 *（见 ui 的 CodeInput.tsx），所以它盖在画布上面。
 *
 * **不做选牌选英雄**：牌组和英雄直接读存档（save/loadout.ts），那两页是第 28、30 条的事。
 */

import type { RoomAction } from '@ai-duel/canvas'
import { type LobbyRoomOrigin, type RoomCode, roomCodeSchema } from '@ai-duel/protocol'
import { CodeInput, Dialog } from '@ai-duel/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { useMatchSession } from '../app/MatchSession'
import { usePlatform } from '../app/platform'
import { playTrack } from '../audio/music'
import { useAuthSession, useSession } from '../auth/useSession'
import type { ServerDriver } from '../match/serverDriver'
import { createServerDriver } from '../match/serverDriver'
import { useOptionalMatch } from '../match/useMatch'
import { lobbyUrl } from '../net/endpoints'
import { createLobbyClient, LobbyError } from '../net/lobbyClient'
import { currentDeck, currentHero } from '../save/loadout'
import { RoomStage } from './RoomStage'
import { type RoomFlow, roomViewOf } from './roomView'
import './roomScreen.css'

const IDLE: RoomFlow = { kind: 'idle' }

/**
 * 这一页手上还开着的东西。存 ref 而不是 state：卸载时的清理函数要读**最新**那一份，
 * 而清理函数是挂载那一拍建的，闭包里的 state 永远停在第一拍。
 */
interface OpenHandles {
  lobby: ReturnType<typeof createLobbyClient> | null
  driver: ServerDriver | null
  /** driver 已经交给 MatchSession 了，这一页不再负责拆它。 */
  handedOff: boolean
}

export function RoomScreen() {
  const platform = usePlatform()
  const auth = useAuthSession()
  const account = useSession()
  const { start } = useMatchSession()
  const [, navigate] = useLocation()

  const [flow, setFlow] = useState<RoomFlow>(IDLE)
  const [driver, setDriver] = useState<ServerDriver | null>(null)
  const [mineReady, setMineReady] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [codeText, setCodeText] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)

  const open = useRef<OpenHandles>({ lobby: null, driver: null, handedOff: false })
  /** 对方在这一次房间里出现过没有。分得开「还没来」和「掉线了」（见 roomView.ts）。 */
  const peerSeen = useRef(false)
  /** 已经报过牌组的那个 driver。服务端不收第二条 `room:loadout`（回 `already-loaded`）。 */
  const loaded = useRef<ServerDriver | null>(null)

  const match = useOptionalMatch(driver)

  // 房间页的曲子。回首页或进对局时由那边换掉，所以这里不用在卸载时停。
  useEffect(() => {
    playTrack(platform, 'room')
  }, [platform])

  /** 收掉手上的连接。`leave` 为 true 时先告诉服务端「我不打了」，房间会当场收摊。 */
  const closeAll = useCallback((leave: boolean) => {
    const handles = open.current
    handles.lobby?.close()
    handles.lobby = null
    if (handles.driver !== null && !handles.handedOff) {
      if (leave) handles.driver.leave()
      handles.driver.dispose()
    }
    handles.driver = null
  }, [])

  // 离开这一页（回首页、刷新前的卸载）时把连接收掉，别在后台挂着一条占着座位的连接。
  useEffect(() => () => closeAll(true), [closeAll])

  /** 拿到房间码之后：开一条房间连接，界面进入 `room`。 */
  const openRoom = useCallback(
    (code: RoomCode) => {
      const next = createServerDriver({
        platform,
        tokenProvider: () => auth.token(),
        code,
      })
      open.current.driver = next
      open.current.handedOff = false
      peerSeen.current = false
      setMineReady(false)
      setDriver(next)
      setFlow({ kind: 'room', code })
    },
    [platform, auth],
  )

  /**
   * 走一趟大厅。三条路只有中间那一句不同，答复都是同一条 `lobby:room`。
   *
   * 每一步都要核对「手上这条大厅连接还是我刚开的那条吗」：await 期间玩家可能已经点了取消、
   * 或者离开了这一页，那时候再去开房间连接就成了一条谁也管不着的野连接。
   */
  const enter = useCallback(
    async (origin: LobbyRoomOrigin, code?: RoomCode) => {
      closeAll(true)
      setNotice(null)
      setDriver(null)
      setFlow({ kind: 'busy', origin })
      const lobby = createLobbyClient({
        network: platform.network,
        url: () => lobbyUrl(window.location.origin),
        token: () => auth.token(),
      })
      open.current.lobby = lobby
      try {
        const got = await requestRoom(lobby, origin, code)
        if (open.current.lobby !== lobby) return
        open.current.lobby = null
        openRoom(got)
      } catch (cause: unknown) {
        if (open.current.lobby !== lobby) return
        open.current.lobby = null
        setFlow(IDLE)
        setNotice(noticeOf(cause))
      }
    },
    [platform, auth, closeAll, openRoom],
  )

  /** 取消正在等的那次请求。 */
  const cancel = useCallback(() => {
    /*
     * 只是把大厅连接关掉，不发 `lobby:cancel`：服务端在连接断掉的那一刻就把人移出队列
     *（server 的 `handleDisconnect`），而我们本来就不打算留在大厅里。
     * 发一条再关反而要赌那一帧来不来得及出去。
     */
    closeAll(false)
    setFlow(IDLE)
    setNotice(null)
  }, [closeAll])

  /** 离开房间，回到这一页的起点（不是回首页——玩家多半是想换一局）。 */
  const leave = useCallback(() => {
    closeAll(true)
    setDriver(null)
    setFlow(IDLE)
    setMineReady(false)
    setNotice(null)
  }, [closeAll])

  // 座位到手就把牌组和英雄报上去。一个 driver 只报一次（服务端不收第二条）。
  useEffect(() => {
    if (driver === null || match.seat === null || loaded.current === driver) return
    loaded.current = driver
    driver.loadout(currentDeck(platform), currentHero(platform))
  }, [driver, match.seat, platform])

  // 对方露过一次面之后，再看到 `online: false` 就是掉线而不是「还没来」。
  useEffect(() => {
    if (match.peer?.online === true) peerSeen.current = true
  }, [match.peer])

  /*
   * 服务端开局了（`match:started` 把 status 推到 playing），把 driver 交给
   * `MatchSession` 再跳 `/match`——交接之后这一页就不再负责拆它了（见 app/MatchSession.tsx）。
   */
  useEffect(() => {
    if (driver === null || match.status !== 'playing') return
    open.current.handedOff = true
    start(driver, 'online')
    navigate('/match')
  }, [driver, match.status, start, navigate])

  // 房间收摊（对方走了、超时、进不去）：连接已经由 driver 自己关掉了，这里只要回到起点。
  useEffect(() => {
    if (driver === null || match.status !== 'aborted') return
    const reason = match.abortReason
    open.current.driver = null
    driver.dispose()
    setDriver(null)
    setFlow(IDLE)
    setMineReady(false)
    setNotice(reason === null || reason.length === 0 ? '房间关了' : reason)
  }, [driver, match.status, match.abortReason])

  const act = (action: RoomAction): void => {
    switch (action.kind) {
      case 'match':
        void enter('queue')
        break
      case 'create':
        void enter('create')
        break
      case 'join':
        setCodeText('')
        setCodeError(null)
        setJoining(true)
        break
      case 'ready':
        open.current.driver?.ready()
        setMineReady(true)
        break
      case 'cancel':
        cancel()
        break
      case 'leave':
        leave()
        break
    }
  }

  const confirmJoin = (): void => {
    const parsed = roomCodeSchema.safeParse(codeText)
    if (!parsed.success) {
      setCodeError('房间码是四位数字')
      return
    }
    setJoining(false)
    void enter('join', parsed.data)
  }

  const view = roomViewOf({
    account: account.name,
    flow,
    match: flow.kind === 'room' ? match : null,
    mineReady,
    peerSeen: peerSeen.current,
    // 账号开不出来时那句错也走提示这一条路：玩家再点一次「匹配」就会重试一遍登录。
    notice: notice ?? account.error,
  })

  return (
    <main className="room">
      <RoomStage view={view} platform={platform} onAction={act} />
      <Dialog
        open={joining}
        title="加入房间"
        confirm={{ label: '进去', onSelect: confirmJoin }}
        cancel={{ label: '算了', onSelect: () => setJoining(false) }}
        onDismiss={() => setJoining(false)}
      >
        <CodeInput
          label="房间码"
          value={codeText}
          error={codeError}
          autoFocus
          onChange={(next) => {
            setCodeText(next)
            setCodeError(null)
          }}
          onSubmit={confirmJoin}
        />
      </Dialog>
    </main>
  )
}

/** 三条路各发各的那一句。答复都是同一条 `lobby:room`，所以返回类型一样。 */
function requestRoom(
  lobby: ReturnType<typeof createLobbyClient>,
  origin: LobbyRoomOrigin,
  code: RoomCode | undefined,
): Promise<RoomCode> {
  switch (origin) {
    case 'queue':
      return lobby.joinQueue()
    case 'create':
      return lobby.createRoom()
    case 'join':
      // 走到这儿 code 必然有值：只有下面那个弹窗校验过四位数字之后才会派 `'join'`。
      return lobby.joinRoom(code ?? '')
  }
}

/** 把大厅抛出来的东西变成一句能显示的中文。`LobbyError` 自带的那句已经是中文了。 */
function noticeOf(cause: unknown): string {
  if (cause instanceof LobbyError) return cause.message
  return cause instanceof Error ? cause.message : String(cause)
}
