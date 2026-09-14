/**
 * 目录页那条对局条目的**脚本化对局**：一份最小卡池、一串定死的指令、一台把三者串起来的驱动。
 *
 * 只服务 `DuelScene.stories.ts`。为什么不用真卡池：`canvas` 不许依赖 `content`
 *（依赖方向见《正式版架构》7.2 第 1 条），而目录页要的只是「一局每次跑都一模一样的对战」，
 * 六张牌够了。牌的 id 用真图集里的贴图名——「id 即文件名」那条约定（见 cardVisuals.ts）
 * 让它们直接查得到卡面。
 *
 * 确定性靠三样：`noShuffle` 让牌序完全由牌组数组决定，`firstPlayer` 跳过抛硬币那次随机，
 * 指令按**虚拟时刻**发（不是「等上一段演完再发下一条」）。于是同一个关键帧每次都停在同一画面上。
 */

import type { AnswerResult, Catalog, Command, GameState, PlayerId, Question } from '@ai-duel/core'
import { createGame, execute, filterEvent, viewFor } from '@ai-duel/core'
import type { Cue } from '../../director/cues'
import { createDirector, type Director } from '../../director/director'
import { Rng } from '../../runtime/rng'
import type { MountedDuelScene } from './DuelScene'

/** 六张 AI 牌。id 取自真图集里的贴图名，卡名和费用是这条条目自己编的。 */
const CARD_IDS = ['gpt-4o', 'claude-5-sonnet', 'deepseek-r1', 'doubao', 'qwen', 'gemini'] as const
const CARD_NAMES = ['GPT-4o', 'Claude', 'DeepSeek', '豆包', '通义千问', 'Gemini'] as const

function makeCatalog(): Catalog {
  const cards: Catalog['cards'] = {}
  CARD_IDS.forEach((id, index) => {
    cards[id] = {
      kind: 'ai',
      id,
      name: CARD_NAMES[index] ?? id,
      model: CARD_NAMES[index] ?? id,
      skillName: '示例技能',
      skillText: '目录页用的占位说明。',
      openrouter: null,
      // 费用一律 1：开局 5 点 Token 才够这条脚本连打几张。
      tokenCost: 1,
      text: '目录页用的占位卡面文案。',
    }
  })
  /*
   * 英雄一个都不带。`Catalog.heroes` 的类型要求七位齐全，而这条条目双方都是 `hero: null`
   *（引擎因此一次都不会去查它），编七份假英雄只是为了让类型过关。
   * 这也是目录页拍不到侧栏英雄牌的原因——英雄原画第 33 条才搬进来。
   */
  return { cards, heroes: {} as Catalog['heroes'] }
}

export const STORY_CATALOG: Catalog = makeCatalog()

/**
 * 目录页这六张牌的卡面展示配置（费用圆章的圆心和插画主色）。
 *
 * 真对局读的是 `@ai-duel/content` 的 `CARD_FACES`，canvas 不许依赖 content，
 * 所以这里按这六张原画各配一份。不配的话整页的费用章都是兜底的卡种色（一片亮蓝），
 * 而这一条条目要拍的正是「卡面在真界面里长什么样」。
 * 圆心的数就是那六张原画的真值，从 content 的 `CARD_FACES` 抄过来。
 */
export const STORY_CARD_FACES: Record<
  string,
  { accent: string; costBadge: { x: number; y: number } }
> = {
  'gpt-4o': { accent: '#46584b', costBadge: { x: 10.7, y: 7.1 } },
  'claude-5-sonnet': { accent: '#87502d', costBadge: { x: 11.5, y: 7.1 } },
  'deepseek-r1': { accent: '#304e70', costBadge: { x: 10.7, y: 7.1 } },
  doubao: { accent: '#505b77', costBadge: { x: 10.7, y: 7.1 } },
  qwen: { accent: '#37646b', costBadge: { x: 11.0, y: 7.1 } },
  gemini: { accent: '#655580', costBadge: { x: 10.9, y: 8.1 } },
}

const STORY_QUESTION: Question = {
  id: 'story-q1',
  category: 'meme',
  text: '「咬人猫」到底咬不咬人？',
  keywords: ['谐音', '昵称'],
  answer: '不咬人',
  explanation: '那是一位 UP 主的网名，和猫咬不咬人没有关系。',
}

/**
 * 牌组。**抽牌是从数组末尾取的**（见 core 的 `GameSetup.noShuffle`），
 * 所以最先摸到的那几张要写在最后。
 */
const DECK = [...CARD_IDS, ...CARD_IDS, ...CARD_IDS].slice(0, 12)

/** 一条按虚拟时刻发的指令。 */
interface ScriptStep {
  atMs: number
  command: Command
}

/**
 * 这条条目演的一局。三个关键帧分别停在发牌完成、我方出牌飞到一半、结算层刚立起来。
 * 时刻是照着 `director/timings.ts` 那几段的长度排的，改那边的数字这里要跟着挪。
 */
export const STORY_FRAMES = {
  /**
   * 抛硬币 3.54 秒收尾，紧接着五张牌飞进扇形（0.4 + 4 × 0.12），4.5 秒时全部落位。
   * 要卡在 4.6 秒那条出牌指令**之前**，否则手上已经少一张、Token 也扣过了。
   */
  dealt: 4500,
  /** 4.6 秒发出的那张牌飞 0.65 秒，停在飞到一半那一拍。 */
  playing: 5000,
  /**
   * 6 秒我方结束出牌，轮到对方；这一帧停在那之后半秒。
   * 右下角那颗钮这时换成「催一催」（判据是 `DirectorLocks.waitingForFoe`，
   * 见 scenes/duel/input.ts 的 refresh），整局里只有这一段看得到它。
   */
  waiting: 6500,
  /** 7 秒双方都结束出牌 → 揭题 → 结算层立起来，8 秒时题面和第一张结果卡都在了。 */
  settling: 8000,
} as const

/** 第一张牌什么时候打出去。「出牌中」那一帧停在它起飞之后 0.4 秒。 */
const PLAY_AT = 4600

/** 我方（0 号座位）打第一张、结束出牌；对方直接结束出牌；随后一次性交卷。 */
function scriptOf(state: GameState): ScriptStep[] {
  const mine = state.players[0].hand[0]
  const steps: ScriptStep[] = []
  if (mine !== undefined) {
    steps.push({
      atMs: PLAY_AT,
      command: { type: 'PLAY_CARD', player: 0, instanceId: mine.instanceId },
    })
  }
  steps.push({ atMs: 6000, command: { type: 'END_PLAY', player: 0 } })
  steps.push({ atMs: 7000, command: { type: 'END_PLAY', player: 1 } })
  return steps
}

/** 交卷：场上每个单位各一条结果。我方那张答对，好让结算层有个「对」的判定可看。 */
function answersFor(state: GameState): AnswerResult[] {
  return [...state.players[0].board, ...state.players[1].board].map((ai) => ({
    instanceId: ai.instanceId,
    correct: ai.owner === 0,
    answer: ai.owner === 0 ? '不咬人' : '咬人',
    reasoning: ai.owner === 0 ? '那是个网名。' : '名字里有咬。',
  }))
}

export interface StoryDuel {
  /**
   * 推进到某个虚拟时刻。
   *
   * @param step 目录页那套帧循环推进一帧的入口（`ctx.step`）。补间必须靠它走——
   *   只有它会推 GSAP 的根时间线，而场景自己的 `advance` 只管虚拟时钟上的 cue。
   *   步长固定 100 毫秒：GSAP 的补间是按绝对时刻求值的，步长只影响中间采样到几帧，
   *   停在哪一刻的画面完全一样，所以这里取一个够粗的步长省渲染次数。
   */
  runTo(targetMs: number, step: (deltaMs: number) => void): void
}

/** 把脚本、编排层和场景接起来。 */
export function createStoryDuel(scene: MountedDuelScene, seat: PlayerId = 0): StoryDuel {
  const started = createGame({
    seed: 20260905,
    catalog: STORY_CATALOG,
    questionPool: [STORY_QUESTION],
    questions: [STORY_QUESTION],
    players: [
      { name: '你', deck: [...DECK], hero: null },
      { name: '对手', deck: [...DECK], hero: null },
    ],
    firstPlayer: 0,
    noShuffle: true,
  })

  let state = started.state
  const director: Director = createDirector({ seat, rng: new Rng(7) })
  const pending = scriptOf(state)
  /** 交卷排在双方结束出牌之后一点：那时引擎已经进了答题阶段，指令才收得下。 */
  let answersSent = false
  let elapsed = 0

  const feed = (events: Parameters<Director['push']>[0]['events']): void => {
    const visible = events.map((event) => filterEvent(event, seat)).filter((one) => one !== null)
    director.push({ events: visible, view: viewFor(state, seat) })
    scene.applyView(viewFor(state, seat))
  }

  const run = (command: Command): void => {
    const result = execute(state, command)
    state = result.state
    feed(result.events)
  }

  feed(started.events)

  const drain = (): void => {
    const cues: Cue[] = director.drain()
    if (cues.length > 0) scene.play(cues)
    scene.setLocks(director.locks())
  }
  drain()

  return {
    runTo(targetMs, step) {
      const stepMs = 100
      while (elapsed < targetMs) {
        elapsed += stepMs
        while (pending.length > 0 && pending[0]!.atMs <= elapsed) {
          run(pending.shift()!.command)
        }
        if (!answersSent && state.phase === 'quiz') {
          answersSent = true
          run({ type: 'SUBMIT_ANSWERS', results: answersFor(state) })
        }
        director.advance(stepMs)
        drain()
        step(stepMs)
      }
    },
  }
}
