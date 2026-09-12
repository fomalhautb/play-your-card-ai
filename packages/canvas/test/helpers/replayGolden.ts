/**
 * 把 `packages/core/test/golden/` 里录好的几局重放成「一条指令一批事件」，喂给演出编排层。
 *
 * 为什么直接读 core 的 golden 而不另录一份：那几局是引擎的总账（见 core 的 test/README.md），
 * 已经保证「整局打下来每一条事件的每一个字段都是原来那样」。演出编排要的正是这份事件流，
 * 再录一份只会多出一处会和引擎悄悄脱节的数据。
 * 文件是**读进来**的不是 import 进来的：跨包只走包入口那条规矩管的是模块图，
 * 而这里要的是几个 JSON 数据文件，import 它们会把几十万字的卡面文案拖进类型检查。
 *
 * 事件先过一遍 `filterEvent`：编排层跑在客户端，看到的永远是裁剪之后的那一份
 *（对手抽的牌没有牌面、被拒的指令只回给发指令方）。不过滤就等于拿服务端的上帝视角去测。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QUESTION_POOL } from '@ai-duel/content'
import type {
  CardId,
  Command,
  GameEvent,
  GameState,
  HeroId,
  PlayerId,
  PlayerView,
  Question,
} from '@ai-duel/core'
import { createGame, execute, filterEvent, viewFor } from '@ai-duel/core'
import { CATALOG } from './directorFixtures'

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../core/test/golden')

interface GoldenSide {
  name: string
  deck: CardId[]
  hero: HeroId | null
}

/** golden 文件里那份可 JSON 序列化的开局描述，字段对齐 core 的 `PlaySetup`。 */
interface GoldenSetup {
  seed: number
  players: [GoldenSide, GoldenSide]
  questionIds: string[]
  firstPlayer?: PlayerId
  noShuffle?: boolean
}

export interface GoldenGame {
  name: string
  setup: GoldenSetup
  steps: { command: Command }[]
}

/** 驱动一次 execute 的产出：这一批事件，加上它之后那一方能看到的视图。 */
export interface Batch {
  events: GameEvent[]
  view: PlayerView
}

const QUESTIONS_BY_ID = new Map<string, Question>(QUESTION_POOL.map((q) => [q.id, q]))

function questionById(id: string): Question {
  const question = QUESTIONS_BY_ID.get(id)
  if (question === undefined) throw new Error(`题库里没有这道题：${id}`)
  return question
}

/** 按文件名字母序读全部 golden，顺序固定，快照才稳。 */
export function loadGoldenGames(): GoldenGame[] {
  return readdirSync(GOLDEN_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const raw = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf8')) as Omit<
        GoldenGame,
        'name'
      >
      return { ...raw, name: file.replace(/\.json$/, '') }
    })
}

/** 把一局重放成某一方看到的事件批序列。第一批是开局事件。 */
export function batchesOf(golden: GoldenGame, seat: PlayerId): Batch[] {
  const started = createGame({
    seed: golden.setup.seed,
    catalog: CATALOG,
    questionPool: QUESTION_POOL,
    questions: golden.setup.questionIds.map(questionById),
    players: [{ ...golden.setup.players[0] }, { ...golden.setup.players[1] }],
    firstPlayer: golden.setup.firstPlayer,
    noShuffle: golden.setup.noShuffle,
  })

  const batches: Batch[] = []
  const record = (events: GameEvent[], state: GameState) => {
    const visible: GameEvent[] = []
    for (const event of events) {
      const filtered = filterEvent(event, seat)
      if (filtered !== null) visible.push(filtered)
    }
    batches.push({ events: visible, view: viewFor(state, seat) })
  }

  record(started.events, started.state)
  let state = started.state
  for (const step of golden.steps) {
    const result = execute(state, step.command)
    state = result.state
    record(result.events, state)
  }
  return batches
}
