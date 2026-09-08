/**
 * 效果分档，对应《正式版架构》3.7：档位决定特效开关和粒子数量。
 *
 * 分档只按 GPU 能力，不按浏览器品牌（4.4）——所以这里没有任何 UA 判断，
 * 档位是调用方（将来是启动时那个小跑分）算好传进来的。
 *
 * 三档共同的底线：**任何一档都不挂 Filter**。3.1 只要求移动端不挂，
 * 但同一个效果分两套实现就等于两套要维护、两套会跑偏，所以高档也走同一条路——
 * 发光、追光都是预烤纹理加叠加混合，不走离屏渲染。
 */

export type EffectTier = 'low' | 'mid' | 'high'

export interface TierConfig {
  /** 落地扬起的烟尘团数。旧版 DOM 那套固定 5 团，这里按档拉开。 */
  smokeCount: number
  /** 卡牌边缘那圈金色追光。 */
  edgeLight: boolean
  /** 落地时整屏抖一下。 */
  screenShake: boolean
  /** 放大的牌跟着指针倾斜。旧版在触屏上整个关掉，低档同理——每次移动都要重写一层变换。 */
  cardTilt: boolean
  /** 卡面那一小块反光。跟着倾斜一起开关，两者是同一个物理模型的两半。 */
  glare: boolean
}

export const TIER_CONFIG: Record<EffectTier, TierConfig> = {
  low: { smokeCount: 3, edgeLight: false, screenShake: true, cardTilt: false, glare: false },
  mid: { smokeCount: 5, edgeLight: true, screenShake: true, cardTilt: true, glare: true },
  high: { smokeCount: 9, edgeLight: true, screenShake: true, cardTilt: true, glare: true },
}
