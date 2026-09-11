/**
 * 构筑页上那两行会变的字：卡池底下的页码、牌组栏顶上的「已选 N / 20」。
 *
 * 从 DeckScene.ts 里拎出来的（400 行那条上限逼的，见架构 7.2 第 3 条）。
 * 两行字放在一起是因为它们的写法完全一样，而那个写法有一条要紧的规矩：
 *
 * **内容没变就一个字都不动**。`Label` 建好之后没有改内容的方法（它的字是烤成纹理的，
 * 见 Label.ts），换一句话等于新烤一张纹理——而这一页每重排一次画面就会来问一遍，
 * 不挡住的话就是每帧烤两张（纪律 3.5 明确不许在动画期间建文字）。
 */

import { tokens } from '@ai-duel/design'
import { Label } from '../../components/Label'
import type { DuelDeps } from '../duel/deps'
import type { DeckParts } from './parts'

/** 两行字各自的字号字距，和 parts.ts 里那批一样是组件私有的，不进令牌。 */
const PAGER_TYPE = { fontSize: 13, letterSpacing: 1.3 } as const
const TALLY_TYPE = { fontSize: 15, letterSpacing: 1.5, weight: '600', align: 'left' } as const

export interface DeckLabels {
  setPage(text: string): void
  setTally(text: string): void
  /** 换一套零件之后重新起算：新零件上那两行字是空的，缓存的旧内容会让它们永远不被写上。 */
  reset(): void
}

export function createDeckLabels(parts: () => DeckParts, deps: DuelDeps): DeckLabels {
  let pageText = ''
  let tallyText = ''

  return {
    setPage(text) {
      if (text === pageText) return
      pageText = text
      const current = parts()
      const next = new Label(text, PAGER_TYPE, deps, tokens.color.deck.chipInk)
      next.position.copyFrom(current.pageLabel.position)
      current.layers.pool.addChild(next)
      current.pageLabel.destroy({ children: true })
      current.pageLabel = next
    },

    setTally(text) {
      if (text === tallyText) return
      tallyText = text
      const current = parts()
      const next = new Label(text, TALLY_TYPE, deps, tokens.color.paper.ink)
      next.position.copyFrom(current.tally.position)
      current.layers.side.addChild(next)
      current.tally.destroy({ children: true })
      current.tally = next
    },

    reset() {
      pageText = ''
      tallyText = ''
    },
  }
}
