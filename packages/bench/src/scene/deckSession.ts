/**
 * 把**构筑页**场景包成剧本认得的样子。
 *
 * 和 `duelSession.ts` 是同一个位置的两块砖：那边要开一局真对局（引擎 + 编排层 + 渲染器），
 * 这边简单得多——构筑页没有引擎也没有演出，只有「一份卡池 + 一套牌组」进去、
 * 「玩家点了什么」出来（契约见 canvas 的 scenes/deckContract.ts）。
 *
 * 剧本要说的是「翻三页」「拖两张」，而场景认得的是 `turnPage` 和那三个合成指针入口，
 * 中间这一层就是这个文件。
 *
 * 确定性（6.9 的前提）靠三样：卡池写死、牌组从空开始、每一下动作之间按**帧数**等，
 * 不按墙钟等。所以同一段剧本跑两遍，逐帧记录一模一样。
 */

import { createDeckScene, type DeckScene, type PoolCard } from '@ai-duel/canvas'
import { DECK } from '../node/profiles'
import type { BenchDeckActions, BenchScene, BenchSceneOptions } from './contract'
import { BENCH_CARD_FACES, BENCH_CATALOG } from './duelScript'

/** 热身那一遍每帧按多少倍步长推。同 duelSession。 */
const WARMUP_SPEED = 15

/**
 * 每一下动作之间等几帧。45 帧 ≈ 0.75 秒。
 *
 * 按**真人的节奏**取，不是「够画面重排完就行」（那只要五六帧）。
 * 6.9 那条「稳态每帧堆分配」是拿一段剧本的总分配除以动作期间的帧数算的，
 * 而翻一页、拖一张这种事本身带一笔一次性开销（新的一屏卡要摆位、页码那行字要烤一次）。
 * 剧本要是压成三百毫秒翻完三页，量到的就全是那几笔一次性开销，
 * 而没有人会那样用这一页——现实里那是好几秒的事。
 */
const SETTLE_FRAMES = 45
/** 一次拖拽分几步走、每步停几帧。8 × 2 帧 ≈ 0.27 秒，和真人划一下的时长相当。 */
const DRAG_STEPS = 8
const DRAG_STEP_FRAMES = 2

/**
 * 剧本用的卡池：`profiles.ts` 那 18 个贴图名，全按 AI 牌算，一张都不锁。
 *
 * 只用 models 那一组图集里的牌（技能牌那组不装，纪律 3.4），所以「常驻纹理内存」这条
 * 和对局那几段量的是同一批纹理，历史数字可以横着比。
 * 阵营按 id 前缀分，和 content 的 `factionForAi` 同一条规则——那份是正本，这里只是抄。
 */
const BENCH_POOL: readonly PoolCard[] = DECK.map((cardId) => ({
  cardId,
  kind: 'ai' as const,
  faction: factionOf(cardId),
  blockedReason: null,
}))

function factionOf(cardId: string): string {
  if (cardId.startsWith('gpt-') || cardId.startsWith('chatgpt-')) return 'gpt'
  if (cardId.startsWith('claude-')) return 'claude'
  if (cardId.startsWith('kimi-')) return 'kimi'
  if (cardId.startsWith('deepseek-')) return 'deepseek'
  return 'other'
}

const BENCH_FACTIONS = [
  { id: 'gpt', label: 'GPT' },
  { id: 'claude', label: 'Claude' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'other', label: '其他' },
]

/** 一开始就一套空牌组。拖进去的那两张是这段剧本唯一的改动。 */
const EMPTY_DECK = [{ id: 'bench-deck', name: '剧本牌组', cards: [] }]

export async function createDeckSession(options: BenchSceneOptions): Promise<BenchScene> {
  const scene: DeckScene = await createDeckScene({
    canvas: options.canvas,
    width: options.width,
    height: options.height,
    resolution: options.resolution,
    tier: options.tier,
    textures: options.textures,
    cardFaces: BENCH_CARD_FACES,
    catalog: BENCH_CATALOG,
    pool: BENCH_POOL,
    factions: BENCH_FACTIONS,
    decks: EMPTY_DECK,
    currentId: 'bench-deck',
    seed: options.seed,
    manualClock: options.manualClock,
  })

  let warm = false
  /** 等着「再推几帧」的那些动作。每帧末尾各减一。 */
  let waiters: { frames: number; resolve: () => void }[] = []
  /** 抽屉开着没有。手机档一进来是收着的，牌组栏那一片够不着（见 canvas 的 deck/input.ts）。 */
  let drawerOpen = false

  /** 等 n 帧。**按帧数等而不是按空闲等**：这一页大部分时候本来就是空闲的。 */
  function afterFrames(frames: number): Promise<void> {
    return new Promise((resolve) => waiters.push({ frames, resolve }))
  }

  /**
   * 一次拖拽：从 `from` 分几步挪到 `to` 再松手。
   * 中间每一步都等一帧——真指针本来就是一帧来一下，一口气挪过去量到的不是任何真实情况。
   */
  async function dragOnce(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<void> {
    scene.pressAt(from.x, from.y)
    await afterFrames(DRAG_STEP_FRAMES)
    for (let step = 1; step <= DRAG_STEPS; step += 1) {
      const t = step / DRAG_STEPS
      scene.moveTo(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)
      await afterFrames(DRAG_STEP_FRAMES)
    }
    scene.releaseAt(to.x, to.y)
    await afterFrames(SETTLE_FRAMES)
  }

  const deck: BenchDeckActions = {
    async turnPages(count) {
      for (let page = 0; page < count; page += 1) {
        scene.turnPage(1)
        await afterFrames(SETTLE_FRAMES)
      }
    },

    async dragCards(count) {
      const points = dragPointsOf(options)
      for (let index = 0; index < count; index += 1) {
        /*
         * 手机档：抓起卡池那张牌时抽屉会**自己升起来**（见 canvas 的 deck/input.ts），
         * 而它放完不会自动收回去。下一张要从卡池抓，所以先把它收回去——
         * 真玩家也是这么做的：抽屉盖着卡池，想再挑一张就得先收起来。
         */
        if (points.mobile && drawerOpen) {
          drawerOpen = false
          scene.toggleDrawer()
          await afterFrames(SETTLE_FRAMES)
        }
        await dragOnce(points.from(index), points.to())
        if (points.mobile) drawerOpen = true
      }
    },
  }

  return {
    deck,

    /** 回到「刚进这一页」的样子：牌组清空、卡池翻回第一页、抽屉收起来。 */
    async restart() {
      scene.applyDecks(EMPTY_DECK, 'bench-deck')
      // 往回翻得比总页数还多，`turnPage` 自己会夹回第一页。
      scene.turnPage(-99)
      if (drawerOpen) {
        drawerOpen = false
        scene.toggleDrawer()
      }
      await afterFrames(SETTLE_FRAMES)
    },

    /*
     * 下面这三件事**构筑页没有**：这一页不出牌、没有战场、也没有回合结算。
     * 契约是对局那边先定下来的（见 contract.ts），这里照实答「什么都没发生」，
     * 而不是假装演一段——剧本按 `Scenario.scene` 挑场景，不会拿错。
     */
    async playCards() {
      return
    },
    async inspect() {
      return
    },
    async settleRound() {
      return
    },

    setWarmup(next) {
      warm = next
    },

    step(deltaMs) {
      const delta = warm ? deltaMs * WARMUP_SPEED : deltaMs
      scene.step(delta)
      if (waiters.length === 0) return
      const pending = waiters
      waiters = []
      for (const one of pending) {
        if (one.frames <= 1) one.resolve()
        else waiters.push({ frames: one.frames - 1, resolve: one.resolve })
      }
    },

    isIdle: () => scene.isIdle() && waiters.length === 0,
    // 构筑页发不出对局指令，也没有手牌。两条都是对局那边的契约，这里恒为空。
    commands: () => [],
    handCards: () => [],
    counters: () => scene.counters(),
    resize: (width, height) => scene.resize(width, height),
    destroy: () => scene.destroy(),
  }
}

/**
 * 拖拽的起点和落点。
 *
 * 按**版式现算**而不是写死：两档的卡池和牌组栏差得远（桌面左右分、手机上下分），
 * 写死一组坐标只有一档对得上。这里不 import 版式函数，而是按视口自己推——
 * 剧本只要「卡池里的一张」和「牌组栏里的一格」，不需要精确到某一格。
 */
function dragPointsOf(options: BenchSceneOptions) {
  // 判据和版式那边同一条（短边窄于断点走手机档，见 canvas 的 scenes/duel/layout/pickLayout.ts）。
  const mobile = Math.min(options.width, options.height) < 768
  return {
    mobile,
    /** 卡池第一行第 index 张附近。 */
    from: (index: number) => ({
      x: options.width * (mobile ? 0.2 + index * 0.3 : 0.15 + index * 0.2),
      y: options.height * (mobile ? 0.35 : 0.35),
    }),
    /** 牌组栏里靠上那一带。手机档抽屉展开之后铺满下面九成屏，桌面档在右侧。 */
    to: () => ({
      x: options.width * (mobile ? 0.3 : 0.85),
      y: options.height * (mobile ? 0.45 : 0.4),
    }),
  }
}
