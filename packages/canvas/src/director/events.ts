/**
 * 事件分支：一批 `GameEvent` 进来，排出这一批该演的东西。
 *
 * 抄自旧版 `MatchStage.tsx:1075-1345` 的那个 `switch`，一条一条对得上。
 * 哪种事件有演出、哪种明确不演，写在 ignored.ts 的覆盖表里，那张表是编译期穷举的。
 *
 * 一条要紧的时序约定：整个循环期间 `context.view` 还是**上一批**的视图，
 * 循环跑完才换成这一批的。旧版靠的是「事件在 React 提交新快照之前同步送达」，
 * 结算层顶栏的起点分数、对手手上还有没有牌，读的都是那份旧快照——这里照抄这个口径。
 */

import type {
  CardId,
  Catalog,
  GameEvent,
  InstanceId,
  PlayerId,
  PlayerView,
  PublicQuestion,
  Question,
  QuestionCategory,
} from '@ai-duel/core'
import { getCard, getHero, other } from '@ai-duel/core'
import { pumpBanner, queueSkillCancel, showBanner } from './banner'
import type { DirectorContext } from './context'
import type { CueSides } from './cues'
import { clearOpeningDealFallback, flushDeal, holdRoundDeal, noteDrawn, releaseDeal } from './deal'
import { playMyAi, playMySkill } from './myPlay'
import { abortReveal, startReveal } from './reveal'
import {
  addSettleRow,
  exitSettle,
  markSafePassed,
  openSettle,
  startSettleMain,
} from './settleTimeline'
import {
  COIN_TOSS_TOTAL_MS,
  EVOLVE_FX_MS,
  EVOLVE_STAGGER_MS,
  HIT_FX_MS,
  POP_IN_MS,
  REMOVAL_FX_MS,
} from './timings'

/** 一次「鸡犬升天」升起来的一个单位。 */
interface Evolved {
  instanceId: InstanceId
  owner: PlayerId
  fromCardId: CardId
  toCardId: CardId
}

/** core 里只有英文标识符，横幅上那句中文放在这一层拼（旧版是 ui/labels.ts）。 */
const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  meme: '梗题',
  bias: '刻板印象',
  life: '生活类',
}

/** 事件上那道题只取公开的四项：答案和解析要等本轮结算才公开，不该跟着 cue 走。 */
function publicPartOf(question: Question | PublicQuestion): PublicQuestion {
  return {
    id: question.id,
    category: question.category,
    text: question.text,
    keywords: question.keywords.slice(),
  }
}

/** 把按座位号排的一对数换算成「我方 / 对方」。 */
function sidesOf(pair: readonly [number, number], seat: PlayerId): CueSides {
  return { mine: pair[seat], theirs: pair[other(seat)] }
}

/** 抛硬币过场，收尾放行开局发牌。 */
function playCoinToss(context: DirectorContext, firstPlayer: PlayerId): void {
  // 全屏过场会盖住战场，选目标态一律先收掉（同 QUESTION_REVEALED 那条）。
  context.targeting = false
  context.coinUp = true
  // 过场真的要演了，开局发牌的兜底放行可以撤了：改由这条过场的收尾放行，
  // 开局手牌才不会在硬币还转着的时候飞出来。
  clearOpeningDealFallback(context)
  context.emit({
    kind: 'coin-toss',
    durationMs: COIN_TOSS_TOTAL_MS,
    firstPlayer,
    mineFirst: firstPlayer === context.seat,
  })
  context.schedule(COIN_TOSS_TOTAL_MS, () => {
    context.coinUp = false
    // 开局这一批里，硬币后面紧跟着还有「第 1 轮」和「轮到你出牌」两条横幅憋着。
    pumpBanner(context)
    // 屏幕空出来了，开局那两手牌这才从各自的卡堆一张张飞出去。
    releaseDeal(context)
  })
}

/**
 * 这一批要不要把回合末的补牌憋住。
 *
 * 判据三个条件缺一不可（旧版 MatchStage.tsx:1103-1110 那段注释列得很细）：
 * 结算层真的立着（`quizUp`）、这一批里有 `ROUND_CONFIRMED`、它后面还跟着 `CARD_DRAWN`。
 * 先手确认的那一批只有确认没有补牌；最后一轮双方确认后跟的是 `GAME_OVER`，
 * 拦了就永远等不到退场来放行；调试面板的「加 1 张」那一批没有确认，该当场就飞。
 */
function shouldHoldRoundDeal(context: DirectorContext, events: GameEvent[]): boolean {
  if (!context.quizUp) return false
  const confirmedAt = events.findIndex((event) => event.type === 'ROUND_CONFIRMED')
  if (confirmedAt < 0) return false
  return events.slice(confirmedAt + 1).some((event) => event.type === 'CARD_DRAWN')
}

/** 处理一批事件。`view` 是这一批之后的新视图。 */
export function handleBatch(context: DirectorContext, events: GameEvent[], view: PlayerView): void {
  const seat = context.seat
  const catalog = view.catalog
  // 对手手上还有没有牌，决定强制展示找不找得到起飞点。读的是上一批的视图：
  // 这一批里他打出去的那张，此刻在画面上还在他手里。
  const foeHasCards = (context.view?.opponent.handCount ?? 0) > 0

  if (shouldHoldRoundDeal(context, events)) holdRoundDeal(context)

  /** 这一批里「鸡犬升天」升了哪些单位，循环跑完拿它拼一条横幅。 */
  const evolved: Evolved[] = []
  /** 强制展示受理不了、退回简易进场的那些 AI。 */
  const pops: InstanceId[] = []
  let risingTidePlayed = false

  for (const event of events) {
    switch (event.type) {
      case 'GAME_STARTED':
        playCoinToss(context, event.firstPlayer)
        break
      case 'CARD_DRAWN':
        noteDrawn(context, event.player === seat ? 'self' : 'opponent')
        break
      case 'CARD_REMOVED':
        // 不演，见 ignored.ts。
        break
      case 'ROUND_STARTED':
        showBanner(context, `第 ${event.round} 轮 · ${CATEGORY_LABELS[event.category]}`)
        break
      case 'PLAY_TURN_STARTED':
        showBanner(context, event.player === seat ? '轮到你出牌' : '对方出牌中')
        break
      case 'AI_DEPLOYED': {
        const id = event.ai.instanceId
        if (event.player === seat) {
          playMyAi(context, id)
          break
        }
        // 对方的 AI 先强制展示、再从展示位飞到战场行；受理不了才退回简易进场。
        // 落场用的 id 和手牌里那张是同一个（引擎沿用了手牌实例的 instanceId）。
        const accepted = startReveal(context, {
          cardId: event.ai.cardId,
          cardKind: 'ai',
          handInstanceId: id,
          landingId: id,
          hitId: null,
          requireOrigin: true,
          hasOrigin: foeHasCards,
        })
        if (!accepted) pops.push(id)
        break
      }
      case 'SKILL_PLAYED':
        // 记一笔「这一批里有人打了鸡犬升天」，循环跑完才知道它到底升了几个。
        if (event.cardId === 'rising-tide') risingTidePlayed = true
        if (event.player === seat) {
          playMySkill(context, event.cardId, event.targetInstanceId ?? null)
          break
        }
        // 受理不了（上一张还在展示）就跳过这一次展示：技能牌没有落场，
        // 少看一眼牌面是这条链路唯一的降级代价。
        startReveal(context, {
          cardId: event.cardId,
          cardKind: 'skill',
          handInstanceId: event.instanceId,
          landingId: null,
          hitId: event.targetInstanceId ?? null,
          requireOrigin: false,
          hasOrigin: foeHasCards,
        })
        break
      case 'SKILL_CANCELED': {
        // 被抵消就不再报「一个都没升」了：没升是因为效果整个作废，抵消那一层已经说清楚了。
        if (event.cardId === 'rising-tide') risingTidePlayed = false
        // 措辞按「谁打出的那张牌被抵消了」来分：player 是出牌方，by 是发动英雄技能的一方。
        const hero = getHero(catalog, event.heroId)
        const whose = event.player === seat ? '你' : '对方'
        const cardName = getCard(catalog, event.cardId).name
        queueSkillCancel(context, {
          heroId: event.heroId,
          title: `${hero.skillName}!`,
          text: `${hero.name} 发动 ${hero.skillName}，抵消了${whose}打出的「${cardName}」`,
        })
        break
      }
      case 'HERO_SKILL_USED': {
        // 换卡这件事在新视图里只剩换完的 cardId，所以前后两张卡名都从事件里取。
        const hero = getHero(catalog, event.heroId)
        const from = getCard(catalog, event.fromCardId).name
        const to = getCard(catalog, event.toCardId).name
        showBanner(context, `${hero.skillName}！${from} → ${to}`)
        // 目标格上闪一下：那一格的卡面下一次提交就换了脸，不闪一下就是无缘无故地跳变。
        context.emit({
          kind: 'hit-fx',
          durationMs: HIT_FX_MS,
          instanceId: event.targetInstanceId,
        })
        break
      }
      case 'QUESTION_REVEALED': {
        // 结算层和展示层同一档，先把还没演完的展示收掉再开这一层。
        abortReveal(context)
        // 进答题就出不了牌了，正选着目标的那张技能牌一并收掉。
        context.targeting = false
        // 还憋着没演的抵消提示直接丢掉：它说的是刚才那次出牌，等结算层演完再补一遍，
        // 就成了下一轮开头凭空冒出来的一句话，比不演更让人糊涂。
        context.pendingCancel = null
        openSettle(context, {
          round: context.view?.round ?? view.round,
          question: publicPartOf(event.question),
          scoresBefore: {
            mine: context.view?.self.score ?? 0,
            theirs: context.view?.opponent.score ?? 0,
          },
        })
        break
      }
      case 'AI_ANSWERED':
        // 卡面身份直接读事件里的 cardId：答错的那个单位马上就被罚下，回头查视图会查空。
        addSettleRow(context, {
          instanceId: event.instanceId,
          cardId: event.cardId,
          mine: event.owner === seat,
          correct: event.correct,
          answer: event.answer,
          reasoning: event.reasoning,
          safePassed: false,
        })
        break
      case 'AI_ELIMINATED':
        // 不演，见 ignored.ts。
        break
      case 'AI_SAFE_PASSED':
        markSafePassed(context, event.instanceId)
        break
      case 'AI_REMOVED':
        context.emit({
          kind: 'removal-fx',
          durationMs: REMOVAL_FX_MS,
          instanceId: event.instanceId,
          cardId: event.cardId,
          by: event.by,
        })
        break
      case 'AI_TRANSFORMED':
        evolved.push({
          instanceId: event.instanceId,
          owner: event.owner,
          fromCardId: event.fromCardId,
          toCardId: event.toCardId,
        })
        break
      case 'ROUND_SCORED': {
        const current = view.questions[view.round - 1]
        startSettleMain(context, {
          correctCounts: sidesOf(event.correctCounts, seat),
          gains: sidesOf(event.gains, seat),
          totals: sidesOf(event.scores, seat),
          spent: sidesOf(event.spent, seat),
          verdict: event.verdict,
          // 答案要等本轮结算之后才公开，所以从新视图里取，不从事件上取。
          answer: current?.reveal === 'answer' ? current.answer : '',
          explanation: current?.reveal === 'answer' ? current.explanation : '',
        })
        break
      }
      case 'ROUND_CONFIRMED':
        // 不演，见 ignored.ts（但补牌闸门的判据要读它，见 shouldHoldRoundDeal）。
        break
      case 'GAME_OVER':
        // 不演，见 ignored.ts。
        break
      case 'COMMAND_REJECTED':
        context.emit({ kind: 'error', durationMs: 0, reason: event.reason })
        break
    }
  }

  emitRisingTideBanner(context, catalog, risingTidePlayed, evolved)

  // 进化：卡面已经跟着新视图换好了，这里补一段变身演出。一批里逐格错开起——
  // 一张牌能一口气升好几个单位，同时闪就成了一次整屏的亮，数不清升了几个。
  evolved.forEach((one, index) => {
    context.schedule(index * EVOLVE_STAGGER_MS, () => {
      context.emit({
        kind: 'evolve-fx',
        durationMs: EVOLVE_FX_MS,
        instanceId: one.instanceId,
        fromCardId: one.fromCardId,
        toCardId: one.toCardId,
      })
    })
  })

  for (const instanceId of pops) {
    context.emit({ kind: 'pop-in', durationMs: POP_IN_MS, instanceId })
  }

  flushDeal(context)
  context.view = view
  // 阶段离开 quiz / settle 就说明这一轮翻篇了（双方都确认，进下一轮或终局）。
  if (view.phase !== 'quiz' && view.phase !== 'settle') exitSettle(context)
}

/**
 * 「鸡犬升天」的总结横幅，排在所有事件之后。
 *
 * 小卡上那一圈绿光只说得清「这一格升了」，说不清「一共升了几个、双方各几个」，
 * 而这张牌最容易让人以为没生效的正是这一点：场上全是链尾单位时它一个都升不动，
 * 引擎一条 `AI_TRANSFORMED` 都不发，画面上什么都不动。
 */
function emitRisingTideBanner(
  context: DirectorContext,
  catalog: Catalog,
  played: boolean,
  evolved: Evolved[],
): void {
  if (!played) return
  const only = evolved[0]
  if (only === undefined) {
    showBanner(context, '鸡犬升天！场上没有可进化的 Agent')
    return
  }
  if (evolved.length === 1) {
    // 只升了一个就直接报是谁变成了谁，比「1 个 Agent 进化」具体。
    const from = getCard(catalog, only.fromCardId).name
    const to = getCard(catalog, only.toCardId).name
    showBanner(context, `鸡犬升天！${from} → ${to}`)
    return
  }
  const mine = evolved.filter((one) => one.owner === context.seat).length
  const theirs = evolved.length - mine
  const parts: string[] = []
  if (mine > 0) parts.push(`我方 ${mine} 个`)
  if (theirs > 0) parts.push(`对方 ${theirs} 个`)
  showBanner(context, `鸡犬升天！${parts.join('、')} Agent 进化`)
}
