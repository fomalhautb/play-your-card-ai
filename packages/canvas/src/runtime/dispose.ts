/**
 * 销毁一个正在（或可能正在）被补间的显示对象。
 *
 * 场景里的东西是随建随销的（发出去的牌、罚下的格子、上一轮的结算行），而销毁和补间收尾是
 * **两条时钟**上的事：补间归 GSAP 的根时间线，销毁归调用方自己的时机
 *（cue 排下的收尾、下一轮开场时清掉上一轮的行）。两者之间只差不到一帧，
 * 于是「按时长排的那一下销毁」偶尔会赶在补间的最后一帧**之前**发生。
 * 那一帧 GSAP 就在一个已经拆掉的对象上写属性（`container.y = …` 里的 `_position` 已经是
 * null），当场抛 TypeError——而且抛在帧循环里，整帧的后半段都不跑了。
 *
 * 所以规矩是：**凡是销毁场景里的显示对象，一律走这里**，先掐补间再拆。
 * 不要去调对齐两条时钟——那是把一条明确的规矩换成一个随时会被下一次改动打破的巧合。
 *
 * 掐的时候**要连整棵子树一起掐**：补间可能挂在任意一层后代身上（结算行里那些逐行升起的
 * 标签、卡上的角标），只掐最外面那层等于没掐。
 */

import type { Container } from 'pixi.js'
import type { Animator } from './animator'

/**
 * 掐掉这棵子树上全部的补间：节点自己、它的 `scale`，以及所有后代。
 *
 * 往下走之前要看一眼 `children` 还在不在：Pixi 的 `destroy()` 会把容器内部那几张表置空，
 * 而「同一个对象被收两次」在这套代码里是允许发生的——展示位那张卡就有两条路各兜一次底
 *（见 scenes/duel/cuePlayers/showcase.ts）。第二次进来只掐它自己，不再往下走。
 */
function killTweensOfTree(animator: Animator, node: Container): void {
  animator.killTweensOf(node)
  // `scale` 是单独的子对象，GSAP 认的是它自己，掐外面那层掐不到它。
  animator.killTweensOf(node.scale)
  const children = node.children as readonly Container[] | null | undefined
  if (children === null || children === undefined) return
  for (const child of children) killTweensOfTree(animator, child)
}

export function killAndDestroy(animator: Animator, node: Container): void {
  killTweensOfTree(animator, node)
  // 纹理一张都不销毁：卡面归调用方，烤出来的文字和边框归缓存，这里只拆对象本身。
  node.destroy({ children: true, texture: false, textureSource: false })
}
