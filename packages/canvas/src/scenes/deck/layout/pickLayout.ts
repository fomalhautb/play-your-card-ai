/**
 * 挑一档牌组编辑的版式。
 *
 * 判据和对局那边**一模一样**（见 scenes/duel/layout/pickLayout.ts）：指针粗、
 * 或者视口宽度窄于断点，就走手机档。故意共用同一条判据——同一台设备在对局页和构筑页
 * 之间来回切时，不该一会儿是手机档一会儿是桌面档。
 *
 * 判据单独一个文件是为了让「选哪一档」测得了：版式本身只回答「这一档怎么摆」。
 */

import { pickTier } from '../../duel/layout/pickLayout'
import { desktopLayout } from './desktopLayout'
import { mobileLayout } from './mobileLayout'
import type { DeckLayout, DeckLayoutTier } from './types'

export function pickDeckTier(width: number, coarsePointer = false): DeckLayoutTier {
  return pickTier(width, coarsePointer)
}

export function pickDeckLayout(width: number, height: number, coarsePointer = false): DeckLayout {
  return pickDeckTier(width, coarsePointer) === 'mobile'
    ? mobileLayout(width, height)
    : desktopLayout(width, height)
}
