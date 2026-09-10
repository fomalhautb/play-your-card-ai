/**
 * 对局界面。
 *
 * driver 是首页（联机时是房间页）建好之后放进 `MatchSession` 的——放在路由之上才跨得过
 * 那次跳转。直接刷新 `/match` 会读不到 driver（这一局本来就不存盘），这时跳回首页。
 *
 * 这一页自己只做画布**之外**的四件事：背景音乐、离开确认、终局结算、记胜场。
 * 画布里面那一整套（版式、演出、拖牌、选目标）归 `DuelStage` 接线，那里一行界面代码都没有。
 */

import { Dialog } from '@ai-duel/ui'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { useMatchSession } from '../app/MatchSession'
import { usePlatform } from '../app/platform'
import { playTrack } from '../audio/music'
import { toggleMuted } from '../audio/mute'
import type { MatchDriver } from '../match/driver'
import { isLocalDriver } from '../match/localDriver'
import { useMatch } from '../match/useMatch'
import { recordWin } from '../save/saveStore'
import { DuelStage } from './DuelStage'
import { type MatchOutcome, MatchResult } from './MatchResult'
import { outcomeOf, resultTitleOf } from './matchOutcome'
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
 * 跟着 **driver** 走而不是跟着组件实例：去牌组页再回来会把这个组件整个重挂一遍，
 * 而那一局还是同一局，不该再记一次胜场、再抽一张卡。
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

  // 对局的曲子。回首页时由那边换成 beginning，所以这里不用在卸载时停。
  useEffect(() => {
    playTrack(platform, 'match')
  }, [platform])

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
    recordWin(platform, Math.random())
  }, [platform, mode, outcome, driver])

  const leave = (to: string): void => {
    end()
    navigate(to)
  }

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
        onLeave={() => setLeaving(true)}
        onToggleMute={() => toggleMuted(platform)}
      />

      {outcome === null ? null : (
        <MatchResult
          outcome={outcome}
          title={resultTitleOf(outcome, view.abortReason)}
          score={scoreOf(view, outcome)}
          // 「再来一局」现在只回首页：真正的重开要等房间页（第 22、27b 条）。
          onPlayAgain={() => leave('/')}
          onHome={() => leave('/')}
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
        confirm={{ label: '确定离开', onSelect: () => leave('/') }}
        cancel={{ label: '再想想', onSelect: () => setLeaving(false) }}
        onDismiss={() => setLeaving(false)}
      >
        这一局不会保留，离开之后就没法接着打了。
      </Dialog>
    </div>
  )
}

/** 最终比分。中断局没有比分可言（那一半局面根本没打完）。 */
function scoreOf(
  view: ReturnType<typeof useMatch>,
  outcome: MatchOutcome,
): { mine: number; theirs: number } | null {
  if (outcome === 'aborted' || view.view === null) return null
  return { mine: view.view.self.score, theirs: view.view.opponent.score }
}
