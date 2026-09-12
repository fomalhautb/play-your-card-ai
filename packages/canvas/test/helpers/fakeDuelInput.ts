/**
 * 给交互测试用的一份**假**场景上下文：手牌扇形、战场、选目标层都换成只记账的替身。
 *
 * 和 `fakeDuelContext.ts` 分开写，因为两边要的东西正相反：那边测「每种 cue 有没有接上组件」，
 * 替身只要能被调到就行；这边测「一次拖拽最后发出了什么指令」，所以真正要留着的是
 * **版式的几何**（落区在哪、手牌锚点在哪）和**视图**（哪张牌能打谁），组件反而无所谓。
 *
 * 版式用的是真的 `desktopLayout(1280, 800)`：落区坐标是拖拽判定的输入之一，
 * 拿假数字喂进去等于测了一套现实里不存在的版式。
 */

import type { Catalog, HeroId, InstanceId, PlayerView } from '@ai-duel/core'
import type { BoardTile } from '../../src/components/BoardTile'
import type { CardSprite } from '../../src/components/CardSprite'
import type { DirectorLocks, UserAction } from '../../src/director/director'
import type { DuelContext } from '../../src/scenes/duel/context'
import { desktopLayout } from '../../src/scenes/duel/layout/desktopLayout'
import type { DuelCommand } from '../../src/scenes/duelContract'

/** 测试用的视口。短边 800 ≥ 断点 768，所以走桌面档。 */
const FAKE_SIZE = { width: 1280, height: 800 }

/**
 * 一份最小卡池：一张 AI 牌、三张技能牌。
 * 技能牌的 `target` 是 `skillTargets.ts` 唯一的分档依据，这里覆盖「无目标 / 打对面场上 /
 * 打自己手牌」三条分支——`own-ai` 和 `own-affected-ai` 走的是和 `foe-ai` 同一条战场分支。
 */
const INPUT_CATALOG: Catalog = {
  cards: {
    ai: {
      kind: 'ai',
      id: 'ai',
      name: '假模型',
      model: 'fake',
      skillName: '假技能',
      skillText: '假',
      openrouter: null,
      tokenCost: 1,
      text: '假',
    },
    /*
     * 老一代的假模型，`evolvesTo` 指着上面那张。
     *
     * 英雄技能的候选名单是「这个单位升（降）得动吗」，而这一条最终问的是
     * core 的 `upgradeTargetOf` / `downgradeTargetOf`，也就是卡定义上有没有 `evolvesTo`。
     * 所以这份卡池必须有一条真的两代链，否则「有合法目标」那一档根本摆不出来。
     * 反过来，只带 `ai` 的场上单位就天然是「升不动也降不动」，正好当反例用。
     */
    'ai-old': {
      kind: 'ai',
      id: 'ai-old',
      name: '假模型（旧）',
      model: 'fake-old',
      skillName: '假技能',
      skillText: '假',
      openrouter: null,
      tokenCost: 1,
      text: '假',
      evolvesTo: 'ai',
    },
    plain: { kind: 'skill', id: 'plain', name: '无目标技能', tokenCost: 1, text: '假' },
    'hit-foe': {
      kind: 'skill',
      id: 'hit-foe',
      name: '打对面',
      tokenCost: 1,
      text: '假',
      target: 'foe-ai',
    },
    distill: {
      kind: 'skill',
      id: 'distill',
      name: '模型蒸馏',
      tokenCost: 1,
      text: '假',
      target: 'own-hand-ai',
    },
  },
  heroes: {},
} as unknown as Catalog

/** 一张能被指针状态机摆弄的假卡：它只会被读 id、改姿态、进出各层。 */
export interface FakeCard {
  instanceId: InstanceId
  x: number
  y: number
  alpha: number
  scale: { x: number; y: number; set(value: number): void }
  position: { set(x: number, y: number): void }
  on(): void
}

function fakeCard(instanceId: InstanceId): FakeCard {
  const card: FakeCard = {
    instanceId,
    x: 0,
    y: 0,
    alpha: 1,
    scale: {
      x: 1,
      y: 1,
      set(value: number) {
        card.scale.x = value
        card.scale.y = value
      },
    },
    position: {
      set(x: number, y: number) {
        card.x = x
        card.y = y
      },
    },
    on: () => undefined,
  }
  return card
}

/** 没有任何一把锁的那一档。测试按需覆盖其中一两条。 */
export function openLocks(overrides: Partial<DirectorLocks> = {}): DirectorLocks {
  return {
    showcasing: false,
    dealing: false,
    actionsLocked: false,
    handFrozen: false,
    waitingForFoe: false,
    quizWait: false,
    handLockReason: null,
    settleReady: false,
    ...overrides,
  }
}

interface ViewSpec {
  /** 我方手牌，按 `[实例 id, 卡牌 id]` 写。 */
  hand: [InstanceId, string][]
  /** 我方场上单位。 */
  board?: [InstanceId, string][]
  /** 对方场上单位。打 `foe-ai` 的技能牌选目标时亮的就是这些。 */
  foeBoard?: [InstanceId, string][]
  /**
   * 我方英雄。不给就是没选英雄，那时侧栏那颗「发动」钮压根不该出现。
   * 有主动技能的只有陈丹琦（升己方一个）和梅拉妮·珀金斯（降对方一个），
   * 判据见 skillTargets.ts 的 `heroSkillDirectionOf`。
   */
  hero?: HeroId
  /** 英雄技能这一局用过没有。用过之后钮由 applyView 撤走，这里只影响视图。 */
  heroSkillUsed?: boolean
}

export function fakeView(spec: ViewSpec): PlayerView {
  const unit = (owner: 0 | 1) => (entry: [InstanceId, string]) => ({
    instanceId: entry[0],
    cardId: entry[1],
    owner,
  })
  return {
    viewer: 0,
    catalog: INPUT_CATALOG,
    self: {
      id: 0,
      hand: spec.hand.map(([instanceId, cardId]) => ({ instanceId, cardId })),
      board: (spec.board ?? []).map(unit(0)),
      hero: spec.hero ?? null,
      heroSkillUsed: spec.heroSkillUsed ?? false,
    },
    opponent: { id: 1, handCount: 3, board: (spec.foeBoard ?? []).map(unit(1)) },
  } as unknown as PlayerView
}

/** 一格战场。`input.bindTile` 会往它身上挂 pointertap，测试再把那个回调调出来。 */
export interface FakeTile {
  instanceId: InstanceId
  eventMode: string
  cursor: string
  on(event: string, handler: () => void): void
  /** 点这一格。没被 bindTile 挂过监听就什么都不发生。 */
  tap(): void
}

export function fakeTile(instanceId: InstanceId): FakeTile {
  let tap: (() => void) | null = null
  return {
    instanceId,
    eventMode: 'none',
    cursor: 'default',
    on(event, handler) {
      if (event === 'pointertap') tap = handler
    },
    tap: () => tap?.(),
  }
}

/** 假上下文对外露出的那点观察窗口。 */
export interface InputProbe {
  ctx: DuelContext
  /** 场景发出去的指令，按先后顺序。 */
  commands: DuelCommand[]
  /** 场景发出去的玩家操作，按先后顺序。 */
  actions: UserAction[]
  /** 组件被调了什么，形如 `targeting.begin`、`board.highlightTargets(u1)`。 */
  calls: string[]
  /** 「结束出牌」现在灰不灰。null 表示 refresh 一次都没跑过。 */
  endPlayDisabled: boolean | null
  /** 「结束出牌」现在在不在场。等对方出牌时它整颗收起来。 */
  endPlayVisible: boolean | null
  /** 「对方回合」吊匾挂出来了没有。和「结束出牌」收起来是同一档锁切出来的。 */
  turnPlaqueOn: boolean | null
  /** 侧栏那颗英雄技能钮现在灰不灰。null 表示 refresh 一次都没跑过。 */
  heroSkillDisabled: boolean | null
  /** 手牌扇形里那几张假卡，顺序同视图里的手牌。 */
  cards: FakeCard[]
  /** 按实例 id 取一张手牌。 */
  card(instanceId: InstanceId): FakeCard
  /**
   * 点一下空白处：舞台上先来一次按下、再来一次 tap。
   * 真事件里这两下是同一次点击的两拍，选目标那道「要新按一次才算取消」的闸认的就是它们。
   */
  tapEmpty(): void
  /**
   * 点一下某一格：格子自己的 pointertap 先跑，再冒泡到舞台。
   * 分两步是照着 Pixi 的传播顺序来的——格子在 AT_TARGET，舞台在冒泡阶段。
   */
  tapTile(tile: FakeTile): void
  /** 只在舞台上发一次 tap，前面没有按下。用来验「松手那一下不算取消」。 */
  tapStageOnly(): void
}

export function createInputProbe(view: PlayerView): InputProbe {
  const commands: DuelCommand[] = []
  const actions: UserAction[] = []
  const calls: string[] = []
  const cards = view.self.hand.map((one) => fakeCard(one.instanceId))
  /** 被拖出扇形的那几张。`all()` 要照实排除它们，压暗候选牌那段才对得上。 */
  const detached = new Set<InstanceId>()
  const stageHandlers = new Map<string, () => void>()
  const fireStage = (event: string) => stageHandlers.get(event)?.()

  const fan = {
    all: () => cards.filter((card) => !detached.has(card.instanceId)),
    laid: () => cards.filter((card) => !detached.has(card.instanceId)),
    detach: (card: FakeCard) => {
      detached.add(card.instanceId)
      calls.push('fan.detach')
    },
    adoptInOrder: () => calls.push('fan.adoptInOrder'),
    returnToFan: (card: FakeCard) => {
      detached.delete(card.instanceId)
      calls.push('fan.returnToFan')
    },
    setHover: () => calls.push('fan.setHover'),
    remove: () => calls.push('fan.remove'),
  }

  const probe: InputProbe = {
    ctx: null as unknown as DuelContext,
    commands,
    actions,
    calls,
    endPlayDisabled: null,
    endPlayVisible: null,
    turnPlaqueOn: null,
    heroSkillDisabled: null,
    cards,
    card(instanceId) {
      const found = cards.find((one) => one.instanceId === instanceId)
      if (found === undefined) throw new Error(`手牌里没有 ${instanceId}`)
      return found
    },
    tapEmpty() {
      fireStage('pointerdown')
      fireStage('pointertap')
    },
    tapTile(tile) {
      fireStage('pointerdown')
      tile.tap()
      fireStage('pointertap')
    },
    tapStageOnly: () => fireStage('pointertap'),
  }

  const parts = {
    fan,
    layers: { drag: { addChild: () => calls.push('drag.addChild') } },
    targeting: {
      begin: (name: string) => calls.push(`targeting.begin(${name})`),
      end: () => calls.push('targeting.end'),
    },
    reveal: { on: () => undefined, removeAllListeners: () => undefined },
    board: {
      highlightTargets: (ids: InstanceId[]) =>
        calls.push(`board.highlightTargets(${ids.join(',')})`),
      clearTargets: () => calls.push('board.clearTargets'),
    },
    endPlay: {
      setDisabled: (disabled: boolean) => {
        probe.endPlayDisabled = disabled
      },
      set visible(value: boolean) {
        probe.endPlayVisible = value
      },
    },
    /*
     * 只有我方那一块面板：英雄技能钮只长在这一侧（对手的技能不归我发，见 applyView 的
     * syncHeroes）。`input.refresh` 每次都会去写它的灰态，所以这个替身不能少——
     * 少了它连一条和英雄技能无关的锁测试都会当场抛。
     */
    panels: {
      mine: {
        setHeroSkillDisabled: (disabled: boolean) => {
          probe.heroSkillDisabled = disabled
        },
      },
    },
    /*
     * 落点提示那两块和「对方回合」吊匾。
     *
     * 它们在真场景里是桌面档才有的（手机档 null），但这个替身走的是桌面档版式，
     * 所以照桌面档给：`setDropState` 每次拖拽都会写它俩的 visible，缺一个就当场抛。
     */
    dropCue: { visible: false },
    hotRing: { visible: false },
    turnPlaque: {
      setOn: (on: boolean) => {
        probe.turnPlaqueOn = on
      },
    },
  }

  probe.ctx = {
    seat: 0,
    catalog: INPUT_CATALOG,
    /*
     * 舞台。指针状态机挂在它身上的那几条（globalpointermove / pointerup）测试里用不到——
     * 合成入口 pressAt / moveTo / releaseAt 直接调状态机，不经过事件系统。
     * 留着 on/off 是为了 input.ts 挂在舞台上的「点空白处取消」那两条，见 tapEmpty。
     */
    stage: {
      on: (event: string, handler: () => void) => stageHandlers.set(event, handler),
      off: (event: string) => stageHandlers.delete(event),
    },
    parts,
    deps: {
      animator: {
        tween: () => calls.push('animator.tween'),
        killTweensOf: () => undefined,
      },
    },
    layout: desktopLayout(FAKE_SIZE.width, FAKE_SIZE.height),
    view,
    handCardIds: new Map(view.self.hand.map((one) => [one.instanceId, one.cardId])),
    locks: new Set<number>(),
    wake: () => undefined,
    userAction: (action: UserAction) => actions.push(action),
    command: (command: DuelCommand) => commands.push(command),
  } as unknown as DuelContext

  return probe
}

/** 把假卡当成真卡传给 `pressAt`。类型上的空档由这一处集中兜住。 */
export function asSprite(card: FakeCard): CardSprite {
  return card as unknown as CardSprite
}

/** 把假格子当成真格子传给 `bindTile`。 */
export function asTile(tile: FakeTile): BoardTile {
  return tile as unknown as BoardTile
}
