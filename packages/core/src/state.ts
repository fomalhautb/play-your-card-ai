/**
 * 一局对局的状态：`GameState` 和它里面的每一层。
 *
 * 和 cards.ts 的分界是「这一局的实例」与「定义」：这里的每样东西都会随着指令被改写，
 * 卡面上印着什么则在 cards.ts，一局之内不变。
 *
 * 这一份尤其不能破「纯数据、可 JSON 序列化」那条：引擎正是靠 JSON 深拷贝推进状态的，
 * 联机时房主还要把状态原样发给客人（完整理由见 types.ts 的文件头）。
 */

import type { CardId, Catalog, HeroId, InstanceId, InterferenceCardId } from './cards'
import type { Question } from './question'

/** 玩家固定两人，用 0/1 当座位号，省掉一层 id 映射。 */
export type PlayerId = 0 | 1

/** 牌堆/手牌/弃牌堆里的一张牌。 */
export interface CardInstance {
  instanceId: InstanceId
  cardId: CardId
  owner: PlayerId
}

/**
 * 场上的 AI 单位。
 *
 * 除了身份三件套只有四个标记，分两类，别混：
 * - `affectedBy` / `interference` / `safePassed` 是**本轮**标记，双方确认结算、真的进下一轮时
 *   一起清掉（见 engineRound.ts 的 confirmRound）。
 * - `levelShift` 跟着单位走，不按轮清——它记的是这个单位这一局被升降过几级，只给界面画角标用。
 *
 * 之后要加"上场后被增益/削弱"的数值时再往这里拷贝卡面数值。
 *
 * 四个都写成可选字段、只设不为空的那一档：没被打过的单位就不带这一项，
 * JSON 深拷贝和联机转发都少一份冗余。
 */
export interface AiInstance {
  instanceId: InstanceId
  cardId: CardId
  owner: PlayerId
  /**
   * 本轮打在这个单位身上的技能牌，按命中先后排。**只给界面用**，引擎的判定一概不读它。
   *
   * 它回答的是玩家在战场上问的那句"这张卡怎么了"：每一项在小卡上挂一枚角标，
   * 点开放大查看时列出牌名（见黑客松版的 MatchStage）。所以凡是效果落在某个场上单位身上的
   * 技能牌，结算时都要往这里补一笔，否则那张牌打出去画面上不留痕迹。
   * 不落在单位身上的不记：核电站改的是费用、模型蒸馏打的是手牌、
   * 国产替代和内存紧缺清掉的单位已经不在场上了。
   * 金钟罩也不记——它罩的是整个人（`PlayerState.shielded`），连本轮之后才上场的单位一起罩着，
   * 记在实例上反而会漏掉那些，界面直接读那个字段。
   *
   * 效果被移除时对应那一项也要跟着删（眼下只有玉净瓶解干扰这一处），
   * 不然角标会停在一个已经不存在的效果上。所以它是"现在身上有什么"，不是一本流水账。
   *
   * 和 `interference` / `safePassed` 有重叠是有意的：那两个是引擎自己要读的机制
   *（按种类取预生成回答、答错免罚下），这一份只管展示。两边必须一起写，
   * 引擎里统一走 engineSkills.ts 的 markAffected / unmarkAffected 两个小工具，别在别处手写。
   */
  affectedBy?: CardId[]
  /**
   * 被哪张干扰类技能命中了。
   *
   * 干扰的本体是"往这个 AI 的 prompt 里注入一句话"（注入文案见 content 的 script.ts 的
   * `INTERFERENCE_PROMPTS`）。那两句是提示词不是开关，模型完全可以不理——复读机那句
   * 尤其是编出来骗它的，上不上钩由模型自己权衡。这两句已经离线跑过一遍了：答题时按这个字段
   * 去查对应那一档的**真实模型回答**（见 content 的 script.ts），所以同一张牌打在不同模型身上结果不一样。
   *
   * 记的是种类而不是一个布尔，因为下游要分三处用：答案生成层按种类选变体、
   * 玉净瓶按"身上有没有它"挑目标、战场小卡按种类显示不同角标。
   * 一个 AI 同时只能挂一种：已经带着它的单位不能再被第二张干扰技能选中。
   */
  interference?: InterferenceCardId
  /**
   * 被「保送」选中过：本轮结算答错也不罚下（改发 `AI_SAFE_PASSED`）。
   *
   * 它只免掉罚下，**不改计分**：保送留场的那个 AI 不计入 `ROUND_SCORED.correctCounts`。
   */
  safePassed?: true
  /**
   * 净升降级次数：每被升一级 +1、降一级 -1。
   *
   * **纯粹给 UI 画角标用**（战场小卡上那个「↑1」之类的标记）。
   * 能力变化不靠它：升降级当场就把 `cardId` 换成了同系列的另一张卡（见 content 的升级链），
   * 费用、卡面、答题表现全部跟着新卡走，引擎不会再去读这个数。
   * 同样写成可选字段，没被升降过的单位不带这一项。
   * 一方升、另一方又降回去的话这里会留下一个 0（字段不删），界面把 0 当作"没有角标"处理。
   *
   * 和上面那几个「本轮」标记不同，它**不在 confirmRound 里清**：英雄技能每局只发得动一次，
   * 换掉的卡面身份也是永久的，角标跟着单位走到它下场为止。
   * 「鸡犬升天」（技能牌）走的是另一条路——它发 AI_TRANSFORMED、只加下面的 `evolvedTimes`，
   * 因为那是全场一起进化，不是"这一个被单独强化了"，两种来源的角标文案也不一样。
   */
  levelShift?: number
  /**
   * 被「鸡犬升天」升过几级，只增不减。
   *
   * 和 `levelShift` 一样是**纯 UI 用**、跟着单位走不按轮清：进化换掉的卡面身份是永久的，
   * 玩家隔了几轮回头看战场，也该一眼看出哪几个单位是升上来的，
   * 所以不能只靠本轮标记 `affectedBy`（那个进下一轮就清了）。
   *
   * 单独记一个数而不是并进 `levelShift`：那个数是英雄技能的净升降次数，可能被降级抵消成 0，
   * 而这里要回答的是"这个单位这一局被鸡犬升天带飞过几次"，两件事的角标文案也不同
   *（「已升级」对「已进化」，见黑客松版的 tileMarks）。
   */
  evolvedTimes?: number
}

/**
 * 一轮分四段：双方轮流出牌（play）→ 全场答题（quiz）→ 结算等双方确认（settle）→ 下一轮。
 *
 * 分数在 quiz 末尾就算完了，但要等 settle 里双方都确认才推进；到那一刻若有一方
 * 单独到 WIN_TARGET 分、或者题库已经出完，就直接进 finished 而不是开下一轮。
 *
 * settle 单独占一段是为了让结算界面有一段"局面不再变"的时间：
 * 计分已经算完写进快照，但轮次、Token、手牌都还停在本轮的样子，界面可以放心读快照。
 */
export type GamePhase = 'play' | 'quiz' | 'settle' | 'finished'

/**
 * 本轮那 1 分是怎么分出来的。三档按判定顺序排，客户端照它选结算文案。
 *
 * - `'more-correct'`：答对 AI 数量更多的一方 +1。
 * - `'fewer-tokens'`：答对数量相同，本轮 Token 消耗**严格**较少的一方 +1。
 * - `'equal-tokens'`：答对数量和消耗都相同，各 +1（这一档会把两边分数一起推高，
 *   所以才会有"双方同时到 3 分"这种要加赛的局面）。
 */
export type RoundVerdict = 'more-correct' | 'fewer-tokens' | 'equal-tokens'

export interface PlayerState {
  id: PlayerId
  name: string
  /**
   * 累计得分。每轮 1 分制：答对 AI 更多的一方 +1；数量相同才比本轮 Token 消耗，
   * 少的一方 +1、消耗也相同则各 +1（判定见 engineQuiz.ts 的 submitAnswers）。先到 WIN_TARGET 分且
   * 双方分数不相等即获胜，所以它最高可能停在 3 分以上（加赛时双方一起涨）。
   */
  score: number
  /**
   * 本轮打出过「金钟罩」：这一方和他场上所有 AI 不受**任何**技能牌影响，
   * 进下一轮时清掉（见 engineRound.ts 的 confirmRound）。
   *
   * 挡的范围是**落在场上单位身上的技能牌效果**，对己方有利的也一样挡：
   * 对方的干扰技能选不中他的 AI（直接拒绝出牌）、他自己也打不出玉净瓶/保送
   * 这类作用于自己场上单位的牌、群体牌结算时跳过他的场面。
   * 够不着场上单位的就管不着：核电站减的是自己的出牌费用，罩着照样享受
   * （见 enginePlay.ts 的 effectivePlayCost）；模型蒸馏弃的是手牌，罩着照样能打。
   * 金钟罩自己也不受自己影响，否则第一张就会把自己挡住、这张牌永远打不出去。
   *
   * 只设 true 不设 false：和场上单位的两个标记同一套写法。
   */
  shielded?: true
  /**
   * 这一方本轮打出过几张「核电站」：**他自己**后续每张牌都便宜这么多点，最低 1 点
   * （算法见 enginePlay.ts 的 effectivePlayCost）。进下一轮时清零。
   *
   * 记张数而不是一个布尔：这张牌可叠加，打两张就是 -2。
   * 每方各记一份而不是全局一份——核电站只减打出方自己的费用，对手照原价付。
   */
  costReduction: number
  /**
   * 本轮还剩多少 Token。出牌时按卡面 tokenCost 扣，扣光了就打不出更贵的牌。
   *
   * 双方确认结算、进下一轮时补满到 tokenMax，不跨轮攒：省下来的 Token 不会带到下一轮，
   * 所以"这一轮的额度尽量用掉"本身就是一条策略。
   */
  tokens: number
  /**
   * 本轮已经花掉的 Token，等双方确认结算、真的进下一轮时才清零。
   *
   * 单独记一份而不是拿 `tokenMax - tokens` 现算：那个差值在出牌阶段对得上，
   * 但它表达的是"额度剩多少"，而计分要的是"这一轮为新打出的牌付了多少"；
   * 而且进下一轮时 tokens 会补满、tokenMax 还要涨，差值当场就没了。
   * 结算界面正需要在那之前把"本轮消耗"显示出来，它也是同对/同错时的判据，
   * 所以清零必须押后到离开 settle 那一刻。
   *
   * 技能牌被英雄技能抵消也照样计入：Token 是真花出去的，作废的只是效果。
   */
  spentThisRound: number
  /**
   * 本轮的 Token 上限。开局 INITIAL_TOKEN_MAX，之后每答完一题涨 TOKEN_MAX_GROWTH。
   * 右侧栏那排四芒星画的就是它：亮着的是 tokens，灰的是这一轮已经花掉的。
   */
  tokenMax: number
  hand: CardInstance[]
  /** 牌堆，数组末尾是牌堆顶（抽牌用 pop）。 */
  deck: CardInstance[]
  board: AiInstance[]
  discard: CardInstance[]
  /**
   * 这一方选的英雄。英雄不进牌组，只是挂在玩家身上的一份身份 + 一个技能。
   * 为 null 表示这一方没有英雄（技能一律不发动）。
   */
  hero: HeroId | null
  /**
   * 英雄技能这一局用掉了没有。
   *
   * 已实装的技能都是"每局一次"，所以一个布尔够用；
   * 将来有"每若干轮一次"的技能时再换成记轮次的字段。
   * 一个 GameState 的生命周期就是一局，createGame 重新建状态时它天然回到 false。
   *
   * 被动技能（grace-hopper 的 Debug）由引擎自己在触发时置上，主动技能
   * （danqi-chen、melanie-perkins）由玩家发 USE_HERO_SKILL 置上。
   * ada-lovelace 的 Token 上限加成是开局就算进数值的，不占这个标志。
   */
  heroSkillUsed: boolean
}

export interface GameState {
  /**
   * 本局的卡牌和英雄定义（见 Catalog）。开局写进来之后引擎只读不改，
   * 场上单位、手牌里的 cardId 都靠它查回卡面。
   */
  catalog: Catalog
  /** 轮次序号，从 1 开始。一轮 = 双方各出一次牌 + 一次答题结算。 */
  round: number
  /**
   * 最多能打几轮 = 题库长度：题目在一局里不重复，出完就必须收场。
   *
   * 它是上限而不是"这局要打几轮"——正常先到 WIN_TARGET 分就结束了，
   * 打满只发生在双方一路同分加赛的情况下。
   */
  totalRounds: number
  /** 本轮先出牌的一方。第一轮抛硬币决定（教程可用 GameSetup.firstPlayer 指定），之后每轮交换。 */
  firstPlayer: PlayerId
  /**
   * play 阶段轮到谁出牌。
   * 不另设"先手是否已结束出牌"的标志位：activePlayer === firstPlayer 就是先手在出，
   * 否则就是后手在出，后手再 END_PLAY 即进答题。
   */
  activePlayer: PlayerId
  phase: GamePhase
  /**
   * 本局的题目序列（开局洗好），questions[round - 1] 是本轮的题。
   *
   * 整份题序连答案和解析都在这儿，这是**服务端权威的那一份**，不能原样发给客户端：
   * 哪一轮的题揭晓到哪一步由 view.ts 的 `viewFor` 决定。
   */
  questions: Question[]
  players: [PlayerState, PlayerState]
  /**
   * 谁赢了。没打完是 null；'draw' 只可能出现在"题库出完了双方还同分"这一种保底情况下
   * （先到 WIN_TARGET 分那条路要求分数不相等，同时到分会继续加赛）。
   */
  winner: PlayerId | 'draw' | null
  /**
   * settle 阶段里两位玩家分别确认过没有，按座位号排。
   *
   * 双方都点了"进入下一轮"才推进（见 engineRound.ts 的 confirmRound）：结算界面要播一整套
   * 揭晓动画，谁看完了谁先点，不能让先看完的一方把还在看的那一方拖走。
   * 每次进 settle 重置成 [false, false]。
   */
  settleConfirmed: [boolean, boolean]
  /**
   * 状态内的随机种子，让引擎在保持"纯函数 + 可序列化"的前提下也能掷随机
   * （眼下只有「内存紧缺」要随机保留一半场上单位）。
   *
   * 用法：`mersenne(rngSeed)` 起一把生成器，取完要用的值再把下一个种子写回这里。
   * 随机数生成器本身进不了状态（它不可 JSON 序列化），种子可以。
   * 这样"同一份状态 + 同一条指令 = 同一个结果"仍然成立，服务端重放也不会分叉。
   *
   * **它是隐藏信息**：拿着这颗种子能提前算出「内存紧缺」会保留哪一半场上单位，
   * 所以裁剪视图里没有它（见 view.ts）。
   */
  rngSeed: number
  /**
   * 下一个卡牌实例序号，开局发完双方牌组后接着往下走。
   * 调试指令凭空造牌时靠它保证 instanceId 不撞车。引擎里不许用 Math.random / Date，
   * 所以这个计数器必须留在状态里，才能跟着状态一起被拷贝和发给客人。
   */
  seq: number
}
