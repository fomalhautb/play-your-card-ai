/**
 * 把牌组编辑场景挂进 React，这是构筑页唯一有接线的地方。
 *
 * 和 `DuelStage.tsx` 是同一个路子，但简单得多：这一页没有 driver、没有编排层，
 * 只有「一份卡池 + 几套牌组」进去，「改动」出来。场景认得的东西见 canvas 的
 * `scenes/deckContract.ts`。
 *
 * 三条要紧的：
 * 1. **卡池是算好了才交进去的**：哪些卡、各属哪一家、哪些选不了，全在 content 的
 *    deckPool.ts 里——canvas 不许依赖 content（7.2 第 1 条）。
 * 2. **改名 / 新建 / 删除不在画布里做**：它们要弹输入框和确认框，那是 React 那半边的事
 *    （第 2 节第 3 条）。场景只发一条请求，外面做完再 `applyDecks` 摆回来。
 * 3. 回调存 ref：它们每次渲染都是新函数，而场景是建的时候把它们焊进去的。
 */

import {
  createDeckScene,
  type DeckManageAction,
  type DeckScene,
  type DeckView,
  type EffectTier,
} from '@ai-duel/canvas'
import {
  blockedReasonOf,
  CARDS,
  createCatalog,
  DECK_DISPLAY_CARD_IDS,
  DECK_FACTIONS,
  DECK_SIZE,
  factionForAi,
  MAX_COPIES,
} from '@ai-duel/content'
import type { CardId } from '@ai-duel/core'
import type { Platform } from '@ai-duel/platform'
import { useEffect, useRef, useState } from 'react'
import { loadCardTextures } from '../match/cardAtlas'
import { MAX_DECKS } from '../save/deckStore'
import './deckStage.css'

/** 效果档位的默认值，同 DuelStage：按 GPU 跑分自动定档是 3.7 的事，接上之前钉死在最高档。 */
const DEFAULT_TIER: EffectTier = 'high'
/** 渲染倍率封顶（纪律 3.3）。 */
const MAX_RESOLUTION = 1.5

/**
 * 交给场景的那份卡池，整页只算一次。
 *
 * 顺序就是 content 的展示清单（能选的在前、灰卡在后），场景不再排序。
 */
const POOL = DECK_DISPLAY_CARD_IDS.map((cardId: CardId) => {
  const card = CARDS[cardId]
  const kind = card?.kind === 'skill' ? ('skill' as const) : ('ai' as const)
  return {
    cardId,
    kind,
    // 技能牌没有阵营，给个不会被任何药丸选中的值就行（筛选那条本来也不看它）。
    faction: kind === 'ai' ? factionForAi(cardId) : 'other',
    blockedReason: blockedReasonOf(cardId),
  }
})

/**
 * 构筑规则。三个数各有各的正本：前两个在 content（服务端也查），
 * `maxDecks` 在存档那边（它是纯界面约束）。canvas 自己那份默认值只给目录页和测试用。
 */
const RULES = { size: DECK_SIZE, maxCopies: MAX_COPIES, maxDecks: MAX_DECKS }

export interface DeckStageProps {
  platform: Platform
  decks: readonly DeckView[]
  currentId: string
  /** 牌表或当前牌组变了。调用方当场落盘（这一页没有保存按钮）。 */
  onChange(decks: readonly DeckView[], currentId: string): void
  /** 玩家要改名 / 新建 / 删除。调用方弹框、改存档，再靠 `decks` 变化摆回来。 */
  onManage(action: DeckManageAction): void
  /** 顶栏那颗返回钮。 */
  onBack(): void
  /** 「确认牌组」按下时把这一副交出去。 */
  onConfirm(cards: readonly CardId[]): void
}

export function DeckStage({
  platform,
  decks,
  currentId,
  onChange,
  onManage,
  onBack,
  onConfirm,
}: DeckStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<DeckScene | null>(null)
  const [error, setError] = useState<string | null>(null)

  /*
   * 回调存 ref：它们每次渲染都是新函数，而场景是建的时候把它们焊进去的。
   * 不存 ref 的话要么场景每渲染一次就重建，要么它调的永远是第一次那一版闭包。
   */
  const handlers = useRef({ onChange, onManage, onBack, onConfirm })
  handlers.current = { onChange, onManage, onBack, onConfirm }
  /** 建场景那一刻的存档。它只在首次挂载时用一次，之后的变化走下面那条 `applyDecks`。 */
  const initial = useRef({ decks, currentId })

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (host === null || canvas === null) return

    let disposed = false

    const boot = async () => {
      // 构筑页要**整个卡池**的贴图（AI 牌和技能牌两组），但不要英雄原画——英雄不进牌组。
      const textures = await loadCardTextures({ skills: true })
      if (disposed) return
      const rect = host.getBoundingClientRect()
      const metrics = platform.safeArea.metrics()
      const scene = await createDeckScene({
        canvas,
        width: rect.width,
        height: rect.height,
        resolution: Math.min(metrics.pixelRatio, MAX_RESOLUTION),
        tier: DEFAULT_TIER,
        textures,
        catalog: createCatalog(),
        pool: POOL,
        factions: DECK_FACTIONS,
        decks: initial.current.decks,
        currentId: initial.current.currentId,
        rules: RULES,
        platform,
        coarsePointer: platform.safeArea.isCoarsePointer(),
        // 这两颗钮是建场景时焊进去的，所以照样走 ref 转发（同上面那条理由）。
        onBack: () => handlers.current.onBack(),
        onConfirm: (cards) => handlers.current.onConfirm(cards),
      })
      if (disposed) {
        scene.destroy()
        return
      }
      scene.onChange((next, nextId) => handlers.current.onChange(next, nextId))
      scene.onManage((action) => handlers.current.onManage(action))
      // 放大查看的音效和统计将来接在这儿；场景自己已经把卡放大了。
      scene.onInspect(() => undefined)
      sceneRef.current = scene
    }

    boot().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })

    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      const { width, height } = entry.contentRect
      sceneRef.current?.resize(width, height)
    })
    observer.observe(host)

    return () => {
      disposed = true
      observer.disconnect()
      sceneRef.current?.destroy()
      sceneRef.current = null
    }
    // platform 是建场景时焊死的，换了要整套重建。回调走 ref，不进依赖。
  }, [platform])

  /*
   * 存档变了（改名、新建、删除做完之后）就摆回场景。
   *
   * 场景自己改牌表的那条路**不会**走到这里：那一下先改的是场景内部状态，
   * 外面拿到的 `decks` 和它已经一致，`applyDecks` 摆的是同一份，画面不会跳。
   */
  useEffect(() => {
    sceneRef.current?.applyDecks(decks, currentId)
  }, [decks, currentId])

  return (
    <div className="deck-stage" ref={hostRef}>
      <canvas ref={canvasRef} />
      {error === null ? null : <p className="deck-stage__error">构筑页起不来：{error}</p>}
    </div>
  )
}
