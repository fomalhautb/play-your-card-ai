/**
 * 新手教程的组牌一段（规格 §12 的 Step 18~20）。
 *
 * 这一层只做三件事：进页面前把预填的 17 张写进牌组存档、按 deckSteps.ts 那张表推进引导、
 * 把「现在放行哪张卡」交给画布。页面本身还是那个构筑场景（`DeckStage`），
 * 教学结束后玩家在 `/deck` 看到的就是这套刚组好的牌组。
 *
 * 挡人不靠遮罩：闸门设在场景里（`DeckScene.setTutorial`），它同时负责把目标那一页翻出来。
 * 引导层只压暗、挖洞、说话，整层不吃指针事件。
 */

import type { CardId } from '@ai-duel/core'
import type { Platform } from '@ai-duel/platform'
import { TutorialOverlay } from '@ai-duel/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadDecks, putDeck } from '../save/deckStore'
import {
  DECK_FIRST_STEP,
  type DeckStepId,
  deckBlockTip,
  deckStep,
  TUTORIAL_DECK_ID,
  TUTORIAL_DECK_NAME,
  tutorialDeckPrefill,
} from '../tutorial/deckSteps'
import { useBlockTip } from '../tutorial/useBlockTip'
import { type DeckAnchors, DeckStage } from './DeckStage'
import { measureRects } from './tutorialAnchors'

export interface TutorialDeckPhaseProps {
  platform: Platform
  /** 三张都加完、玩家按了「确认牌组」。 */
  onDone(): void
  /** 顶栏那颗返回：教程里它的含义是「跳过教程」。 */
  onLeave(): void
}

export function TutorialDeckPhase({ platform, onDone, onLeave }: TutorialDeckPhaseProps) {
  /*
   * 预填必须在场景建出来**之前**落盘：`DeckStage` 是拿挂载那一刻的存档去建场景的，
   * 晚一步就会先渲染出一套别的牌组。所以走 useState 的惰性初值——它在首次渲染时跑一次，
   * 而 `putDeck` 本身按固定 id 覆盖，重玩教程也不会堆出一堆牌组。
   */
  const [saved, setSaved] = useState(() => {
    putDeck(platform, TUTORIAL_DECK_ID, TUTORIAL_DECK_NAME, tutorialDeckPrefill())
    return loadDecks(platform)
  })
  const [stepId, setStepId] = useState<DeckStepId>(DECK_FIRST_STEP)
  const step = deckStep(stepId)
  const { tip, notify } = useBlockTip()
  const anchorsRef = useRef<DeckAnchors | null>(null)

  // 开场那句只靠计时往下走；其余几步等玩家把指定的牌加进去（见下面的 onChange）。
  useEffect(() => {
    const current = deckStep(stepId)
    if (current.advanceAfterMs === undefined || current.next === null) return
    const next = current.next
    const timer = setTimeout(() => setStepId(next), current.advanceAfterMs)
    return () => clearTimeout(timer)
  }, [stepId])

  /**
   * 牌表变了：落盘，并看一眼这一步点名的那张是不是进去了。
   *
   * 判据是「牌组里有它了」而不是「刚才加的是它」：三张待加的牌一份都不在预填里
   *（由测试守着），所以出现即等于刚加进去。
   */
  const onChange = useCallback(
    (decks: readonly { id: string; cards: readonly CardId[] }[]) => {
      const cards = decks.find((deck) => deck.id === TUTORIAL_DECK_ID)?.cards ?? []
      // 存档那边按整套覆盖：这一段只编辑这一套，没有第二套会变。
      setSaved(putDeck(platform, TUTORIAL_DECK_ID, TUTORIAL_DECK_NAME, cards))
      const current = deckStep(stepId)
      if (current.allowedCardId === null || current.next === null) return
      if (cards.includes(current.allowedCardId)) setStepId(current.next)
    },
    [platform, stepId],
  )

  return (
    <>
      <DeckStage
        platform={platform}
        decks={saved.decks}
        currentId={TUTORIAL_DECK_ID}
        onChange={onChange}
        // 改名 / 新建 / 删除整段教学都关着（场景那边已经挡下），这里不会被叫到。
        onManage={() => undefined}
        onBack={onLeave}
        onConfirm={onDone}
        tutorial={{
          allowedCardId: step.allowedCardId,
          allowConfirm: step.allowConfirm,
          blockTip: deckBlockTip(step),
        }}
        onBlocked={notify}
        anchorsRef={anchorsRef}
      />
      <TutorialOverlay
        instruction={step.instruction}
        measure={() => measureRects(step.highlight, (one) => anchorsRef.current?.anchorRect(one))}
        active
        blockTip={tip}
      />
    </>
  )
}
