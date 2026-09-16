/**
 * 销毁一张正在翻面的卡：`killAndDestroy` 必须连翻面那条补间一起掐掉。
 *
 * 为什么单开一条检查：翻面角度不是写在卡自己身上的，而是挂在 `CardSprite.flipState`
 * 这个独立小对象上补间（GSAP 按目标对象认补间），所以「掐这棵子树」那一遍如果只掐卡和它的
 * 后代，翻面补间会活过卡的销毁。漏掉的后果有两层：下一帧 GSAP 照样调 `onUpdate`，
 * 而它会在已经销毁的几何上写角点，当场抛 TypeError；就算不抛，`animator` 也一直「忙」，
 * 帧循环永远停不下来（3.6 要求没动画就停）。
 *
 * 时间走真实的那条路：和 `FrameLoop` 一样手动驱动 GSAP 根时间线（见 runtime/frameLoop.ts），
 * 而不是直接戳补间的内部状态——要盯的正是「帧循环推到下一帧时会发生什么」。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REVEAL_IN_MS } from '../src/director/timings'
import { Animator } from '../src/runtime/animator'
import { killAndDestroy } from '../src/runtime/dispose'
import { FrameLoop } from '../src/runtime/frameLoop'
import { playCue } from '../src/scenes/duel/cuePlayers/index'
import { createTestCard } from './helpers/fakeCardDeps'
import { createFakeDuelContext } from './helpers/fakeDuelContext'

let animator: Animator
let loop: FrameLoop

beforeEach(() => {
  animator = new Animator(() => loop.wake())
  loop = new FrameLoop({ manual: true, render: () => undefined, isBusy: () => animator.isBusy() })
})

afterEach(() => {
  /*
   * 断言跑完了才收尾，所以这里不会盖掉任何一条用例的结论。
   * 非收不可的原因是 GSAP 的根时间线是**全局**的：真漏下一条补间（正是这里要防的那种），
   * 它会活到下一条用例里去，把下一条也一起弄挂，报的却是上一条的错。
   */
  animator.destroy()
  // 把 GSAP 的时钟还回去，不还的话根时间线一直停在手动模式上。
  loop.destroy()
})

describe('销毁正在翻面的卡', () => {
  it('卡销毁之后，翻面补间不再往已销毁的几何上写角点', () => {
    const card = createTestCard('flip-1')
    // 和 flipToFront 同一套起手：先摆成背面，再从 180 转到 360（不是转回 0，理由见 reveal.ts）。
    card.flipState.angle = 180
    card.setFlipAngle(180)
    animator.tween(card.flipState, {
      angle: 360,
      duration: REVEAL_IN_MS / 1000,
      ease: 'power3.inOut',
      onUpdate: () => card.setFlipAngle(card.flipState.angle),
    })

    // 转到一半再销毁：补间此刻正活着，正是线上出问题的那一刻。
    loop.step(REVEAL_IN_MS / 2)
    killAndDestroy(animator, card)

    expect(() => loop.step(REVEAL_IN_MS)).not.toThrow()
    expect(animator.isBusy()).toBe(false)
  })

  it('展示卡飞入途中被 reveal-abort 收掉，不抛错也不留下补间', () => {
    const { ctx } = createFakeDuelContext()
    /*
     * 只把这条链路上「真的会被补间和销毁碰到」的两样换成真货：补间总管和卡本身。
     * 其余零件保持假的记账函数——展示层飞到哪儿、遮罩怎么淡，这条检查一概不看。
     */
    const context = ctx as unknown as {
      deps: { animator: Animator }
      makeCard: (cardId: string, id: string, foeBack?: boolean) => unknown
    }
    context.deps.animator = animator
    context.makeCard = (_cardId, id) => createTestCard(id)

    playCue(ctx, {
      kind: 'reveal-enter',
      at: 0,
      durationMs: REVEAL_IN_MS,
      cardId: 'fake-ai',
      handInstanceId: 'h9',
      cardKind: 'ai',
      fromOrigin: true,
    })
    loop.step(REVEAL_IN_MS / 2)
    // 答题阶段开始时编排层发的那一条（见 director/reveal.ts 的 abortReveal）：卡当场收掉。
    playCue(ctx, { kind: 'reveal-abort', at: 0, durationMs: 200 })

    expect(() => loop.step(REVEAL_IN_MS)).not.toThrow()
    expect(animator.isBusy()).toBe(false)
  })
})
