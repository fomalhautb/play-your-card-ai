/**
 * 组件目录页条目：回合结算层（7.1 第 3 条）。
 *
 * 状态矩阵：这一层没有普通/悬停/按下/禁用/加载这五态，全部不适用。
 * 它自己的"变体"是**演到第几段**——每一段对应一条 cue，所以每一段各拍一条：
 * 立起来 → 结果卡到齐（三点等待）→ 答案擦入 → 打字 → 盖章 → 结论和确认。
 *
 * **每一段之前先把前面几段演完再开始下一段**：这些方法是「立刻开演」的，一口气全调完
 * 等于六段动画同时起跑，拍到的会是一团互相盖着的中间态。挂载时用 `ctx.step` 把时钟推过去，
 * 后一段就从静止态起跑——真场景里各段本来就是编排层按虚拟时钟一条条排开的。
 * 推的步长和目录页自己那套一样是 60fps 的整步（见 `advance`），换台机器也是同一帧。
 *
 * 「盖章」那条停在 140ms：判定块正从 1.6 倍压下来、还没落到原大，
 * 停在末尾的话拍到的是一枚已经贴平的牌子，压下来那一下的力道看不出来。
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import {
  SETTLE_ANSWER_MS,
  SETTLE_OPEN_MS,
  SETTLE_ROW_IN_MS,
  SETTLE_ROW_STAGGER_MS,
  SETTLE_STAMP_MS,
} from '../director/timings'
import { storyCard, storyCardName, storyDeps } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { SettleLayer } from './SettleLayer'

/**
 * 画布尺寸。
 *
 * 这一层按 1672×941 的设计尺寸摆好再整块缩放（见 SettleLayer 的 resize），
 * 所以画布只要保持同一个 16:9 就行，缩到 1200×675 之后各块的相对大小和设计稿一致。
 * 再大就超出目录页 1280×900 的视口了。
 */
const SIZE = { width: 1200, height: 675 }
/** 手动时钟的步长，和目录页装配层那份是同一个数（60fps）。 */
const STEP_MS = 1000 / 60
/** 这条条目里每张卡开口作答演多久。真对局里由编排层按字数算，目录页取一个整数好对时刻。 */
const TYPE_MS = 900

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

/** 把手动时钟往前推一段，按 60fps 的整步走（步数取整，同一条条目每次都是同样多帧）。 */
function advance(ctx: StoryStage, ms: number): void {
  const steps = Math.round(ms / STEP_MS)
  for (let i = 0; i < steps; i += 1) ctx.step(STEP_MS)
}

function mount(ctx: StoryStage, stage: Stage) {
  const deps = storyDeps(ctx)
  const layer = new SettleLayer(ctx.width, ctx.height, deps)
  ctx.stage.addChild(layer)
  const done = () => deps.dispose()

  layer.open(QUESTION, 3, { mine: 1, theirs: 2 })
  if (stage === 'open') return done
  advance(ctx, SETTLE_OPEN_MS)

  ROWS.forEach((row, index) => {
    layer.addRow(`row-${index}`, storyCardName(ctx, index), storyCard(ctx, deps, index), row.side)
  })
  if (stage === 'rows') return done
  advance(ctx, SETTLE_ROW_IN_MS + SETTLE_ROW_STAGGER_MS * ROWS.length)

  layer.revealAnswer(ANSWER.text, ANSWER.explain)
  if (stage === 'answer') return done
  advance(ctx, SETTLE_ANSWER_MS)

  for (const [index, row] of ROWS.entries()) {
    layer.typeRow(`row-${index}`, row.answer, row.reasoning, TYPE_MS)
  }
  if (stage === 'typing') return done
  advance(ctx, TYPE_MS)

  for (const [index, row] of ROWS.entries()) {
    layer.stamp(`row-${index}`, row.correct, row.correct && row.side === 'mine')
  }
  if (stage === 'stamp') return done
  advance(ctx, SETTLE_STAMP_MS)

  // 两侧各答对一张，所以这一轮打平；比分从 1:2 各加一分变成 2:3。
  layer.showCounts(1, 1, null)
  layer.showScore({ mine: 2, theirs: 3 }, { mine: 3, theirs: 2 }, '本轮打平，双方各得 1 分')
  layer.enableConfirm(() => {})
  return done
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

/** 立起来：整层正在淡入、顶栏往下落，题面刚亮出来。 */
export const Open = { name: '立起来', parameters: spec('open', 300) }

/** 结果卡到齐：四张卡都淡入了，各自摆着三个跳动的点等着开口。 */
export const Rows = { name: '结果卡到齐', parameters: spec('rows', 500) }

/** 答案擦入：标准答案框从左往右擦出来，停在擦到一半（`SETTLE_ANSWER_MS` 是 600）。 */
export const AnswerWiping = { name: '答案擦入', parameters: spec('answer', 300) }

/** 打字中：大字答案正一个字一个字蹦出来，转圈已经淡掉，小字推理还没轮到。 */
export const Typing = { name: '打字中', parameters: spec('typing', 400) }

/** 盖章：判定块正从 1.6 倍压下来，还没落到原大（理由见文件头）。 */
export const Stamping = { name: '盖章', parameters: spec('stamp', 140) }

/** 结论和确认：正确数、消耗、结论、比分和确认按钮全部到位，是这一层最后的静止帧。 */
export const Scored = { name: '结论和确认', parameters: spec('score', 1600) }
