/**
 * 从"一串图集里的贴图名"推出一张卡的展示数据。
 *
 * 这是**原型专用的临时桥**：正式版的卡名、费用、主色都来自 `packages/content`，
 * 而验证阶段的场景契约只收一串贴图名（`deck: string[]`），拿不到那些数据。
 * 接上 content 之后（迁移第 12 条）这个文件整个删掉，改成直接传 CardVisual。
 *
 * 推导必须是确定性的：同一个贴图名永远得到同一个费用和同一种颜色。
 * 6.9 要求同一段剧本在任何机器上产生的确定性指标一模一样，费用数字一变，
 * 文字纹理的数量和绘制批次就跟着变。
 */

import type { Texture } from 'pixi.js'
import type { CardVisual } from '../components/CardSprite'

/** 费用的取值范围，和 core 里那批卡的费用区间对齐。 */
const MIN_COST = 1
const MAX_COST = 8

/**
 * 圆章底色的备选。取自设计令牌的主题色板——原型里没有每张原画的采样色，
 * 按贴图名稳定地挑一个，至少能让相邻的几张牌颜色分得开。
 */
const ACCENT_PALETTE = [0x46584b, 0x87502d, 0x304e70, 0x655580, 0x37646b, 0x95465f, 0x3d4a64]

/**
 * 把贴图名摊成一个 32 位整数。
 *
 * 用 FNV-1a，只求"不同名字分得开"，不需要抗碰撞——撞了也只是两张牌费用一样。
 * 和旧客户端 cardArt.ts 挑占位图用的是同一套哈希，行为可以对着比。
 */
function hashOf(key: string): number {
  let hash = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  // >>> 0 把 32 位有符号结果转成无符号，省掉负数取模那一层判断。
  return hash >>> 0
}

/**
 * 贴图名转成印在铭牌上的名字：连字符换空格，每段首字母大写。
 * `gpt-4o` → `Gpt 4o`。原型里够用，正式版读 content 里的正式卡名。
 */
function displayNameOf(key: string): string {
  return key
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0]?.toUpperCase() + part.slice(1)))
    .join(' ')
}

/**
 * 建一张卡的展示数据。
 *
 * @param key 图集里的贴图名，同时也是这张牌在牌库里的标识。
 * @param instance 同一个贴图名可能在牌库里出现好几次，所以牌的 id 要再带一个序号，
 *   否则扇形按 id 认牌时两张会互相顶掉。
 */
export function cardVisualOf(
  key: string,
  instance: number,
  face: Texture,
  back: Texture,
): CardVisual {
  const hash = hashOf(key)
  const accent = ACCENT_PALETTE[hash % ACCENT_PALETTE.length] ?? ACCENT_PALETTE[0] ?? 0x304e70
  return {
    id: `${key}#${instance}`,
    name: displayNameOf(key),
    cost: MIN_COST + ((hash >>> 8) % (MAX_COST - MIN_COST + 1)),
    face,
    back,
    accent,
  }
}
