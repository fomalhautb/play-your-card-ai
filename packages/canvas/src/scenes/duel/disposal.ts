/**
 * 销毁一个正在（或可能正在）被补间的显示对象。
 *
 * 场景里的卡是随发随建随销的，而销毁和补间收尾是**两条时钟**上的事：
 * 补间归 GSAP 的根时间线，销毁归场景自己的虚拟时钟（cue 排下的收尾）。
 * 两条时钟由同一个 `step` 推，但编排层每帧比场景先走一步，所以场景的时钟会比 GSAP 快上
 * 不到一帧——于是「按时长排的那一下销毁」偶尔会赶在补间的最后一帧**之前**发生。
 * 那一帧 GSAP 就在一个已经拆掉的对象上写属性，当场抛 TypeError。
 *
 * 所以规矩是：**凡是销毁场景里的显示对象，一律走这里**，先掐补间再拆。
 * 不要去调对齐两条时钟——那是把一条明确的规矩换成一个随时会被下一次改动打破的巧合。
 */

import type { Container } from 'pixi.js'
import type { Animator } from '../../runtime/animator'

export function killAndDestroy(animator: Animator, node: Container): void {
  animator.killTweensOf(node)
  // `scale` 是单独的子对象，GSAP 认的是它自己，掐外面那层掐不到它。
  animator.killTweensOf(node.scale)
  // 纹理一张都不销毁：卡面归调用方，烤出来的文字和边框归缓存，这里只拆对象本身。
  node.destroy({ children: true, texture: false, textureSource: false })
}
