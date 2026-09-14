/**
 * 渐隐带的模具。
 *
 * 从前这个文件里还有雕花框的角和两块吊匾（「下一题」纸匾、「对方回合」吊匾），
 * 正式版简化第 4 步之二把对局页剥成素方块之后没人用了，连同 `OrnateFrame` 和
 * `Panel` 的那几档变体一起删掉；剩下渐隐带这一份，构筑页的分隔线还在用。
 *
 * 规矩和 plaqueShapes 一样：画成白色，用的时候靠 tint 上色。
 */

import { Graphics } from 'pixi.js'
import { type Mold, mold } from './mold'

/** 渐隐带的采样段数。32 段被拉到几百像素宽之后仍然看不出台阶。 */
const RAMP_STEPS = 32

/**
 * 一条从全透明渐变到全不透明的白带，横向。
 *
 * 分隔线两端的淡出全靠它：贴一张往右渐显的图，再贴一张左右翻转的，中间就是最实的一段。
 * 不用 Graphics 的渐变填充——那条路在不同后端上的插值不完全一致（4.4 要求各浏览器一样），
 * 而一排纯色方块的结果是确定的（同 bakedTextures 里那团柔光）。
 */
export function drawRamp(): Mold {
  const g = new Graphics()
  for (let i = 0; i < RAMP_STEPS; i += 1) {
    g.rect(i, 0, 1, 1).fill({ color: 0xffffff, alpha: (i + 1) / RAMP_STEPS })
  }
  return mold(RAMP_STEPS, 1, g)
}
