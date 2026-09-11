/**
 * 构筑页（迁移第 28 条）。
 *
 * 这一页自己只做画布**之外**的三件事：背景音乐、存档读写、改名 / 新建 / 删除那三个弹框。
 * 画布里面那一整套（两档版式、卡池分页、拖拽增删、放大查看）归 `DeckStage` 接线，
 * 那里一行界面代码都没有。
 *
 * ## 没有保存按钮
 *
 * 场景每加一张、删一张、换一套牌组就回调一次，这里当场写回 localStorage
 *（旧版 `DeckScreen.tsx` 的 `commitDeck` 也是这样）。所以界面上没有「未保存」这个状态。
 *
 * ## 存档为什么要存一份 ref
 *
 * 存档的每个修改函数都是「读一份、改一处、写回去」，而同一拍里可能连着改两处
 *（换牌组的同时牌表也变了）。只靠 state 的话第二次改动读到的还是上一次渲染那一份，
 * 会把第一次的结果盖掉。ref 在同一拍里就是新的（同旧版的 `savedRef`）。
 */

import type { DeckManageAction, DeckView } from '@ai-duel/canvas'
import type { CardId } from '@ai-duel/core'
import { Dialog, TextField } from '@ai-duel/ui'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { usePlatform } from '../app/platform'
import { playTrack } from '../audio/music'
import {
  createDeck,
  DECK_NAME_MAX,
  type DecksData,
  deleteDeck,
  loadDecks,
  MAX_DECKS,
  renameDeck,
  setCurrentDeck,
  updateDeckCards,
} from '../save/deckStore'
import { DeckStage } from './DeckStage'
import './deckScreen.css'

/** 现在开着哪个框。`limit` 是「牌组已经 12 套了」那句提示。 */
type DeckDialog =
  | { kind: 'rename'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'limit' }

/**
 * 新牌组的 id。
 *
 * 存档那边只要一个「摇一个新的」，撞车了它自己会重摇（见 deckStore 的 `uniqueId`），
 * 所以这里用最省的一种：时间戳 + 一小段随机。
 */
function newDeckId(): string {
  return `deck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function DeckScreen() {
  const platform = usePlatform()
  const [, navigate] = useLocation()
  const [saved, setSaved] = useState<DecksData>(() => loadDecks(platform))
  const savedRef = useRef(saved)
  const [dialog, setDialog] = useState<DeckDialog | null>(null)
  const [nameDraft, setNameDraft] = useState('')

  /*
   * 构筑页的曲子。`playTrack` 自己挡了「已经在放同一首就什么都不做」，
   * 所以从这一页跳走再回来不会把它从头重开（见 audio/music.ts）。
   */
  useEffect(() => {
    playTrack(platform, 'cardsSelecting')
  }, [platform])

  /** 写回存档并更新 state。**ref 要立刻写**，理由见文件头。 */
  const commit = (next: DecksData): void => {
    savedRef.current = next
    setSaved(next)
  }

  /**
   * 场景报来一次改动：牌表变了、或者换了一套牌组。
   *
   * 逐套比对而不是无脑全写：`updateDeckCards` 每调一次都会重新规整整份存档并落盘一次，
   * 而一次操作实际上只会改一套。
   */
  const onChange = (decks: readonly DeckView[], currentId: string): void => {
    let data = savedRef.current
    if (currentId !== data.currentId) data = setCurrentDeck(platform, currentId)
    for (const deck of decks) {
      const before = data.decks.find((one) => one.id === deck.id)
      if (before === undefined || sameCards(before.cards, deck.cards)) continue
      data = updateDeckCards(platform, deck.id, deck.cards)
    }
    commit(data)
  }

  const onManage = (action: DeckManageAction): void => {
    if (action.kind === 'create') {
      const next = createDeck(platform, newDeckId)
      // 已经满 MAX_DECKS 套：说一句为什么，而不是让那颗钮点了没反应。
      if (next === null) setDialog({ kind: 'limit' })
      else commit(next)
      return
    }
    if (action.kind === 'rename') {
      setNameDraft(savedRef.current.decks.find((one) => one.id === action.id)?.name ?? '')
    }
    setDialog(action)
  }

  const confirmRename = (id: string): void => {
    commit(renameDeck(platform, id, nameDraft))
    setDialog(null)
  }

  const confirmDelete = (id: string): void => {
    commit(deleteDeck(platform, id, newDeckId))
    setDialog(null)
  }

  return (
    <main className="deck-screen">
      <DeckStage
        platform={platform}
        decks={saved.decks}
        currentId={saved.currentId}
        onChange={onChange}
        onManage={onManage}
        onBack={() => navigate('/')}
        /*
         * 「确认牌组」现在就是回首页：当前牌组早在选中它那一刻就写进存档了，
         * 开局时由那边读（见 match/localMatch.ts）。真正的「选牌组 → 选英雄 → 开局」
         * 那条流程是第 29、30 条的事，到时候这一行换成跳去下一步。
         */
        onConfirm={() => navigate('/')}
      />
      <Dialog
        open={dialog?.kind === 'rename'}
        title="给牌组改名"
        confirm={{
          label: '改好了',
          onSelect: () => {
            if (dialog?.kind === 'rename') confirmRename(dialog.id)
          },
        }}
        cancel={{ label: '取消', onSelect: () => setDialog(null) }}
        onDismiss={() => setDialog(null)}
      >
        <TextField
          value={nameDraft}
          onChange={setNameDraft}
          label="牌组名"
          maxLength={DECK_NAME_MAX}
          placeholder="给这套牌组起个名字"
          autoFocus
          onSubmit={() => {
            if (dialog?.kind === 'rename') confirmRename(dialog.id)
          }}
          onCancel={() => setDialog(null)}
        />
      </Dialog>
      <Dialog
        open={dialog?.kind === 'delete'}
        title="删掉这套牌组"
        confirm={{
          label: '删掉',
          onSelect: () => {
            if (dialog?.kind === 'delete') confirmDelete(dialog.id)
          },
        }}
        cancel={{ label: '再想想', onSelect: () => setDialog(null) }}
        onDismiss={() => setDialog(null)}
      >
        删掉之后这套牌组就没了，配好的牌要重新选一遍。
      </Dialog>
      <Dialog
        open={dialog?.kind === 'limit'}
        title="牌组存满了"
        confirm={{ label: '知道了', onSelect: () => setDialog(null) }}
        onDismiss={() => setDialog(null)}
      >
        最多只能存 {MAX_DECKS} 套牌组，先删掉一套再新建。
      </Dialog>
    </main>
  )
}

/** 两份牌表一不一样。逐张比——同一张牌带几份、排第几个都算数。 */
function sameCards(a: readonly CardId[], b: readonly CardId[]): boolean {
  return a.length === b.length && a.every((cardId, index) => cardId === b[index])
}
