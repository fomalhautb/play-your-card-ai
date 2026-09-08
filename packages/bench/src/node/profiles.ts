/**
 * 两档视口。指标要按档分别看：手机档的上限比桌面严（纪律 3.1 的离屏渲染就是 0 和非 0 的差别）。
 *
 * 渲染倍率两档都是 1.5，那是纪律 3.3 的上限；4K 屏不按 2 倍渲染，就照这个数封顶。
 */

import type { EffectTier } from '../scene/contract'
import type { ProfileName } from '../thresholds'

export interface Profile {
  name: ProfileName
  width: number
  height: number
  resolution: number
  tier: EffectTier
}

export const PROFILES: readonly Profile[] = [
  { name: 'desktop', width: 1920, height: 1080, resolution: 1.5, tier: 'high' },
  { name: 'mobile', width: 390, height: 844, resolution: 1.5, tier: 'low' },
]

/** 剧本用的固定牌库。牌面 key 只是 ID，桩场景按它生成纯色纹理。 */
export const DECK: readonly string[] = [
  'gpt-2',
  'gpt-3-5',
  'gpt-4o',
  'chatgpt-5-6-sol',
  'claude-5-sonnet',
  'claude-fable-5',
  'deepseek-r1',
  'deepseek-v4',
  'gemini',
  'qwen',
  'kimi-k2-6',
  'kimi-k3',
  'doubao',
  'glm-5',
  'minimax',
  'yuanbao',
  'grok',
  'wenxin-yiyan',
]

/** 固定种子。6.9：随机定种子，同 seed 同结果。 */
export const SEED = 20260905
