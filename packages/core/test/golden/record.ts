/**
 * 录 golden：把 GOLDEN_CONFIGS 里那几局用随机走局器打完，指令和事件流写成 JSON。
 *
 * 跑法：`pnpm --filter @ai-duel/core golden:record`
 *
 * **golden 是提交进仓库的，不要顺手重录。** 回放测试红了先看差异是不是规则真的改了，
 * 确认这次规则改动是有意的之后才重录、把新的 JSON 一起提交（完整流程见 test/README.md）。
 *
 * 录制本身是确定性的：同一份代码和内容数据重录一遍应当零 diff，
 * 这一条由验收命令 `golden:record && git status --short` 守着。
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OPEN_SKILL_CARD_IDS, PLAYABLE_AI_CARD_IDS } from '@ai-duel/content'
import type { CardId, GameEvent } from '../../src/index'
import { contentHashFor, GOLDEN_CONFIGS, type GoldenGame, setupOf } from '../helpers/goldenGames'
import { playRandomGame } from '../helpers/randomPlay'

const GOLDEN_DIR = dirname(fileURLToPath(import.meta.url))

/** 这一局里真正被**从手上打出去**的卡。升降级换来的卡面不算——那不是"打出一次"。 */
function playedCards(events: GameEvent[]): CardId[] {
  const played: CardId[] = []
  for (const event of events) {
    if (event.type === 'AI_DEPLOYED') played.push(event.ai.cardId)
    if (event.type === 'SKILL_PLAYED') played.push(event.cardId)
  }
  return played
}

function record(): void {
  const covered = new Set<CardId>()
  for (const config of GOLDEN_CONFIGS) {
    const setup = setupOf(config)
    // illegalRate 0：golden 里只放合法指令，非法指令那条路由属性测试守着。
    const play = playRandomGame(config.seed, { setup, illegalRate: 0 })
    if (play.exhausted) throw new Error(`${config.name}：撞上步数上限还没打完`)

    const game: GoldenGame = {
      name: config.name,
      note: config.note,
      contentHash: contentHashFor(setup.questionIds),
      setup,
      initialEvents: play.initialEvents,
      steps: play.steps.map((step) => ({ command: step.command, events: step.events })),
    }
    const events = [...play.initialEvents, ...play.steps.flatMap((s) => s.events)]
    for (const cardId of playedCards(events)) covered.add(cardId)

    writeFileSync(join(GOLDEN_DIR, `${config.name}.json`), `${JSON.stringify(game, null, 2)}\n`)
    const scores = play.final.players.map((p) => p.score).join(':')
    console.log(
      `${config.name.padEnd(24)} ${String(play.steps.length).padStart(3)} 步  ` +
        `${play.final.round} 轮  比分 ${scores}  胜者 ${play.final.winner}`,
    )
  }

  // 6.3 的内容覆盖：每张已启用的牌至少被打出一次。缺了就调 seed 或者专门排一局，
  // 别把这条检查删掉——它是"新加的牌没人测"这件事唯一的机械防线。
  const missing = [...PLAYABLE_AI_CARD_IDS, ...OPEN_SKILL_CARD_IDS].filter((id) => !covered.has(id))
  if (missing.length > 0) {
    throw new Error(
      `这几张已启用的牌一局都没被打出来：${missing.join('、')}\n` +
        '改 test/helpers/goldenGames.ts 里的 seed 或牌组，直到全部覆盖（做法见 test/README.md）。',
    )
  }
  console.log(`\n覆盖 ${covered.size} 张牌，已启用的牌全部打出过。`)
}

record()
