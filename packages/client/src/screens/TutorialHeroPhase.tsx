/**
 * 新手教程的选英雄一段（规格 §13 的 Step 21）。
 *
 * 两步：高亮霍珀等玩家点开她的技能详情，详情里高亮「确认英雄」等玩家按下去。
 * 确认之后英雄落盘（`saveHero`），和正式那条入口走的是同一条存档路径。
 *
 * 挡住其余六位**不用给场景加闸门**：那一页本来就是受控的（详情开在谁身上由这一层的
 * `detailId` 决定，见 canvas 的 heroContract.ts），点了别人只要不把 `detailId` 摆过去，
 * 详情就不会开——顺手说一句话，玩家才知道为什么没反应。
 */

import type { HeroAction, HeroView } from '@ai-duel/canvas'
import type { HeroId } from '@ai-duel/core'
import type { Platform } from '@ai-duel/platform'
import { TutorialOverlay } from '@ai-duel/ui'
import { useRef, useState } from 'react'
import { toggleMuted, useMuted } from '../audio/mute'
import { saveHero } from '../save/saveStore'
import { HERO_BLOCK_TIP, HERO_STEPS, TUTORIAL_HERO } from '../tutorial/heroSteps'
import { useBlockTip } from '../tutorial/useBlockTip'
import { type HeroAnchors, HeroStage } from './HeroStage'
import { measureRects } from './tutorialAnchors'

export interface TutorialHeroPhaseProps {
  platform: Platform
  /** 玩家按了「确认英雄」。 */
  onDone(): void
  /** 左上角那颗返回：教程里它的含义是「跳过教程」。 */
  onLeave(): void
}

export function TutorialHeroPhase({ platform, onDone, onLeave }: TutorialHeroPhaseProps) {
  const muted = useMuted(platform)
  const [detailId, setDetailId] = useState<HeroId | null>(null)
  const { tip, notify } = useBlockTip()
  const anchorsRef = useRef<HeroAnchors | null>(null)

  // 详情开着就是「该按确认了」，关着就是「该点她」。玩家在详情里点返回会自己退回第一步。
  const step = detailId === null ? HERO_STEPS.HERO_PICK : HERO_STEPS.HERO_CONFIRM

  const act = (action: HeroAction): void => {
    switch (action.kind) {
      case 'open':
        // 教学这一步只放行霍珀。点别人不开详情，但要说一句话。
        if (action.hero === TUTORIAL_HERO) setDetailId(TUTORIAL_HERO)
        else notify(HERO_BLOCK_TIP)
        break
      case 'close':
        setDetailId(null)
        break
      case 'confirm':
        saveHero(platform, TUTORIAL_HERO)
        onDone()
        break
      case 'back':
        onLeave()
        break
      case 'toggle-mute':
        toggleMuted(platform)
        break
    }
  }

  // 选中项一进来就预填成霍珀：这一步等于把等下那局要用的英雄先定下来。
  const view: HeroView = { selectedId: TUTORIAL_HERO, detailId, confirmable: true }

  return (
    <>
      <HeroStage
        view={view}
        platform={platform}
        muted={muted}
        onAction={act}
        anchorsRef={anchorsRef}
      />
      <TutorialOverlay
        instruction={step.instruction}
        measure={() => measureRects([step.highlight], (one) => anchorsRef.current?.anchorRect(one))}
        dim={step.dim}
        active
        blockTip={tip}
      />
    </>
  )
}
