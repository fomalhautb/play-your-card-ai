/**
 * 新手教程（`/tutorial`，迁移第 32 条）：开始页 → 组牌教学 → 选英雄教学 → 教学对战 → 完成页。
 *
 * 五段**全在这一条路由里换 phase**，不各占一条路由：换路由就要重建教程状态，
 * 而这是一段连贯的引导，中途被打散会丢掉「打完这局的比分」这类跨阶段的东西
 *（旧版 `TutorialScreen` 同一个做法）。
 *
 * ## 顺序：先配置，再打
 *
 * 组牌和选英雄排在教学对战**之前**：那两页说的就是「比赛开始前还要做两件事」，
 * 玩家配完自己的牌组和英雄，紧接着打一局，最后一屏直接是这局的比分。
 * 教学对战本身仍旧用写死的教学牌组（见 tutorial/content.ts）——它是一段对好的剧本，
 * 不能跟着玩家刚配的那副牌走，否则每一步的引导都指不准。
 *
 * ## 出口只有一个：跳过
 *
 * 三段画布页各自的返回 / 离开钮在教程里都是「跳过教程」，点了先弹一次确认——
 * 教程有好几分钟，误触一下退掉太亏。跳过和走完完成页是同一件事：都记一笔
 * `markTutorialDone`，之后首页那颗「开始游戏」就不再把玩家送进这里。
 */

import { Button, Dialog, Page } from '@ai-duel/ui'
import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { usePlatform } from '../app/platform'
import { playTrack } from '../audio/music'
import { markTutorialDone } from '../save/saveStore'
import { TutorialDeckPhase } from './TutorialDeckPhase'
import type { TutorialScore } from './TutorialDuelPhase'
import { TutorialDuelPhase } from './TutorialDuelPhase'
import { TutorialHeroPhase } from './TutorialHeroPhase'
import './tutorialScreen.css'

/**
 * 教程演到哪一屏。顺序就是流程顺序，只往前走，没有回退。
 * 和 tutorial/steps.ts 那张步骤表是两回事：那张表只管教学对战内部的二十来步。
 */
type Phase = 'intro' | 'deck' | 'hero' | 'duel' | 'outro'

/** 教学对战没打完就跳过时给完成页兜的比分。正常走完会被真实比分覆盖。 */
const UNPLAYED: TutorialScore = { mine: 0, foe: 0 }

export function TutorialScreen() {
  const platform = usePlatform()
  const [, navigate] = useLocation()
  const [phase, setPhase] = useState<Phase>('intro')
  const [score, setScore] = useState<TutorialScore>(UNPLAYED)
  const [leaving, setLeaving] = useState(false)

  /*
   * 教程整条流程和匹配房共用同一首曲子，跨阶段不切歌。
   * 教学对战那一屏会自己换成对局那首（见 TutorialDuelPhase），回不来也没关系——
   * 从那一屏出去只有完成页和匹配房两条路，那两处各自会再换一次。
   */
  useEffect(() => {
    playTrack(platform, 'room')
  }, [platform])

  /** 走完或跳过都记一笔，然后去匹配房。 */
  const finish = (): void => {
    markTutorialDone(platform)
    navigate('/room')
  }

  if (phase === 'duel') {
    return (
      <main className="tutorial">
        <TutorialDuelPhase
          platform={platform}
          onDone={(final) => {
            setScore(final)
            setPhase('outro')
          }}
          onLeave={() => setLeaving(true)}
        />
        <SkipDialog open={leaving} onSkip={finish} onCancel={() => setLeaving(false)} />
      </main>
    )
  }

  if (phase === 'deck' || phase === 'hero') {
    return (
      <main className="tutorial">
        {phase === 'deck' ? (
          <TutorialDeckPhase
            platform={platform}
            onDone={() => setPhase('hero')}
            onLeave={() => setLeaving(true)}
          />
        ) : (
          <TutorialHeroPhase
            platform={platform}
            onDone={() => setPhase('duel')}
            onLeave={() => setLeaving(true)}
          />
        )}
        <SkipDialog open={leaving} onSkip={finish} onCancel={() => setLeaving(false)} />
      </main>
    )
  }

  if (phase === 'outro') {
    // 完成页不再给「跳过」：这时候已经没有东西可跳了。
    return (
      <Page title="教学完成">
        <p className="tutorial-text">你已经会打了，也配好了牌组和英雄。</p>
        <div className="tutorial-score">
          <p className="tutorial-score__label">教学对战最终比分</p>
          <p className="tutorial-score__value">
            <b>{score.mine}</b>
            <i aria-hidden="true">:</i>
            <b>{score.foe}</b>
          </p>
        </div>
        <div className="tutorial-actions">
          <Button onClick={finish}>开始真正的对战</Button>
        </div>
      </Page>
    )
  }

  return (
    <Page title="新手教学" onBack={() => setLeaving(true)} backLabel="跳过">
      <p className="tutorial-lead">先配好牌组和英雄，再打一局，边打边学。</p>
      <p className="tutorial-text">
        先组一套 20 张的牌组，再挑一位英雄。
        <br />
        然后打一局教学赛——那一局的牌由系统代发，你只管跟着提示出牌。
      </p>
      <div className="tutorial-actions">
        <Button onClick={() => setPhase('deck')}>开始教学</Button>
      </div>
      <SkipDialog open={leaving} onSkip={finish} onCancel={() => setLeaving(false)} />
    </Page>
  )
}

/** 「跳过教程？」那一问。三段画布页和开始页共用，所以拎成一个小组件。 */
function SkipDialog({
  open,
  onSkip,
  onCancel,
}: {
  open: boolean
  onSkip: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={open}
      title="跳过教程"
      confirm={{ label: '跳过', onSelect: onSkip }}
      cancel={{ label: '继续学', onSelect: onCancel }}
      onDismiss={onCancel}
    >
      跳过之后直接去匹配房，教程随时可以从那里重玩。
    </Dialog>
  )
}
