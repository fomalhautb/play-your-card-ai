/**
 * 新手教程的教学对战一段（规格 §4~§9）。
 *
 * 画面完全是正式对局那一套（`DuelStage` → 编排层 → 画布场景），教程只多挂三样东西：
 * 一层引导（压暗 + 挖洞 + 一句话）、一份逐张手牌的锁、以及「结束出牌」那道闸。
 *
 * 这一屏刻意**不走 `MatchScreen`**：那条路会给胜局记胜场（`recordWin`）、还会抽一张新卡，
 * 而教学局是一段写死结局的剧本，记进存档等于白送一场胜利和一张卡。
 * driver 也不进 `MatchSession`：教程自己起、自己收，不用跨路由传递，
 * 也就不会和联机 / 测试房那一局互相顶掉。
 */

import type { DuelAnchorName } from '@ai-duel/canvas'
import { pickUrgeId } from '@ai-duel/content'
import type { Platform } from '@ai-duel/platform'
import { TutorialOverlay } from '@ai-duel/ui'
import { useEffect, useRef, useState } from 'react'
import { playTrack } from '../audio/music'
import { toggleMuted } from '../audio/mute'
import type { TutorialDriver } from '../match/tutorialDriver'
import { createTutorialDriver } from '../match/tutorialDriver'
import { useMatch } from '../match/useMatch'
import { loadSave } from '../save/saveStore'
import { TUTORIAL_PLAYER_SEAT } from '../tutorial/content'
import { useBlockTip } from '../tutorial/useBlockTip'
import type { TutorialTarget } from '../tutorial/useTutorial'
import { useTutorial } from '../tutorial/useTutorial'
import { useTutorialDebug } from '../tutorial/useTutorialDebug'
import { type DuelAnchors, DuelStage } from './DuelStage'
import { measureRects } from './tutorialAnchors'

/** 教学对战的最终比分，完成页要显示（脚本正常走完是 3:0）。 */
export interface TutorialScore {
  mine: number
  foe: number
}

export interface TutorialDuelPhaseProps {
  platform: Platform
  /** 走完最后一步（终局结算层退场）。带出最终比分给完成页。 */
  onDone(score: TutorialScore): void
  /** 顶栏那颗离开：教程里它的含义是「跳过教程」。 */
  onLeave(): void
}

export function TutorialDuelPhase({ platform, onDone, onLeave }: TutorialDuelPhaseProps) {
  /**
   * driver 在 effect 里建、在 effect 的清理里收，**不放在 ref 或惰性 state 里**。
   *
   * 理由是 StrictMode：开发构建下 React 会「挂载 → 卸载 → 再挂载」跑一遍，
   * 在渲染期建、在清理里 dispose 的写法，第二次挂载拿到的就是一个已经被 dispose 的 driver，
   * 整局再也推不动。写成「清理里 dispose 并置空、effect 里重建」之后，
   * 第二次挂载会新开一局，行为和生产构建一致。
   * 开局那批事件在 driverCore 里攒着，等界面订上来再补发，所以晚一帧建不会漏。
   */
  const [driver, setDriver] = useState<TutorialDriver | null>(null)
  useEffect(() => {
    const next = createTutorialDriver()
    setDriver(next)
    return () => {
      next.dispose()
      setDriver(null)
    }
  }, [])

  // 对局的曲子。回首页 / 进匹配房时由那边换掉。
  useEffect(() => {
    playTrack(platform, 'match')
  }, [platform])

  if (driver === null) return null
  return <TutorialDuel driver={driver} platform={platform} onDone={onDone} onLeave={onLeave} />
}

/**
 * 拆成两个组件是因为 `useTutorial` 要求 driver 已经建好，
 * 而上面那层在建好之前还要渲染一帧（hooks 不许按条件调用）。
 */
function TutorialDuel({
  driver,
  platform,
  onDone,
  onLeave,
}: TutorialDuelPhaseProps & { driver: TutorialDriver }) {
  const tutorial = useTutorial(driver)
  const match = useMatch(driver)
  const { tip, notify } = useBlockTip()
  const anchorsRef = useRef<DuelAnchors | null>(null)
  /**
   * 屏幕上正盖着一层全屏过场（抛硬币、答题揭晓与结算、技能抵消、强制展示）。
   *
   * 引导层要给它让位——旧版靠 z-index 就办到了（两层都是 DOM），新版过场画在画布里，
   * 压在画布上的 DOM 再也盖不住它。不让位的话，引导层那层「点任意处继续」的捕获层
   * 会把玩家点结算层那颗「确认」的那一下也接走，这一轮就再也确认不了
   *（见 canvas 的 `DirectorLocks.cutscene`）。
   */
  const [cutscene, setCutscene] = useState(false)
  /*
   * 「减少动效」现读一次就定死：它是建场景时焊进去的（换了要整套重建，见 DuelStage），
   * 而设置页在另一条路由上——玩家进得去那一页就说明已经离开了教程。
   */
  const [reducedMotion] = useState(() => loadSave(platform).reducedMotion)

  /**
   * 已经报过一次了。`onDone` 每次渲染都是新函数、局面也一直在变，
   * 所以这条 effect 会重跑好几遍，而「教学对战演完了」只该报一次。
   */
  const reportedRef = useRef(false)

  /*
   * 走完最后一步就进完成页。放在 effect 里而不是渲染期调：`onDone` 会换掉上层的 phase，
   * 那是在渲染另一个组件的过程中改状态，React 会警告。
   *
   * 比分从局面里现读。理论上一定在（走到这一步说明整局都演完了），
   * 取不到就按 0:0 交出去——总好过为一个不该发生的分支把整条流程卡在这一屏上。
   */
  useEffect(() => {
    if (!tutorial.done || reportedRef.current) return
    reportedRef.current = true
    onDone({ mine: match.view?.self.score ?? 0, foe: match.view?.opponent.score ?? 0 })
  }, [tutorial.done, match.view, onDone])

  const measure = () =>
    measureRects(tutorial.targets, (target: TutorialTarget) =>
      target.kind === 'anchor'
        ? anchorsRef.current?.anchorRect(target.name)
        : anchorsRef.current?.handCardRect(target.instanceId),
    )

  /*
   * 开发构建下把「停在哪一步、要圈哪儿、某个锚点在哪儿」挂出去给端到端用例读。
   *
   * 多给一路 `anchor` 是因为这一段有两颗**画在画布上**的钮要点（「结束出牌」和战场上那一格），
   * 而 DOM 里根本没有它们；用例按锚点矩形算落点，再真的用指针点下去。
   */
  useTutorialDebug(() => ({
    phase: 'duel',
    step: tutorial.step.id,
    ready: tutorial.ready,
    targets: measure,
    anchor: (name) => {
      const rect = anchorsRef.current?.anchorRect(name as DuelAnchorName)
      return rect === null || rect === undefined
        ? null
        : { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
    },
  }))

  /*
   * 对局那一格调试口子也挂上（同 `MatchScreen`）。
   *
   * 教程用例只拿它发一条 `CONFIRM_ROUND`：每轮结算要玩家在结算层上点一下「确认」，
   * 那颗钮画在画布里、位置由结算层自己算，而**它不是教程的一步**——
   * 教程的每一句提示都没指着它。真按钮的那条路已经由单机那条用例守着了。
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return
    let remove: (() => void) | null = null
    let disposed = false
    void import('../dev/debugHook').then(({ installMatchDebug }) => {
      if (disposed) return
      remove = installMatchDebug(driver)
    })
    return () => {
      disposed = true
      remove?.()
    }
  }, [driver])

  return (
    <>
      <DuelStage
        driver={driver}
        platform={platform}
        // 教学局固定坐 0 号座（见 tutorial/content.ts），一局不变。
        seat={TUTORIAL_PLAYER_SEAT}
        // 教程里那颗离开钮的含义是「跳过教程」，由上层弹确认框。
        onLeave={onLeave}
        onToggleMute={() => toggleMuted(platform)}
        onUrge={() => driver.urge(pickUrgeId(Math.random()))}
        reducedMotion={reducedMotion}
        onEvents={tutorial.onEvents}
        onTutorialCue={tutorial.onCue}
        blockedCards={tutorial.blockedCards}
        endPlayBlocked={tutorial.endPlayBlocked}
        onBlocked={notify}
        onLocks={(locks) => setCutscene(locks.cutscene)}
        anchorsRef={anchorsRef}
      />
      <TutorialOverlay
        instruction={tutorial.step.instruction}
        measure={measure}
        dim={tutorial.step.dim !== false}
        // 提示还没就绪、这一步本来就不说话、或者正盖着一层过场时，整层什么都不画。
        active={tutorial.ready && tutorial.step.instruction !== null && !cutscene}
        // 纯讲解的步骤等玩家点一下才走；要玩家出牌 / 等演出的那些步不传，界面照常操作。
        onNext={tutorial.awaitingTap ? tutorial.notifyTap : null}
        blockTip={tip}
      />
    </>
  )
}
