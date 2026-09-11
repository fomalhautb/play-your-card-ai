/**
 * 规则里那几个可以调的数。
 *
 * 单独放一份，是因为它们同时是**对外导出**的：客户端照 INITIAL_TOKEN_MAX 画右侧栏那排星星、
 * 照 WIN_TARGET 显示赛点，和引擎必须读同一个数。
 * 引擎这边用到它们的是 engineSetup（开局额度）和 engineRound（每轮补满、判胜负）两处，
 * 摆在两边都够得着的最底层，谁也不用反过来依赖谁（分层见 engine.ts 的文件头）。
 */

/** 开局手牌数。黑客松阶段不做先后手补偿，双方一样。 */
export const STARTING_HAND_SIZE = 5

/**
 * 第 2 轮起每轮开始双方各补几张。
 *
 * 一张时手牌只出不进，打到后面双方常常无牌可打、只能干等着答题；两张才够一轮出一两张的消耗。
 * 一局最多摸 5 + 4 轮 × 2 = 13 张，预设牌组各 20 张（见 content 的 PRESET_DECKS）管得住，
 * 不会中途抽空。改大到摸得空牌堆也不会出错（engineUtils.ts 的 drawCards 抽不到就算了），
 * 只是画面上会一直显示 0。
 */
export const ROUND_DRAW_SIZE = 2

/**
 * 第 1 轮的 Token 上限。
 *
 * 5 点买得起最便宜的两三张 AI 牌（费用区间是 1~7，见 content 的 aiModels.ts），
 * 又买不起 7 点的顶配，开局就得做取舍。
 * 一轮里 AI 牌和技能牌都不限张数，Token 就是唯一的额度，
 * 而且省着花本身有意义——答对数量相同时比的就是本轮消耗（见 engineQuiz.ts 的 submitAnswers）。
 */
export const INITIAL_TOKEN_MAX = 5

/**
 * 每答完一题，Token 上限涨这么多。
 *
 * 上限只涨不减，所以第 n 轮的上限恒为 INITIAL_TOKEN_MAX + (n - 1) × 这个数；
 * 右侧栏那排星星的格子数就是它算出来的，超过 8 格会自动折成两列。
 * 涨得慢（每轮 1 点）是有意的：一局最短 3 轮就结束，涨太快的话最后一轮想买什么买什么，
 * 「省 Token」这条决胜线就没有分量了。
 */
export const TOKEN_MAX_GROWTH = 1

/**
 * 先拿到这么多分就赢。
 *
 * 但必须**独自**达到：双方同时到线（答对数和消耗相同，各 +1，见 engineQuiz.ts 的 submitAnswers）
 * 时不判胜负，继续加赛，直到某一轮结束后一方分数单独领先。
 * 题库出完仍未分出的兜底是同一处：总分高者胜，相同才是 'draw'。
 * 这两条收不收场的判断都在 engineRound.ts 的 confirmRound 里——分是答完题就算完的，
 * 但要等双方确认才轮到它决定这一局到此为止还是再打一轮。
 */
export const WIN_TARGET = 3

/**
 * ada-lovelace 的「第一算法」给自己加多少 Token 上限。
 *
 * 只在开局加这一次就够贯穿整局：engineRound.ts 的 confirmRound 走的是
 * `tokenMax += TOKEN_MAX_GROWTH` 的增量逻辑，
 * 加高的起点会一路带下去（第 1 轮 7、第 2 轮 8、第 3 轮 9……恒比对手多 2）。
 * 这是**有意的「全程上限 +2」**，不是只加第一轮，改成每轮重算反而会把技能削掉。
 * 一局最短 3 轮（先到 WIN_TARGET 分），所以这 +2 差不多等于白送一张中费 AI 牌，分量不小。
 */
export const ADA_TOKEN_MAX_BONUS = 2
