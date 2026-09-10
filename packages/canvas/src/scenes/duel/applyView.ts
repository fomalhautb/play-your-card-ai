/**
 * 局面 → 画面：一份 `PlayerView` 进来，把「该长成什么样」摆到位。
 *
 * 和 cue 播放器的分工写在 duelContract.ts 的文件头：这里管**结构**（手上有哪几张、
 * 场上站着谁、比分和 Token 是多少），cue 管**时机**。所以有两件事这里刻意**不**当场做：
 *
 * 1. 新抽到的牌不直接插进扇形，先排进 `pendingHand` 等 `deal` cue——
 *    不等的话开局那五张会在抛硬币的遮罩后面飞完。
 * 2. 新上场的单位格子建好但先藏着（`setHeld(true)`），等落地那条 cue 才露出来；
 *    已经不在视图里的格子先记进 `doomedTiles`，等 `removal-fx` 演完才真的摘掉。
 *
 * 没有任何 cue 来认领怎么办：`reconcile` 在「队列播空、动画也停了」那一刻兜底补上。
 * 中途接手一局（没有历史事件）、以及编排层明确不演的那几种事件走的就是这条路。
 */

import type { AiInstance, HeroId, PlayerSideView, PlayerView } from '@ai-duel/core'
import type { BoardSide } from '../../components/BoardGrid'
import { applyPose } from '../../components/HandFan'
import type { PlayerPanel } from '../../components/PlayerPanel'
import { killAndDestroy } from '../../runtime/dispose'
import type { DuelContext } from './context'
import { CATEGORY_LABELS } from './labels'
import { fanToWorld } from './layout/types'
import { heroSkillDirectionOf } from './skillTargets'
import { tileMarksOf } from './tileMarks'

/** 战场中线那枚徽章上印什么：这一轮到了哪一步。 */
function turnBadgeOf(view: PlayerView, seat: PlayerView['viewer']): string {
  if (view.phase === 'quiz') return '答题中'
  if (view.phase === 'settle') return '本轮结算'
  if (view.phase === 'finished') return '对局结束'
  return view.activePlayer === seat ? '轮到你出牌' : '对方出牌中'
}

/** 顶栏、侧栏、两块玩家面板、中线徽章。全是「数字变了就换一下」，不带动画。 */
function syncChrome(ctx: DuelContext, view: PlayerView): void {
  const { topBar, panels, sideBar, board } = ctx.parts
  topBar.setRound(view.round)
  topBar.setScore({ mine: view.self.score, theirs: view.opponent.score })
  panels.mine.setName(view.self.name)
  panels.mine.setScore(view.self.score)
  panels.mine.setTokens(view.self.tokens, view.self.tokenMax)
  panels.theirs.setName(view.opponent.name)
  panels.theirs.setScore(view.opponent.score)
  // 「下一题」纸匾只有桌面档的侧栏有；手机档折叠掉了它（见 mobileLayout 的文件头）。
  const question = view.questions[view.round - 1]
  // 纸匾上写的是译好的中文，组件自己不查表（见 SideBar.setNextCategory）。
  if (sideBar !== null && question !== undefined) {
    sideBar.setNextCategory(CATEGORY_LABELS[question.category])
  }
  board.setTurnBadge(turnBadgeOf(view, view.viewer))
}

/**
 * 两块面板上的英雄牌，以及我方那颗「发动技能」的钮。
 *
 * 英雄一局不会换，所以只在**第一次**（或者换档位重建之后）建那张牌：`heroSlot` 里已经
 * 有东西就不动它，否则每收到一条指令都会把原画重建一遍。
 * 那颗钮相反，要跟着视图变——技能一发完 `heroSkillUsed` 就为真，钮当场撤走。
 */
function syncHeroes(ctx: DuelContext, view: PlayerView): void {
  setHero(ctx, ctx.parts.panels.mine, view.self)
  setHero(ctx, ctx.parts.panels.theirs, view.opponent)

  // 只有我方那侧有这颗钮：对手的技能不归我发。
  const hero = view.self.hero
  const active = heroSkillDirectionOf(hero) !== null && !view.self.heroSkillUsed
  ctx.parts.panels.mine.setHeroSkill(
    active && hero !== null
      ? { caption: skillNameOf(ctx, hero), onActivate: () => ctx.beginHeroSkill() }
      : null,
  )
}

/** 匾上印技能名而不是「发动」：玩家得知道按下去要发动的是什么（同旧版）。 */
function skillNameOf(ctx: DuelContext, heroId: HeroId): string {
  return ctx.catalog.heroes[heroId]?.skillName ?? '发动技能'
}

/** 一侧的英雄牌。已经摆过就不动——原画一局不换，重建一遍纯属白传一次显存。 */
function setHero(ctx: DuelContext, panel: PlayerPanel, side: PlayerSideView): void {
  if (side.hero === null || panel.hasHero()) return
  panel.setHero(ctx.makeHero(side.hero))
}

/**
 * 手牌：走了的摘下来存进 `leaving`，新来的排进 `pendingHand`。
 *
 * 摘下来的那张**不销毁**：出牌那一批事件和新视图是同一拍到的，
 * `play-flip` / `skill-showcase` 还得拿它从手上飞出去（见 cuePlayers/hand.ts）。
 */
function syncHand(ctx: DuelContext, view: PlayerView): void {
  const wanted = new Map(view.self.hand.map((card) => [card.instanceId, card.cardId]))
  for (const card of [...ctx.parts.fan.all()]) {
    if (wanted.has(card.instanceId)) continue
    const world = fanToWorld(ctx.layout, card.x, card.y, card.scale.x)
    // 先换层再从扇形里摘：位置要换算成视口坐标，留在扇形容器上就还是扇形坐标。
    ctx.parts.layers.drag.addChild(card)
    applyPose(card, { x: world.x, y: world.y, rotation: 0, scale: world.scale })
    ctx.parts.fan.remove(card)
    ctx.leaving.set(card.instanceId, {
      card,
      cardId: ctx.handCardIds.get(card.instanceId) ?? '',
      from: world,
    })
  }

  const shown = new Set(ctx.parts.fan.all().map((card) => card.instanceId))
  const pending = new Set(ctx.pendingHand.map((entry) => entry.instanceId))
  for (const card of view.self.hand) {
    ctx.handCardIds.set(card.instanceId, card.cardId)
    if (shown.has(card.instanceId) || pending.has(card.instanceId)) continue
    ctx.pendingHand.push({ instanceId: card.instanceId, cardId: card.cardId })
  }
  // 还没飞出来就已经不在手上了（被「模型蒸馏」弃掉）：直接从队列里划掉，一眼都不用露。
  for (let i = ctx.pendingHand.length - 1; i >= 0; i -= 1) {
    if (!wanted.has(ctx.pendingHand[i]!.instanceId)) ctx.pendingHand.splice(i, 1)
  }
}

/** 战场：新单位建格子（先藏着），走了的记进待摘名单，剩下的更新角标。 */
function syncBoard(ctx: DuelContext, view: PlayerView): void {
  const units: { ai: AiInstance; side: BoardSide; shielded: boolean }[] = [
    ...view.self.board.map((ai) => ({
      ai,
      side: 'self' as const,
      shielded: view.self.shielded === true,
    })),
    ...view.opponent.board.map((ai) => ({
      ai,
      side: 'opponent' as const,
      shielded: view.opponent.shielded === true,
    })),
  ]
  const alive = new Set(units.map((one) => one.ai.instanceId))

  for (const { ai, side, shielded } of units) {
    ctx.doomedTiles.delete(ai.instanceId)
    let tile = ctx.parts.board.tile(ai.instanceId)
    if (tile === null) {
      tile = ctx.parts.board.place(ai.instanceId, ctx.makeCard(ai.cardId, ai.instanceId), side)
      // 建好先藏着：什么时候看见它出现是演出的事（落地、简易进场、放大查看飞回）。
      tile?.setHeld(true)
      if (tile !== null) ctx.bindTile(tile)
      ctx.hiddenTiles.add(ai.instanceId)
    }
    const marks = tileMarksOf(ai, shielded)
    const key = marks.map((mark) => `${mark.tone}:${mark.text}`).join('|')
    if (ctx.markKeys.get(ai.instanceId) !== key) {
      ctx.markKeys.set(ai.instanceId, key)
      ctx.parts.board.setMark(ai.instanceId, marks)
    }
  }

  for (const instanceId of ctx.hiddenTiles) {
    if (!alive.has(instanceId)) ctx.hiddenTiles.delete(instanceId)
  }
  for (const instanceId of ctx.parts.board.ids()) {
    if (!alive.has(instanceId)) ctx.doomedTiles.add(instanceId)
  }
}

/**
 * 对手手牌只记「还欠几张没飞出来」，不直接改张数。
 *
 * 张数变少是强制展示把那张牌借走了（`reveal-enter` 已经摘过），这里不能再摘一次；
 * 变多要等 `deal` cue 才飞进来。真对不上由 `reconcile` 兜底。
 */
function syncFoeHand(ctx: DuelContext, view: PlayerView): void {
  ctx.pendingFoeDeal = Math.max(0, view.opponent.handCount - ctx.parts.foeHand.count)
}

export function applyView(ctx: DuelContext, view: PlayerView): void {
  ctx.view = view
  syncChrome(ctx, view)
  syncHeroes(ctx, view)
  syncHand(ctx, view)
  syncBoard(ctx, view)
  syncFoeHand(ctx, view)
  ctx.refreshLocks()
  ctx.wake()
}

/**
 * 演出播完之后的兜底对账：把没被任何 cue 认领的差异一次补上。
 *
 * 只在**队列播空、动画也停了**那一刻跑（见 DuelScene 的 step），所以正常情况下它是个空操作——
 * 该演的都演过了，画面和视图本来就一致。真补上东西的只有三种时候：
 * 中途接手一局、编排层明确不演的那几种事件（`AI_ELIMINATED` 之类），以及演出被中断。
 */
export function reconcile(ctx: DuelContext): void {
  const view = ctx.view
  if (view === null) return

  if (ctx.pendingHand.length > 0) {
    const from = ctx.deckPose()
    for (const entry of ctx.pendingHand.splice(0)) {
      const card = ctx.makeCard(entry.cardId, entry.instanceId)
      ctx.parts.fan.insert(card, from)
      ctx.bindHandCard(card)
    }
    ctx.parts.fan.layout('reflow')
  }

  for (const [instanceId, leaving] of ctx.leaving) {
    ctx.leaving.delete(instanceId)
    killAndDestroy(ctx.deps.animator, leaving.card)
  }

  for (const instanceId of ctx.hiddenTiles) {
    ctx.parts.board.tile(instanceId)?.setHeld(false)
  }
  ctx.hiddenTiles.clear()

  for (const instanceId of ctx.doomedTiles) {
    ctx.parts.board.remove(instanceId)
  }
  ctx.doomedTiles.clear()

  if (ctx.parts.foeHand.count !== view.opponent.handCount) {
    ctx.parts.foeHand.setCount(view.opponent.handCount)
    ctx.pendingFoeDeal = 0
  }
}
