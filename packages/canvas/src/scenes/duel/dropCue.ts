/**
 * 拖着牌的时候，屏幕上那几块「松手会怎样」的提示：战场外框、加粗的第二圈、
 * 战场顶上那句话、底下的取消区和它那句话。
 *
 * 从 parts.ts 拆出来是因为它们是**一组**：五块东西只有一种用法（跟着同一个拖拽档位开关），
 * 而且平时一块都不画。混在零件表里的话，「战场外框为什么默认是隐藏的」这件事
 * 要翻三处才拼得出来。
 *
 * 判定本身不在这里：松手打不打得出去只看指针在不在 `dropZone` 里
 *（见 interaction/dragRules.ts），这几块纯粹是告诉玩家那条线画在哪。
 */

import { Box } from '../../components/Box'
import type { DuelDeps } from './deps'
import type { DuelLayout, Rect } from './layout/types'

/** 战场那句提示印什么。抄黑客松版 `.battle__drop-cue--board` 的那两段字。 */
const BOARD_CUE_TEXT = '松手 放到场上'
/** 取消区那句提示印什么，以及它摆在取消区的哪个角。抄 `.battle__drop-cue--return`。 */
const RETURN_CUE = { text: '松手 放回手牌', width: 154, height: 37, top: 18, right: 42 } as const
/** 落点提示进到「松手就打出去」那一档时，战场外框里再套的那一圈往里让多少。 */
const HOT_RING_INSET = 2

export interface DropCues {
  /** 战场那一圈外框，以及「松手就打出去」时套在它里面的第二圈。 */
  boardFrame: Box
  hotRing: Box
  /** 战场顶部那条落点提示。手机档没有（那 52px 的让位是桌面档才有的）。 */
  boardCue: Box | null
  /** 手牌区那条取消区，和它右上角那句提示。 */
  returnZone: Box
  returnCue: Box
}

/**
 * 建出这五块，全部**默认不画**。
 *
 * 黑客松那条战场边是 `border: 1px dashed transparent`——只有拖着牌的时候才亮起来。
 * 这里照它来，顺带躲开一笔不小的账：过度绘制那条指标把每个 Graphics 按**包围盒**
 * 算成一整块实心（见 bench 的 src/page/overdraw.ts），一个 1310×535 的空心框会被记成
 * 盖住战场那一整块，常亮的话桌面档直接顶破 3.2 那条上限。取消区那块 1672×250 同理。
 */
export function createDropCues(layout: DuelLayout, deps: DuelDeps): DropCues {
  const cues: DropCues = {
    boardFrame: frameBox(layout.boardFrame, deps),
    hotRing: frameBox(layout.boardFrame, deps),
    boardCue: layout.dropCue === null ? null : cueBox(BOARD_CUE_TEXT, layout.dropCue, deps),
    returnZone: frameBox(layout.returnZone, deps),
    returnCue: cueBox(RETURN_CUE.text, RETURN_CUE, deps),
  }
  for (const box of boxesOf(cues)) box.visible = false
  return cues
}

/** 按版式摆一遍。改视口走这里。 */
export function placeDropCues(cues: DropCues, layout: DuelLayout): void {
  place(cues.boardFrame, layout.boardFrame)
  cues.hotRing.setSize(
    layout.boardFrame.width - HOT_RING_INSET * 2,
    layout.boardFrame.height - HOT_RING_INSET * 2,
  )
  cues.hotRing.position.set(
    layout.boardFrame.x + HOT_RING_INSET,
    layout.boardFrame.y + HOT_RING_INSET,
  )
  place(cues.boardCue, layout.dropCue)
  place(cues.returnZone, layout.returnZone)
  cues.returnCue.setSize(RETURN_CUE.width, RETURN_CUE.height)
  cues.returnCue.position.set(
    layout.returnZone.x + layout.returnZone.width - RETURN_CUE.right - RETURN_CUE.width,
    layout.returnZone.y + RETURN_CUE.top,
  )
}

/**
 * 拖拽期间的三档：没在拖（全不画）、拖着（外框、取消区和两句提示亮出来）、
 * 指针已经进到落区里（外框里再套一圈，两条平行线看着就是加粗）。
 * 抄黑客松版 `.battle__board` / `.battle__return-zone` 的 `data-drop-ready` / `data-drop-hot`。
 *
 * 取消区**不跟着 hot 变**：它亮的意思是「松在这一片就收回手上」，而 hot 说的是
 * 「松手就打出去」，同时亮两处"现在松手会怎样"只会让人看不懂。
 */
export function setDropCueState(cues: DropCues, state: 'off' | 'ready' | 'hot'): void {
  const dragging = state !== 'off'
  cues.boardFrame.visible = dragging
  if (cues.boardCue !== null) cues.boardCue.visible = dragging
  cues.returnZone.visible = dragging
  cues.returnCue.visible = dragging
  cues.hotRing.visible = state === 'hot'
}

/** 这一组里真的建出来的那几块（手机档没有战场那句提示）。 */
function boxesOf(cues: DropCues): Box[] {
  const all = [cues.boardFrame, cues.hotRing, cues.returnZone, cues.returnCue]
  return cues.boardCue === null ? all : [...all, cues.boardCue]
}

/** 一块只画描边、不吃事件的方块。 */
function frameBox(rect: Rect, deps: DuelDeps): Box {
  const box = new Box({ width: rect.width, height: rect.height }, deps)
  box.position.set(rect.x, rect.y)
  box.eventMode = 'none'
  return box
}

/** 一句提示：小号字的素方块，同样不吃事件。 */
function cueBox(label: string, size: { width: number; height: number }, deps: DuelDeps): Box {
  const box = new Box({ width: size.width, height: size.height, label, size: 'small' }, deps)
  box.eventMode = 'none'
  return box
}

/** 把一块方块按矩形摆好。两边只要有一个是 null 就说明这一档没有这样东西。 */
function place(box: Box | null, rect: Rect | null): void {
  if (box === null || rect === null) return
  box.setSize(rect.width, rect.height)
  box.position.set(rect.x, rect.y)
}
