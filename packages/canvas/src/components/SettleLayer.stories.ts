/**
 * 组件目录页条目：回合结算层（7.1 第 3 条）。
 *
 * 状态矩阵：这一层没有普通/悬停/按下/禁用/加载这五态，全部不适用。
 * 它自己的"变体"是**演到第几段**——每一段对应一条 cue，所以每一段各拍一条：
 * 立起来 → 结果卡到齐（三点等待）→ 答案擦入 → 打字 → 盖章 → 结论和确认。
 *
 * 每条都是把前面几段一口气调完、只让最后一段停在关键帧上。这样拍的是"演到这里的样子"，
 * 而不是"只调了这一个方法"——真场景里各段是接着演的，中间态才是要保护的东西。
 *
 * 「盖章」那条停在 140ms：判定块正从 1.6 倍压下来、还没落到原大，
 * 停在末尾的话拍到的是一枚已经贴平的牌子，压下来那一下的力道看不出来。
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import { storyCard, storyCardName, storyDeps } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { SettleLayer } from './SettleLayer'

/** 画布尺寸。这一层铺满整块舞台，按 16:9 的一档取。 */
const SIZE = { width: 1200, height: 700 }
/** 演到哪一段。每一段对应一条 cue，顺序就是编排层排的那条线。 */
type Stage = 'open' | 'rows' | 'answer' | 'typing' | 'stamp' | 'score'

const QUESTION = {
  category: '历史掌故',
  text: '「洛阳纸贵」这个成语，说的是哪位文人的哪一篇作品引得满城传抄？',
}
const ANSWER = { text: '左思《三都赋》', explain: '西晋左思写成《三都赋》后，豪贵之家竞相传写。' }
/** 四张结果卡的作答。两侧各两张，对错各半，判定块的两档配色一条条目里就都拍到了。 */
const ROWS = [
  { side: 'theirs', answer: '左思', reasoning: '西晋文人，代表作《三都赋》。', correct: true },
  { side: 'theirs', answer: '陆机', reasoning: '同为西晋文人，但典故不是他。', correct: false },
  { side: 'mine', answer: '左思《三都赋》', reasoning: '典出《晋书·左思传》。', correct: true },
  { side: 'mine', answer: '曹植', reasoning: '年代对不上，曹植是三国时人。', correct: false },
] as const

function mount(ctx: StoryStage, stage: Stage) {
  const deps = storyDeps(ctx)
  const layer = new SettleLayer(ctx.width, ctx.height, deps)
  ctx.stage.addChild(layer)
  layer.open(QUESTION, 3, { mine: 1, theirs: 2 })
  if (stage === 'open') return () => deps.dispose()

  ROWS.forEach((row, index) => {
    layer.addRow(`row-${index}`, storyCardName(ctx, index), storyCard(ctx, deps, index), row.side)
  })
  if (stage === 'rows') return () => deps.dispose()

  layer.revealAnswer(ANSWER.text, ANSWER.explain)
  if (stage === 'answer') return () => deps.dispose()

  ROWS.forEach((row, index) => {
    layer.typeRow(`row-${index}`, row.answer, row.reasoning, 900)
  })
  if (stage === 'typing') return () => deps.dispose()

  ROWS.forEach((row, index) => {
    layer.stamp(`row-${index}`, row.correct, row.correct && row.side === 'mine')
  })
  if (stage === 'stamp') return () => deps.dispose()

  layer.showCounts(1, 1, null)
  layer.showScore({ mine: 2, theirs: 3 }, { mine: 3, theirs: 2 }, '本轮打平')
  layer.enableConfirm(() => {})
  return () => deps.dispose()
}

function spec(stage: Stage, settleMs: number) {
  return {
    pixi: {
      ...SIZE,
      needsAtlas: true,
      settleMs,
      mount: (ctx: StoryStage) => mount(ctx, stage),
    },
  }
}

export default {
  title: 'Canvas/SettleLayer',
  render: () => null,
}

/** 立起来：题面亮着，答案框还没擦出来，两侧一张结果卡都没有。 */
export const Open = { name: '立起来', parameters: spec('open', 700) }

/** 结果卡到齐：四张卡都淡入了，各自摆着三个跳动的点等着开口。 */
export const Rows = { name: '结果卡到齐', parameters: spec('rows', 900) }

/** 答案擦入：标准答案框从左往右擦出来，停在擦到一半（`SETTLE_ANSWER_MS` 是 600）。 */
export const AnswerWiping = { name: '答案擦入', parameters: spec('answer', 300) }

/** 打字中：大字答案正一个字一个字蹦出来，转圈已经淡掉。 */
export const Typing = { name: '打字中', parameters: spec('typing', 600) }

/** 盖章：判定块正从 1.6 倍压下来，还没落到原大（理由见文件头）。 */
export const Stamping = { name: '盖章', parameters: spec('stamp', 140) }

/** 结论和确认：正确数、消耗、结论、比分和确认按钮全部到位，是这一层最后的静止帧。 */
export const Scored = { name: '结论和确认', parameters: spec('score', 1600) }
