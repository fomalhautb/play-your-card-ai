/**
 * 一份**假的**场景上下文：每个方法都只记一笔「谁被调了」。
 *
 * 给 cue 播放器的覆盖测试用（test/duelCuePlayers.test.ts）。目的只有一个——
 * 确认每一种 cue 都真的动了某个组件，而不是掉进空分支。所以这里不模拟任何行为，
 * 也不关心参数：那些是各条 cue 自己的事，真要断言具体行为得起画布，那是截图回归的活。
 *
 * 组件用假的而不是真的，是因为真组件要渲染器、要烤纹理、要 GPU，而这条检查是纯逻辑的：
 * 「表里有没有漏一条」和「这一条有没有接上组件」不需要看画面。
 */

import type { Catalog } from '@ai-duel/core'
import { Texture } from 'pixi.js'
import type { DuelContext } from '../../src/scenes/duel/context'
import { desktopLayout } from '../../src/scenes/duel/layout/desktopLayout'

/** 一次记录：调了谁。 */
export interface FakeCalls {
  names: string[]
  clear(): void
}

/** 造一组只会记账的方法。 */
function recorder(calls: string[], prefix: string, methods: readonly string[], result?: unknown) {
  const out: Record<string, unknown> = {}
  for (const name of methods) {
    out[name] = (..._args: unknown[]) => {
      calls.push(`${prefix}.${name}`)
      return result
    }
  }
  return out
}

/** 假的卡：cue 播放器只会读它的实例 id、改它的位置、最后销毁它。 */
function fakeCard(calls: string[], id: string) {
  return {
    instanceId: id,
    x: 0,
    y: 0,
    alpha: 1,
    scale: { x: 1, y: 1, set: () => undefined },
    position: { set: () => undefined },
    destroy: () => calls.push('card.destroy'),
  }
}

/** 一份够 cue 播放器跑起来的最小卡池：一张 AI 牌、一张技能牌。 */
const FAKE_CATALOG: Catalog = {
  cards: {
    'fake-ai': {
      kind: 'ai',
      id: 'fake-ai',
      name: '假模型',
      model: 'fake',
      skillName: '假技能',
      skillText: '假',
      openrouter: null,
      tokenCost: 1,
      text: '假',
    },
    'fake-skill': { kind: 'skill', id: 'fake-skill', name: '假技能牌', tokenCost: 1, text: '假' },
  },
  heroes: {},
} as unknown as Catalog

export function createFakeDuelContext(): { ctx: DuelContext; calls: FakeCalls } {
  const names: string[] = []
  const tile = { setHeld: () => names.push('tile.setHeld'), instanceId: 'u1' }

  const parts = {
    banner: recorder(names, 'banner', ['show', 'clear']),
    coin: recorder(names, 'coin', ['play', 'clear']),
    cancel: recorder(names, 'cancel', ['play', 'clear']),
    targeting: recorder(names, 'targeting', ['end']),
    settle: recorder(names, 'settle', [
      'open',
      'addRow',
      'revealAnswer',
      'typeRow',
      'stamp',
      'showCounts',
      'showScore',
      'enableConfirm',
      'exit',
      'clear',
    ]),
    reveal: recorder(names, 'reveal', ['enter', 'hold', 'landTo', 'fade', 'abort', 'showCaption']),
    board: {
      ...recorder(names, 'board', ['popIn', 'remove', 'clearTargets', 'setMark', 'place', 'ids']),
      tile: () => {
        names.push('board.tile')
        return tile
      },
      transform: () => {
        names.push('board.transform')
        return fakeCard(names, 'old')
      },
    },
    foeHand: {
      count: 4,
      setCount: () => names.push('foeHand.setCount'),
      takeCard: () => {
        names.push('foeHand.takeCard')
        return { x: 10, y: 20 }
      },
      x: 0,
      y: 0,
    },
    fan: {
      ...recorder(names, 'fan', ['insert', 'layout', 'remove']),
      all: () => [],
    },
    hitFx: recorder(names, 'hitFx', ['play']),
    layers: {
      drag: { addChild: () => names.push('drag.addChild') },
      bubble: {
        removeChildren: () => {
          names.push('bubble.removeChildren')
          return []
        },
        addChild: () => names.push('bubble.addChild'),
      },
    },
  }

  const ctx = {
    seat: 0,
    catalog: FAKE_CATALOG,
    visuals: { visualOf: () => ({}), missing: () => [] },
    deps: {
      animator: recorder(names, 'animator', ['tween', 'killTweensOf', 'fromTo']),
      /*
       * 提示气泡那两条 cue 会真的建一个 `Bubble`（它是组件，画不画得出来不归 cue 播放器管），
       * 而 `Bubble` 里的文字要过一次纹理缓存。缓存这里给一张空纹理顶上：
       * 这条检查只问「有没有接上组件」，不看画面。
       */
      text: { get: () => Texture.EMPTY },
    },
    stage: {},
    parts,
    layout: desktopLayout(1920, 1080),
    view: null,
    leaving: new Map(),
    pendingHand: [{ instanceId: 'h1', cardId: 'fake-ai' }],
    pendingFoeDeal: 0,
    doomedTiles: new Set<string>(),
    hiddenTiles: new Set<string>(),
    handCardIds: new Map([['h1', 'fake-ai']]),
    markKeys: new Map<string, string>(),
    locks: new Set<number>(),
    showcased: null,
    inspectingTile: 'u1',

    makeCard: (_cardId: string, id: string) => {
      names.push('makeCard')
      return fakeCard(names, id)
    },
    tilePoint: () => {
      names.push('tilePoint')
      return { x: 100, y: 100, scale: 0.7, width: 110, height: 165 }
    },
    cardIdOf: () => 'fake-ai',
    after: (_delayMs: number, run: () => void) => {
      names.push('after')
      // 排下的收尾当场跑掉：这条检查只关心「有没有接上组件」，
      // 而好几条 cue 的收尾（销毁展示卡、露出格子）正是它真正干的活。
      run()
    },
    deckPose: () => ({ x: 0, y: 0, rotation: 0, scale: 0.3 }),
    bindHandCard: () => names.push('bindHandCard'),
    bindTile: () => names.push('bindTile'),
    wake: () => names.push('wake'),
    userAction: () => names.push('userAction'),
    command: () => names.push('command'),
    tutorial: () => names.push('tutorial'),
    refreshLocks: () => names.push('refreshLocks'),
  }

  return {
    ctx: ctx as unknown as DuelContext,
    calls: {
      names,
      clear() {
        names.length = 0
      },
    },
  }
}
