/**
 * 牌组存档：玩家在构筑页拼好的几套牌组。
 *
 * 和 saveStore.ts 一样只有本机这一层，读写走 `platform.storage`，坏数据一律回落成默认值，
 * 结构要改就换存档位的版本号，不写迁移代码（项目不做向后兼容）。
 * 比 saveStore 多一份内存缓存，理由见下面 `cached` 的注释。
 *
 * 存的是卡池里的真卡（`isLegalDeck` 认的那批），所以读出来的牌组可以直接开局；
 * 但存档只保证卡 id 在卡池里，**不保证张数够开局**——玩家可以把牌组编到一半就走人，
 * 所以拿它去开局的地方要自己过一遍 content 的 `isLegalDeck`。
 */

import { CARD_POOL, DECK_SIZE, MAX_COPIES, PRESET_DECKS } from '@ai-duel/content'
import type { CardId } from '@ai-duel/core'
import type { Platform, StorageSlot } from '@ai-duel/platform'
import { z } from 'zod'

/**
 * 最多存几套牌组，牌组名最多几个字。
 *
 * 两条都是纯粹的界面约束（列表再长就没法一眼扫完、标签排不下），不是玩法规则，
 * 所以留在客户端，不进 content——服务端开局时不关心玩家一共存了几套。
 * 「20 张、同名最多 3 份、必须在卡池里」那三条才是规则，在 content 的 decks.ts。
 */
export const MAX_DECKS = 12
export const DECK_NAME_MAX = 10

/** 新建牌组的默认名，重名时后面接序号。 */
const DEFAULT_DECK_NAME = '新牌组'

const POOL = new Set<CardId>(CARD_POOL)

export interface SavedDeck {
  id: string
  name: string
  /** 卡 id，逐份存：同一张卡带三份就在数组里出现三次。顺序即选牌顺序。 */
  cards: CardId[]
}

export interface DecksData {
  decks: SavedDeck[]
  /** 当前选中的牌组 id。读出来的存档保证它一定能在 decks 里找到。 */
  currentId: string
}

/**
 * 只查形状，内容规整（名字截断、卡表过滤）在下面自己做。
 *
 * 几个 `.optional()` 不能省：zod 4 里光写 `z.unknown()` 仍然要求这个键存在，
 * 而缺字段的存档正是这里最该救回来的一类——名字丢了给个默认名就行，不必整份作废。
 */
const rawDecksSchema = z.object({
  decks: z.array(z.unknown()),
  currentId: z.unknown().optional(),
})

const rawDeckSchema = z.object({
  id: z.string().min(1),
  name: z.unknown().optional(),
  cards: z.unknown().optional(),
})

/** 名字规整：trim 后截断到 DECK_NAME_MAX 个字符，空名回落到调用方给的原名。 */
function clampName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const trimmed = raw.trim()
  if (trimmed === '') return fallback
  // 按码点截断而不是 slice：中文名和 emoji 都算一个字符，也免得把代理对切成半个乱码。
  return [...trimmed].slice(0, DECK_NAME_MAX).join('')
}

/**
 * 卡表规整：丢掉卡池里没有的卡、超出份数上限的重复卡，并把长度收进 DECK_SIZE 以内。
 *
 * 挡的是三种脏数据：改坏的存档里那种压根不存在的 id（渲染时按 id 取卡会抛错）、
 * 「即将上线」的技能牌，以及调不到模型的那两张 AI——后两类画得出来但不该上牌桌
 *（都不在 `CARD_POOL` 里）。老存档里带着它们的牌组会因此少几张，玩家回构筑页补满即可。
 */
function sanitizeCards(raw: unknown): CardId[] {
  if (!Array.isArray(raw)) return []
  const copies = new Map<CardId, number>()
  const cards: CardId[] = []
  for (const cardId of raw) {
    if (typeof cardId !== 'string' || !POOL.has(cardId)) continue
    const used = copies.get(cardId) ?? 0
    if (used >= MAX_COPIES) continue
    copies.set(cardId, used + 1)
    cards.push(cardId)
    if (cards.length >= DECK_SIZE) break
  }
  return cards
}

const DECKS_SLOT: StorageSlot<DecksData> = {
  name: 'ai-duel-decks',
  version: 1,
  parse(raw) {
    const parsed = rawDecksSchema.safeParse(raw)
    if (!parsed.success) return null

    const ids = new Set<string>()
    const decks: SavedDeck[] = []
    for (const entry of parsed.data.decks) {
      const deck = rawDeckSchema.safeParse(entry)
      if (!deck.success) continue
      // id 是改名和删除的唯一凭据：重复 id 会让一次操作同时命中两套牌组，后来的直接丢掉。
      if (ids.has(deck.data.id)) continue
      ids.add(deck.data.id)
      decks.push({
        id: deck.data.id,
        name: clampName(deck.data.name, DEFAULT_DECK_NAME),
        cards: sanitizeCards(deck.data.cards),
      })
      if (decks.length >= MAX_DECKS) break
    }

    const [first] = decks
    // 一套都没剩说明这份存档已经没法用了，当作新号重新播种。
    if (first === undefined) return null
    const { currentId } = parsed.data
    // 当前牌组被删过或存档被改坏时，回落到第一套，绝不留下指不到人的 currentId。
    const current = typeof currentId === 'string' && ids.has(currentId) ? currentId : first.id
    return { decks, currentId: current }
  },
}

/**
 * 三套预设的 id 和名字，**顺序必须和 content 的 `PRESET_DECKS` 一致**
 *（平衡 / 低费铺场 / 高费保护）。名字和 id 是界面的事，牌表是内容的事，所以分两处。
 * content 那边加了第四副而这里没跟上，多出来的那副会拿到兜底的名字，不会丢。
 */
const PRESET_LABELS = [
  { id: 'preset-balanced', name: '默认卡组' },
  { id: 'preset-low-cost', name: '低费流' },
  { id: 'preset-high-cost', name: '强卡流' },
]

/**
 * 首次进入时播种的三套预设：content 的三副预设牌组，各是一种打法。
 *
 * 播三套而不是一套，是想让人一进来就看出「牌组是可以有打法的」——三副摆在一起，
 * 差别一眼就能对出来，比给一副牌再让人自己去猜要直接。
 * 预设就是普通牌组：可以改名、改卡、删掉，删完也不会自动长回来（只有一套都不剩时
 * 才补一套空的）。id 写死成 preset-*，方便对着看是不是原始预设。
 * 也走一遍 sanitizeCards：预设里写错卡 id 只会少几张牌，不会污染存档。
 */
function seedPresets(): DecksData {
  const decks = PRESET_DECKS.map((cards, index) => {
    const label = PRESET_LABELS[index]
    return {
      id: label?.id ?? `preset-${index}`,
      name: label?.name ?? `预设 ${index + 1}`,
      cards: sanitizeCards(cards),
    }
  })
  const [first] = decks
  // PRESET_DECKS 恒有三副，这里只是给类型检查一个交代。默认选中第一套。
  return { decks, currentId: first?.id ?? PRESET_LABELS[0]!.id }
}

/**
 * 最近一份成功构建出来的存档，只活在内存里。
 *
 * 存在的理由是 localStorage 整个不可用的那种环境（隐私模式、站点数据被禁）：那里每次读都失败，
 * 而下面每个修改函数都要先 `load` 拿基准数据。`platform.storage.read` 对「没存过」和
 * 「浏览器不让读」都返回 null，分不开这两种情况，所以这一层必须自己接住：
 * 没有缓存的话，每次读都重新播种预设，于是改完名下一步就被打回原名、新建的牌组在下一次
 * `updateDeckCards` 里根本不存在，调用方跟着播种数据的 currentId 走，
 * 就会把正在编辑的那一整套卡写进第一套预设。
 *
 * 代价是「存档被外面清掉了」也会被缓存顶回来（旧版那份缓存只在读抛异常时顶上，分得开）。
 * 这个边角只有多标签页里手动清站点数据才碰得到，而多标签页本来就是最后写入者胜。
 */
let cached: DecksData | null = null

/** 只给测试用：清掉内存缓存，让每个用例都从「这次会话还没读过存档」开始。 */
export function resetDeckCacheForTest(): void {
  cached = null
}

/** 写回并原样返回，让每个修改函数都只有一行收尾。顺手记进缓存，存不下时靠它接上下一步。 */
function commit(platform: Platform, data: DecksData): DecksData {
  cached = data
  platform.storage.write(DECKS_SLOT, data)
  return data
}

/**
 * 读牌组存档。
 *
 * 读不到、解析失败、浏览器不让读，一律回落成「这次会话攒下的那份」或播种预设，
 * 保证返回至少一套牌组、且 currentId 一定指得到人——调用方不用处理「没有牌组」的空状态。
 */
export function loadDecks(platform: Platform): DecksData {
  const stored = platform.storage.read(DECKS_SLOT)
  if (stored !== null) {
    cached = stored
    return stored
  }
  if (cached !== null) return cached
  return commit(platform, seedPresets())
}

/**
 * 清空牌组存档，重新播种三套预设。给演示和调试用（「重置存档」一起调它和 resetSave）。
 *
 * 不删存档位而是直接写回预设：写不进去的环境里靠 `cached` 也能生效。
 */
export function resetDecks(platform: Platform): DecksData {
  return commit(platform, seedPresets())
}

/** 覆盖一套牌组的卡表（会过滤未知卡、超份数的卡和超长部分）。id 不存在时原样返回。 */
export function updateDeckCards(
  platform: Platform,
  id: string,
  cards: readonly CardId[],
): DecksData {
  const data = loadDecks(platform)
  if (!data.decks.some((deck) => deck.id === id)) return data
  return commit(platform, {
    ...data,
    decks: data.decks.map((deck) =>
      deck.id === id ? { ...deck, cards: sanitizeCards(cards) } : deck,
    ),
  })
}

/** 改名：trim 后截断到 DECK_NAME_MAX 个字符，空名保持原名不变。id 不存在时原样返回。 */
export function renameDeck(platform: Platform, id: string, name: string): DecksData {
  const data = loadDecks(platform)
  const target = data.decks.find((deck) => deck.id === id)
  if (target === undefined) return data
  const next = clampName(name, target.name)
  return commit(platform, {
    ...data,
    decks: data.decks.map((deck) => (deck.id === id ? { ...deck, name: next } : deck)),
  })
}

/**
 * 新建一套空牌组并切过去（点「新建」就是要马上编辑它）。
 *
 * @param newId 生成一个新 id。由调用方给，这个模块就不用碰时钟和随机数
 * @returns 写回后的存档；已经有 MAX_DECKS 套时不新建，返回 null 让调用方提示上限
 */
export function createDeck(platform: Platform, newId: () => string): DecksData | null {
  const data = loadDecks(platform)
  if (data.decks.length >= MAX_DECKS) return null
  const deck: SavedDeck = {
    id: uniqueId(data.decks, newId),
    name: nextDeckName(data.decks),
    cards: [],
  }
  return commit(platform, { decks: [...data.decks, deck], currentId: deck.id })
}

/**
 * 删掉一套牌组。id 不存在时原样返回。
 *
 * 删的是当前牌组就切到剩下的第一套；删到一套不剩会自动补一套空的「新牌组」，
 * 因为构筑页没有「没有牌组」这个状态可画。
 */
export function deleteDeck(platform: Platform, id: string, newId: () => string): DecksData {
  const data = loadDecks(platform)
  if (!data.decks.some((deck) => deck.id === id)) return data
  const decks = data.decks.filter((deck) => deck.id !== id)
  const [firstLeft] = decks
  if (firstLeft === undefined) {
    const fresh: SavedDeck = { id: uniqueId([], newId), name: DEFAULT_DECK_NAME, cards: [] }
    return commit(platform, { decks: [fresh], currentId: fresh.id })
  }
  const currentId = decks.some((deck) => deck.id === data.currentId) ? data.currentId : firstLeft.id
  return commit(platform, { decks, currentId })
}

/**
 * 按固定 id 写入一套牌组并切成当前牌组：已存在就整套覆盖，不存在就新建。
 *
 * 只有新手教程在用（组牌教学要有一套 id 稳定、可以反复重玩覆盖的牌组）。
 * 普通的新建走 createDeck——那条路每次都发新 id，重玩教程会把牌组列表堆满。
 *
 * 覆盖已存在的那套时不动它在列表里的位置，玩家重玩教程不会看到牌组顺序跳一下。
 * 已经满 MAX_DECKS 套又要新建时，挤掉列表最前面那套：这只可能发生在
 * 「玩家自己攒够 12 套之后又从头玩一遍教程」，为这个边角保留一条更复杂的规则不值当。
 */
export function putDeck(
  platform: Platform,
  id: string,
  name: string,
  cards: readonly CardId[],
): DecksData {
  const data = loadDecks(platform)
  const deck: SavedDeck = {
    id,
    name: clampName(name, DEFAULT_DECK_NAME),
    cards: sanitizeCards(cards),
  }
  const existing = data.decks.some((item) => item.id === id)
  const decks = existing
    ? data.decks.map((item) => (item.id === id ? deck : item))
    : [...data.decks, deck]
  while (decks.length > MAX_DECKS) decks.shift()
  return commit(platform, { decks, currentId: id })
}

/** 切换当前牌组。id 不存在时原样返回（不会把 currentId 指飞）。 */
export function setCurrentDeck(platform: Platform, id: string): DecksData {
  const data = loadDecks(platform)
  if (!data.decks.some((deck) => deck.id === id)) return data
  return commit(platform, { ...data, currentId: id })
}

/** 挑一个没被占用的默认名：新牌组、新牌组 2、新牌组 3……。 */
function nextDeckName(decks: readonly SavedDeck[]): string {
  const used = new Set(decks.map((deck) => deck.name))
  if (!used.has(DEFAULT_DECK_NAME)) return DEFAULT_DECK_NAME
  // 已有牌组不超过 MAX_DECKS 套，试到 MAX_DECKS + 1 必定能找到空序号。
  for (let n = 2; n <= MAX_DECKS + 1; n += 1) {
    const name = `${DEFAULT_DECK_NAME} ${n}`
    if (!used.has(name)) return name
  }
  return DEFAULT_DECK_NAME
}

/**
 * 摇一个没被占用的 id。
 *
 * 调用方给的生成器可能撞车（时间戳 + 随机后缀在同一毫秒里能撞，测试里的桩更是必撞），
 * 撞了就再摇；连撞十次基本不可能，兜底用序号扫一个必然空着的 id 出来。
 */
function uniqueId(decks: readonly SavedDeck[], newId: () => string): string {
  const used = new Set(decks.map((deck) => deck.id))
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = newId()
    if (!used.has(id)) return id
  }
  let index = decks.length
  while (used.has(`deck-${index}`)) index += 1
  return `deck-${index}`
}
