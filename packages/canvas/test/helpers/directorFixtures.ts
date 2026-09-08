/**
 * 演出编排层测试的共用零件：造视图、造 director、把 cue 排成一行一条的文本。
 *
 * 视图用一份真实的内容目录（`createCatalog()`）：横幅文案要查卡名和技能名，
 * 造假目录反而要把卡表抄一遍。目录是只读的，全套测试共用一份就够。
 */

import { createCatalog } from '@ai-duel/content'
import type { Catalog, GameEvent, PlayerId, PlayerView, QuestionView } from '@ai-duel/core'
import { type Cue, createDirector, type Director } from '../../src/index'
import { Rng } from '../../src/runtime/rng'

export const CATALOG: Catalog = createCatalog()

/** 造一份够用的视图。只填编排层真正会读的那几项，其余给个合理的空值。 */
export function makeView(overrides: Partial<PlayerView> = {}): PlayerView {
  const viewer: PlayerId = overrides.viewer ?? 0
  const side = (id: PlayerId) => ({
    id,
    name: id === 0 ? '甲' : '乙',
    score: 0,
    costReduction: 0,
    tokens: 5,
    spentThisRound: 0,
    tokenMax: 5,
    deckCount: 15,
    board: [],
    discard: [],
    hero: null,
    heroSkillUsed: false,
  })
  return {
    viewer,
    catalog: CATALOG,
    round: 1,
    totalRounds: 5,
    firstPlayer: 0,
    activePlayer: 0,
    phase: 'play',
    questions: [],
    self: { ...side(viewer), hand: [] },
    opponent: { ...side(viewer === 0 ? 1 : 0), handCount: 5 },
    winner: null,
    settleConfirmed: [false, false],
    ...overrides,
  }
}

/** 造一条「已经揭晓、答案也公开了」的题，结算层主线要从视图里取标准答案。 */
export function answeredQuestion(): QuestionView {
  return {
    reveal: 'answer',
    id: 'q-test',
    category: 'meme',
    text: '题面',
    keywords: ['关键词'],
    answer: '标准答案',
    explanation: '因为如此',
  }
}

/** 造一台 director。种子固定，同一份测试跑两遍结果必须一样。 */
export function makeDirector(seat: PlayerId = 0, seed = 1): Director {
  return createDirector({ seat, rng: new Rng(seed) })
}

/** 喂一批事件，然后把时钟推到没有排程为止，返回这一段产生的全部 cue。 */
export function runBatch(
  director: Director,
  batch: { events: GameEvent[]; view: PlayerView },
  advanceMs = 60_000,
): Cue[] {
  director.push(batch)
  director.advance(advanceMs)
  return director.drain()
}

/**
 * 让 director 见过一次视图，时钟停在原地。
 *
 * 对手出牌的强制展示要从「他手上还有没有牌」判断找不找得到起飞点，读的是**上一批**的视图，
 * 所以没喂过第一批的 director 会一律走降级路径——大半的用例都得先做这一下。
 */
export function prime(director: Director, view: PlayerView = makeView()): void {
  director.push({ events: [], view })
  director.drain()
}

/** 只看 kind 的序列，断言「演了哪几段、顺序对不对」时用。 */
export function kindsOf(cues: Cue[]): string[] {
  return cues.map((cue) => cue.kind)
}

/** 挑出某一种 cue，断言时刻和载荷用。 */
export function cuesOf<K extends Cue['kind']>(cues: Cue[], kind: K): Extract<Cue, { kind: K }>[] {
  return cues.filter((cue): cue is Extract<Cue, { kind: K }> => cue.kind === kind)
}

// ---------- 事件构造：只填编排层读的那几项 ----------

export function aiDeployed(player: PlayerId, instanceId: string, cardId = 'doubao'): GameEvent {
  return { type: 'AI_DEPLOYED', player, ai: { instanceId, cardId, owner: player } }
}

export function skillPlayed(
  player: PlayerId,
  instanceId: string,
  cardId = 'fixed-answer',
  targetInstanceId?: string,
): GameEvent {
  return {
    type: 'SKILL_PLAYED',
    player,
    cardId,
    instanceId,
    ...(targetInstanceId !== undefined ? { targetInstanceId } : {}),
  }
}

export function skillCanceled(
  player: PlayerId,
  instanceId: string,
  cardId = 'fixed-answer',
): GameEvent {
  return {
    type: 'SKILL_CANCELED',
    player,
    by: player === 0 ? 1 : 0,
    heroId: 'grace-hopper',
    cardId,
    instanceId,
  }
}

export function cardDrawn(player: PlayerId): GameEvent {
  return { type: 'CARD_DRAWN', player }
}

export function questionRevealed(): GameEvent {
  return {
    type: 'QUESTION_REVEALED',
    question: { id: 'q-test', category: 'meme', text: '题面', keywords: ['关键词'] },
  }
}

export function aiAnswered(
  owner: PlayerId,
  instanceId: string,
  correct: boolean,
  cardId = 'doubao',
): GameEvent {
  return {
    type: 'AI_ANSWERED',
    instanceId,
    owner,
    cardId,
    correct,
    answer: '答案',
    reasoning: '理由',
  }
}

export function roundScored(): GameEvent {
  return {
    type: 'ROUND_SCORED',
    gains: [1, 0],
    scores: [1, 0],
    correctCounts: [1, 0],
    spent: [3, 2],
    verdict: 'more-correct',
  }
}

/**
 * 长文本在快照里只留头一截：时长已经把字数说清楚了，整段抄进去只会淹掉别的信息。
 * 24 这个界是照着最长的那几个标识符定的（`black-white-reversal` 20、`round-banner-done` 17），
 * 它们必须完整显示，否则快照里分不清是哪一条。
 */
function shorten(text: string): string {
  return text.length > 24 ? `${text.slice(0, 20)}…(${text.length}字)` : text
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return shorten(value)
  if (value === null || value === undefined) return String(value)
  if (Array.isArray(value)) return `[${value.map(formatValue).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}:${formatValue(item)}`)
      .join(',')}}`
  }
  return String(value)
}

/**
 * 一行一条 cue：`<时刻>ms +<时长> <kind> <载荷>`。
 * 排版是给人读的——快照红了要一眼看出「哪一刻多了 / 少了 / 挪了哪一段演出」。
 */
function formatCue(cue: Cue): string {
  const payload = Object.entries(cue)
    .filter(([key]) => key !== 'kind' && key !== 'at' && key !== 'durationMs')
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ')
  const head = `${String(cue.at).padStart(6)}ms +${String(cue.durationMs).padEnd(4)} ${cue.kind}`
  return payload === '' ? head : `${head} ${payload}`
}

/** 整段 cue 序列排成一块文本，直接喂给 `toMatchSnapshot`。 */
export function formatCues(cues: Cue[]): string {
  return cues.map(formatCue).join('\n')
}
