/**
 * 对局界面。
 *
 * driver 是首页（联机时是房间页）建好之后放进 `MatchSession` 的——放在路由之上才跨得过
 * 那次跳转。直接刷新 `/match` 会读不到 driver（这一局本来就不存盘），这时跳回首页。
 *
 * 这一页自己只做画布**之外**的五件事：背景音乐、离开确认、终局结算、记胜场（顺带开包），
 * 以及联机时那行连接状态字（正在重连、对方掉线，判据见 matchStatus.ts）。
 * 画布里面那一整套（版式、演出、拖牌、选目标）归 `DuelStage` 接线，那里一行界面代码都没有。
 *
 * **界面不分单机和联机**：这一整页对着的是 `MatchDriver` 这一个接口，两种玩法同一套代码
 *（架构 5.6）。只有两处按 `mode` 分岔，各自都写了理由：测试面板挂不挂、离开之后回哪一页。
 */

import type { CardId } from '@ai-duel/core'
import { Dialog } from '@ai-duel/ui'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { useMatchSession } from '../app/MatchSession'
import { usePlatform } from '../app/platform'
import { playTrack } from '../audio/music'
import { toggleMuted } from '../audio/mute'
import type { MatchDriver } from '../match/driver'
import { isLocalDriver } from '../match/localDriver'
import { isServerDriver } from '../match/serverDriver'
import { useMatch } from '../match/useMatch'
import { recordWin } from '../save/saveStore'
import { DuelStage } from './DuelStage'
import { type MatchOutcome, outcomeOf, resultTitleOf } from './matchOutcome'
import { linkStatusOf } from './matchStatus'
import { packPathOf } from './packRoute'
import { ResultScreen } from './ResultScreen'
import './matchScreen.css'

/**
 * 测试面板（架构 7.2 第 5 条：开发专用页面放在 client/dev，生产构建剔除）。
 * 剔除的原理和 App.tsx 那张开发页表一样：`import.meta.env.DEV` 在生产构建里是字面量 false，
 * 整个三元连同里面的动态 import 一起被当成死代码删掉。
 */
const DevPanel = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import('../dev/DevPanel')).DevPanel }))
  : null

/**
 * 已经记过胜场的那几局。
 *
 * 跟着 **driver** 走而不是跟着组件实例：这个组件会被重挂——开发构建下 StrictMode
 * 就要挂两遍，将来从对局跳去牌组页再回来也是一样——而那一局还是同一局，
 * 不该再记一次胜场、再抽一张卡。
 * 用 WeakSet 是因为它只需要「这个对象在不在里面」，而且 driver 被丢掉之后
 * 这条记录也该跟着消失。
 */
const recorded = new WeakSet<MatchDriver>()

export function MatchScreen() {
  const { driver } = useMatchSession()
  const [, navigate] = useLocation()

  /*
   * 没有 driver 就跳回首页。放在 effect 里而不是直接 `navigate`：渲染期间改路由
   * 等于在渲染另一个组件的过程中改状态，React 会警告，而且这一帧还是要渲染点什么。
   */
  useEffect(() => {
    if (driver === null) navigate('/', { replace: true })
  }, [driver, navigate])

  if (driver === null) return null
  return <Match driver={driver} />
}

/**
 * 已经拿到 driver 的那一半。
 *
 * 拆成两个组件是因为下面这些 hook 全都要 driver：写在一个组件里就得在
 * 「driver 为 null」的分支里也把它们调一遍，那正是 hooks 规则不许的事。
 */
function Match({ driver }: { driver: MatchDriver }) {
  const platform = usePlatform()
  const { mode, end } = useMatchSession()
  const [, navigate] = useLocation()
  const view = useMatch(driver)
  const [leaving, setLeaving] = useState(false)
  /**
   * 这一局赢下来抽到的新卡。抽不到（现在恒抽不到，见 content 的 collection.ts）就是 null，
   * 那时结算页照常只有「再来一局 / 回首页」。
   */
  const [drawn, setDrawn] = useState<CardId | null>(null)

  // 对局的曲子。回首页时由那边换成 beginning，所以这里不用在卸载时停。
  useEffect(() => {
    playTrack(platform, 'match')
  }, [platform])

  /*
   * 开发构建下把当前 driver 挂到 `window.__aiDuel` 上，给端到端用例读局面、发指令。
   *
   * 动态 import 而不是文件顶部那种：`import.meta.env.DEV` 在生产构建里是字面量 false，
   * 整段连同 dev/debugHook 那个模块一起被当成死代码删掉（同 App.tsx 那张开发页表）。
   * 静态 import 的话模块无论如何都会被打进包里。
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return
    let remove: (() => void) | null = null
    let disposed = false
    void import('../dev/debugHook').then(({ installMatchDebug }) => {
      // 等这个 await 的工夫组件可能已经卸载了，那就别再挂上去。
      if (disposed) return
      remove = installMatchDebug(driver)
    })
    return () => {
      disposed = true
      remove?.()
    }
  }, [driver])

  const outcome = outcomeOf(view)

  /*
   * 记胜场。测试房不记：那是随手摆出来的局面，不该刷胜场和抽卡。
   *
   * 抽卡要的那个随机数从这里摇（`recordWin` 自己不摇，见 save/saveStore.ts 的理由：
   * 那个模块和 content 一样要可复现）。
   */
  useEffect(() => {
    if (mode === 'test' || outcome !== 'victory' || recorded.has(driver)) return
    recorded.add(driver)
    setDrawn(recordWin(platform, Math.random()).drawn)
  }, [platform, mode, outcome, driver])

  const leave = (to: string): void => {
    /*
     * 联机时先说一句「我不打了」再拆连接。只拆连接的话对面看到的是 `online: false`，
     * 也就是「他掉线了」，于是干等到房间超时；发了 `room:leave` 服务端会当场收摊，
     * 对面立刻收到 `room:closed{peer-left}`（见 server 的 membership.ts）。
     * 打完了的那一局房间已经自己收摊了，这时再发一条服务端也只是忽略。
     */
    if (isServerDriver(driver)) driver.leave()
    end()
    navigate(to)
  }

  /*
   * 离开之后回哪一页：联机回房间页（那里才有「再开一局」的入口），单机回首页。
   * 联机不回首页是因为回去之后玩家还得再点一次「联机对战」、再等一次登录，
   * 而他刚打完一局，多半就是想接着来。
   */
  const exitTo = mode === 'online' ? '/room' : '/'
  /** 抽到牌才有这个地址，没抽到就是 null——结算页照它决定摆不摆「开卡包」。 */
  const packPath = packPathOf(drawn)

  return (
    <div className="match">
      <DuelStage
        /*
         * 座位一变就整个重挂：场景和编排层都是建的时候把座位焊死的（见 DuelStage 的文件头）。
         * 只有热座会真的走到这一步，测试房和联机的座位一局不变。
         * seat 还没到手（联机握手中）时先给 0，那时 view 也还是 null，画面上是空场。
         */
        key={view.seat ?? 0}
        driver={driver}
        platform={platform}
        seat={view.seat ?? 0}
        status={linkStatusOf(view)}
        onLeave={() => setLeaving(true)}
        onToggleMute={() => toggleMuted(platform)}
      />

      {outcome === null ? null : (
        <ResultScreen
          outcome={outcome}
          title={resultTitleOf(outcome, view.abortReason)}
          score={scoreOf(view, outcome)}
          rounds={roundsOf(view, outcome)}
          // 「再来一局」也只是回上一页：这一局的房间已经收摊了（`room:closed`），
          // 真正的「原班人马再来一局」要服务端支持重开房间，那还没有。
          onPlayAgain={() => leave(exitTo)}
          onHome={() => leave('/')}
          /*
           * 抽到新卡才多一颗「开卡包」，它是这一屏的主操作（赢了一局最想看的就是这个）。
           * 开包页只需要一个卡 id，走查询串带过去（理由见 screens/PackScreen.tsx）。
           */
          onOpenPack={packPath === null ? undefined : () => leave(packPath)}
        />
      )}

      {/* 只有 dev 测试房挂面板：热座和联机都是真打，不该有凭空造牌的口子。 */}
      {DevPanel !== null && mode === 'test' && isLocalDriver(driver) ? (
        <Suspense fallback={null}>
          <DevPanel driver={driver} />
        </Suspense>
      ) : null}

      <Dialog
        open={leaving}
        title="离开对局"
        confirm={{ label: '确定离开', onSelect: () => leave(exitTo) }}
        cancel={{ label: '再想想', onSelect: () => setLeaving(false) }}
        onDismiss={() => setLeaving(false)}
      >
        这一局不会保留，离开之后就没法接着打了。
      </Dialog>
    </div>
  )
}

/**
 * 打了几轮。中断局不报——那一半局面根本没打完，报一个数只会让人以为它打完了。
 *
 * 报的是 `view.round`，也就是**最后一轮的编号**：打完的那一局里它就等于总轮数。
 */
function roundsOf(view: ReturnType<typeof useMatch>, outcome: MatchOutcome): number | null {
  if (outcome === 'aborted' || view.view === null) return null
  return view.view.round
}

/** 最终比分。中断局没有比分可言（那一半局面根本没打完）。 */
function scoreOf(
  view: ReturnType<typeof useMatch>,
  outcome: MatchOutcome,
): { mine: number; theirs: number } | null {
  if (outcome === 'aborted' || view.view === null) return null
  return { mine: view.view.self.score, theirs: view.view.opponent.score }
}
