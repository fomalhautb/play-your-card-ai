/**
 * 卡牌、英雄和内容目录的**定义**类型：一张卡上印着什么，一局能用到哪些卡。
 *
 * 和 state.ts 的分界是「定义」与「这一局的实例」：这里的东西一局之内不会变
 *（`GameState.catalog` 存的就是它们），而谁在谁手上、场上那个单位身上挂着什么标记在 state.ts。
 *
 * 和这一组别的类型文件一样必须是纯数据、可 JSON 序列化，理由见 types.ts 的文件头。
 */

/** 卡牌定义 id（同一张卡在牌组里可以出现多次）。 */
export type CardId = string

/** 卡牌实例 id：牌组里每一份拷贝都有独立身份，用来定位手牌和场上单位。 */
export type InstanceId = string

interface CardBase {
  id: CardId
  /** 卡面名（中文）。 */
  name: string
  /** 卡面描述文案。 */
  text: string
  /**
   * 打出这张牌要花的 Token（见 docs/AI卡牌对战游戏_游戏机制与流程_V0.3.md 第 5 节）。
   *
   * 这是费用的唯一出处：卡面上那枚费用章、手牌"打不起就变灰"的判断、引擎的扣费校验
   * 读的都是它。客户端曾经在 ui/aiModelFace.ts 里另存过一份展示用数值，
   * 那份已经删掉——两份数字一旦对不上，玩家会看到"卡面写 4 点，却提示 Token 不够"。
   */
  tokenCost: number
}

/** AI 牌：打出后作为单位留在场上，每轮答题阶段跟着答题，答错才罚下。 */
export interface AiCard extends CardBase {
  kind: 'ai'
  /** 卡面上印的模型名，纯展示用，引擎不读它。 */
  model: string
  /** AI 的专属技能名；正面铭牌和背面详情共用这一份。 */
  skillName: string
  /** AI 的专属技能效果；当前只用于卡背说明，规则实现仍由引擎单独接入。 */
  skillText: string
  /**
   * 答题时去 OpenRouter 调的那个模型 id，`null` 表示 OpenRouter 上根本没有这个模型。
   *
   * 写成必填的 `string | null` 而不是可选字段：漏填会被静默当成"调不到"，
   * 而"调不到"是要把整张牌挡在卡池外的（见 content 的 PLAYABLE_AI_CARD_IDS），
   * 代价太大，宁可让类型检查在漏填的那一刻就报错。
   */
  openrouter: string | null
  /**
   * 国产模型。「国产替代」按它决定谁留在场上（没标的一律罚下）。
   *
   * 只标 true、不写 false：没这一项就是非国产，JSON 里少一份冗余，
   * 也免得以后有人误以为 `domestic: false` 和不写是两种状态。
   *
   * 和 openrouter 各管各的：标签说的是"这张卡算不算国产"，openrouter 说的是"调不调得到"。
   * 文心一言调不到模型、进不了卡池，但它照样是国产牌——真被调试指令摆上场就吃这条规则。
   */
  domestic?: true
  /**
   * 进化链的下一级卡（「鸡犬升天」把场上单位换成它）。
   *
   * 不填 = 这张卡不可进化：每条链最新的那一代，以及没有前后代的单张，都不填。
   * 进化链写在卡牌定义上而不是引擎里，再补一条链只要改这里。
   *
   * 链头可能是一张调不到模型、进不了卡池的牌，链条本身照样成立：牌组里带不了它，
   * 但它经调试指令上场后仍然能进化成下一代，所以这种链不要跟着删。
   */
  evolvesTo?: CardId
}

/** 干扰类技能牌的 id。命中后写进 `AiInstance.interference`，答案生成层按种类模拟。 */
export type InterferenceCardId = 'fixed-answer' | 'black-white-reversal'

/**
 * 技能牌：打出即效果结算、随后进弃牌堆，效果可以持续到本轮结束。
 *
 * 24 张里有 10 张接进了引擎（名单和各自的结算见 content 的 skillCards.ts 文件头注释），
 * 其余 14 张还带着 `plannedEffect` 走占位路径：打出后亮个相就进弃牌堆，什么都不发生。
 */
export interface SkillCard extends CardBase {
  kind: 'skill'
  /**
   * 打出时必须指定的目标；不填就是无目标技能，打出即结算。
   *
   * - `'foe-ai'`：对方场上一个还没被干扰过的 AI（`AiInstance.interference` 没设置）。复读机、黑白颠倒。
   * - `'own-ai'`：己方场上一个还没被保送的 AI。保送。
   * - `'own-affected-ai'`：己方场上一个身上带着 `interference` 的 AI。玉净瓶。
   * - `'own-hand-ai'`：**自己手牌里**的一张 AI 牌，`targetInstanceId` 指的是手牌实例
   *   而不是场上单位。模型蒸馏。
   *
   * 目标规则写在卡牌定义上而不是引擎里：新技能只要标上其中一档，
   * `playCard` 那段校验和客户端的选目标交互都不用改。
   */
  target?: 'foe-ai' | 'own-ai' | 'own-affected-ai' | 'own-hand-ai'
  /**
   * 设计稿定下的效果全文，**规则引擎尚未实装**，只供卡背展示。
   *
   * 带着它的牌走的是占位路径：打出后亮个相就进弃牌堆，什么都不会发生。
   * 所以客户端拼卡背文案时必须一并说明"还没实装"（见黑客松版的 ui/cardText.ts）——
   * 直接把这句话摆出来，玩家会以为打出去真有效果。
   * 哪天某张牌接进引擎，就把这个字段删掉、改成真正的结算逻辑。
   */
  plannedEffect?: string
}

/**
 * 英雄 id。英雄总共就这 7 位、不会随版本增删，直接用字面量联合，写错名字当场就是类型错误。
 * 这里的排列顺序不代表展示顺序——展示顺序由 content 的 HEROES 键序决定。
 */
export type HeroId =
  | 'fei-fei-li'
  | 'danqi-chen'
  | 'melanie-perkins'
  | 'mira-murati'
  | 'ada-lovelace'
  | 'margaret-hamilton'
  | 'grace-hopper'

/**
 * 英雄牌：开局就跟着玩家，不是牌组里的一张牌。
 *
 * 字段风格对齐 CardBase（id / name / text），另加英文名和技能两项。
 *
 * **它刻意不进 HandCard 联合，也不进 CARDS / CARD_POOL / 预设牌组**：
 * 英雄技能不占 20 张牌的牌组空间（见 docs/AI卡牌对战游戏_游戏机制与流程_V0.3.md 第 4 节），
 * 混进卡池还会连累存档过滤、抽卡和牌组洗牌——那几处都是"遍历卡池"的写法，
 * 多出一张抽不到也打不出的卡只会变成脏数据。英雄的表在 content 的 heroes.ts，查表走 catalog.ts 的 getHero。
 */
export interface HeroCard {
  kind: 'hero'
  id: HeroId
  /** 中文名，卡面主标题。 */
  name: string
  /** 英文名，卡面上当副标题印一行。 */
  enName: string
  /** 人物简介。 */
  text: string
  /** 技能名，界面上要单独拎出来显示（如抵消过场的大字）。 */
  skillName: string
  /** 技能效果的说明文案。 */
  skillText: string
  /**
   * 技能只有设计稿、**规则引擎尚未实装**，选英雄界面要把这位置灰禁选。
   *
   * 和技能牌的 `plannedEffect` 同一个路子（见 SkillCard）：skillText 写的是定案的效果，
   * 但选了他打起来就是没技能，所以宁可先不让选，也别让玩家以为技能会生效。
   * 哪天这一位接进引擎，就把这个字段删掉。
   */
  comingSoon?: boolean
  /**
   * 这位英雄在对局里的定位（"经济发育型"、"节奏压制"……），选英雄界面的详情面板展示。
   *
   * 和 skillText 分开：那一条说的是技能**怎么结算**，这一条说的是**该什么时候选他**。
   * 只有已实装的英雄才写，comingSoon 的几位不写——定位得等技能真打起来才谈得上。
   */
  roleText?: string
}

/** 牌组、手牌、弃牌堆里唯二可能出现的牌。 */
export type HandCard = AiCard | SkillCard

/**
 * 全部三类牌。只有需要"任意一张牌"的展示代码才用它（卡面渲染、牌组页、背面文案）；
 * 一切和牌组沾边的地方一律用 HandCard，英雄牌进不去。
 */
export type Card = HandCard | HeroCard

/**
 * 一局用到的全部内容定义（卡面、英雄），开局时整份存进 `GameState.catalog`。
 *
 * core 自己不带任何数据，卡表和英雄表都在 `content` 包里；`createGame` 收下一份目录，
 * 之后 `execute` 一律从状态里查（`getCard` / `getHero` / `upgradeTargetOf`，见 catalog.ts）。
 * 这么做换来三件事：
 * - `execute(state, command)` 的签名不用多带一个参数，状态自己就是完整的输入；
 * - 状态自包含，回放、快照、服务端把它存进 SQLite 都不必另外配一份目录；
 * - 一局开始那一刻的卡面数值被冻住，中途上线的平衡改动不会把打到一半的对局改掉。
 *
 * 装的是**整个公开卡池**，不只是双方牌组里那些牌：卡池本来就是公开信息，
 * 裁剪视图（view.ts 的 viewFor）原样带上它，界面也能直接从视图里查到任意一张卡的卡面。
 * 题目不在这里——本局题序连答案已经在 `GameState.questions` 里，再放一份只会多一处要遮挡的地方。
 *
 * 和状态里别的东西一样必须可 JSON 序列化：只放纯数据，别塞函数。
 * 引擎从不改它，所以同一份目录对象可以被多局共用（`content` 的 `createCatalog()` 返回的就是同一份）。
 */
export interface Catalog {
  /** 全部卡牌定义，按卡牌 id 查。 */
  cards: Record<CardId, HandCard>
  /** 全部英雄定义，按英雄 id 查。 */
  heroes: Record<HeroId, HeroCard>
}
