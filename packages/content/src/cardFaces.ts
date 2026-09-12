import type { CardId } from '@ai-duel/core'

/**
 * 卡面展示配置：每张卡的插画主色和费用圆章圆心，只决定卡面长什么样，不参与任何规则。
 *
 * 这里**不存费用数字**：费用是引擎真扣的平衡数值，唯一出处是卡表里的 `tokenCost`。
 * 两边各存一份的话，改平衡只改一边，玩家就会看到「卡面写 4 点，出牌却提示 Token 不够」。
 * 技能名、效果文案同理，都在 `cards.ts`，展示层从那份读。
 *
 * 这份数据是从黑客松版的 CSS 卡面迁过来的，现在服务的是 Pixi 画的卡面：
 * 当时圆章是一个 div，圆心通过 `--cost-x` / `--cost-y` 交给 CSS 定位、盘底色交给
 * `color-mix()` 调；现在同样的百分比要换算成 Pixi 的像素坐标、颜色要换算成数值。
 * 换算规则属于展示层，这里只存原始数据，不做任何转换。
 */
export interface CardFaceStyle {
  /**
   * 插画主色，`#rrggbb`。只有 18 张具名 AI 牌有——它们各自一张原画，色调差得远，
   * 铭牌字色和费用章盘底都得跟着自己那张走，统一成一种颜色会和插画打架。
   */
  accent?: string
  /**
   * 费用圆章的盘底色，`#rrggbb`。技能牌直接给，因为是从各自原画那枚圆章的盘心采下来的：
   * 新画的章要盖在原画那枚上面，接得住原画外圈那道金环才看不出接缝——
   * 统一成一种颜色的话，紫底的「复读机」和酱红底的「重复轰炸」会当场露馅。
   *
   * AI 牌不填，由展示层按 `accent` 掺进纸面墨色算出来（黑客松那条规则是
   * `color-mix(in srgb, accent 52%, 纸面墨色)`）。掺色要拿到当前的纸面墨色，
   * 那是展示层才有的东西，所以算在展示层，这里不存算好的结果。
   */
  costFill?: string
  /**
   * 费用圆章的圆心：`x` 按卡宽、`y` 按卡高的百分比。不填就用 `DEFAULT_COST_BADGE_CENTER`。
   * 直径不在这儿配，全场统一（卡宽的 20.8%）。
   *
   * 之所以要逐张配：这枚章是**盖在原画上**的——AI 牌盖角上那枚星章，技能牌盖原画自己
   * 已经印好的费用章——而两类原画都是各画各的，章的位置张张不同。露出两枚章最难看，
   * 所以只能跟着各自的原画走。数字是照 `assets/source/cards/` 下的原画量出来的，换原画就得重量。
   */
  costBadge?: { x: number; y: number }
}

/**
 * 圆心兜底值：24 张技能牌里有 20 张的原画都把费用章印在这儿，所以不填就按这个摆。
 * 黑客松版把它写成 CSS 变量 `--cost-x` / `--cost-y` 的默认值，含义一样。
 */
export const DEFAULT_COST_BADGE_CENTER = { x: 13.9, y: 9.2 }

/**
 * 全部 42 张卡的卡面配置，键和 `CARDS` 完全一致（测试里按集合相等守着，少一张就红）。
 *
 * 排列顺序跟着 `CARDS` 走（先 18 张 AI、后 24 张技能，各自的顺序同 `aiModels.ts`
 * 和 `skillCards.ts`），方便两张表并排对着看谁漏了。
 */
export const CARD_FACES: Record<CardId, CardFaceStyle> = {
  // ---- 18 张具名 AI 牌：插画主色 + 星章圆心 ----
  //
  // 贴边的那几张（DeepSeek 两张、豆包、GLM-5、Grok、MiniMax）不是量出来的原值，而是
  // 往里收到了圆章不掉出卡面的最小位置：它们的星章本来就压着画框，而圆章比星章大得多。
  // 收完 DeepSeek 和豆包的星章最外圈还会露 2~3px（在 1024 宽的原图上量的，手牌尺寸下看不见），
  // 再往星章靠圆章就要探出卡外了。
  'gpt-2': { accent: '#46584b', costBadge: { x: 10.9, y: 7.1 } },
  'gpt-3-5': { accent: '#46584b', costBadge: { x: 11.5, y: 7.2 } },
  'gpt-4o': { accent: '#46584b', costBadge: { x: 10.7, y: 7.1 } },
  'chatgpt-5-6-sol': { accent: '#46584b', costBadge: { x: 10.9, y: 7.2 } },
  'claude-5-sonnet': { accent: '#87502d', costBadge: { x: 11.5, y: 7.1 } },
  'claude-fable-5': { accent: '#87502d', costBadge: { x: 11.3, y: 7.1 } },
  'deepseek-r1': { accent: '#304e70', costBadge: { x: 10.7, y: 7.1 } },
  'deepseek-v4': { accent: '#304e70', costBadge: { x: 10.7, y: 7.1 } },
  // Gemini 和通义千问这两张原画的角上没画星章，没有要盖的东西，取其余各张的中位数摆齐即可。
  gemini: { accent: '#655580', costBadge: { x: 10.9, y: 8.1 } },
  qwen: { accent: '#37646b', costBadge: { x: 11.0, y: 7.1 } },
  'kimi-k2-6': { accent: '#343e48', costBadge: { x: 11.9, y: 7.1 } },
  'kimi-k3': { accent: '#343e48', costBadge: { x: 11.3, y: 7.1 } },
  doubao: { accent: '#505b77', costBadge: { x: 10.7, y: 7.1 } },
  'glm-5': { accent: '#3d4a64', costBadge: { x: 10.7, y: 7.1 } },
  minimax: { accent: '#95465f', costBadge: { x: 10.7, y: 7.1 } },
  yuanbao: { accent: '#465d49', costBadge: { x: 11.5, y: 7.3 } },
  grok: { accent: '#303939', costBadge: { x: 10.7, y: 7.1 } },
  'wenxin-yiyan': { accent: '#40596b', costBadge: { x: 11.0, y: 7.1 } },

  // ---- 24 张技能牌：从原画采的盘底色，只有四张的章印得偏、要单独给圆心 ----
  'context-flood': { costFill: '#484f4c' },
  'topic-drift': { costFill: '#404d43' },
  'repetition-bombardment': { costFill: '#59382b', costBadge: { x: 13.7, y: 9.6 } },
  'black-white-reversal': { costFill: '#434340' },
  'fixed-answer': { costFill: '#584954', costBadge: { x: 14.1, y: 10.0 } },
  'one-sentence-answer': { costFill: '#3e4a35', costBadge: { x: 12.7, y: 8.7 } },
  'character-lock': { costFill: '#323c46', costBadge: { x: 12.9, y: 8.9 } },
  'clean-sweep': { costFill: '#4b524b' },
  'jade-purification-vase': { costFill: '#47514c' },
  boomerang: { costFill: '#4f5452' },
  'golden-bell-shield': { costFill: '#525541' },
  'safe-pass': { costFill: '#4f5652' },
  'anti-addiction': { costFill: '#464f4e' },
  'compute-compression': { costFill: '#4e5451' },
  'model-distillation': { costFill: '#484c46' },
  'open-source-reproduction': { costFill: '#464f4a' },
  'nuclear-power-station': { costFill: '#4e5450' },
  'far-ahead': { costFill: '#554951' },
  'domestic-substitution': { costFill: '#4d5652' },
  'version-rollback': { costFill: '#464857' },
  'kids-mode': { costFill: '#4f5653' },
  'version-upgrade': { costFill: '#4e5552' },
  'rising-tide': { costFill: '#4e5553' },
  'memory-shortage': { costFill: '#4f5451' },
}
