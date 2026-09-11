/**
 * 新手教程的引导层：压暗无关区域 + 给目标挖个洞 + 一句话提示气泡（迁移第 32 条）。
 *
 * ## 为什么它是 React 而不是画到画布上
 *
 * 教程的提示是**成段的中文**：要换行、要按视口宽窄自适应、要能被读屏念出来，
 * 而画布上的文字是一张张烤出来的纹理（见 canvas 的 Label.ts），换行和重排都得自己算。
 * 更关键的是它**不参加性能剧本**——引导层只在教程里出现，一局教学赛总共二十来句话，
 * 不进 bench 的任何一条剧本，也就没有「文字纹理不许在动画期间新建」那条约束要守。
 * 这两条合起来，DOM 是明显更省事的一边。
 *
 * ## 三条约定
 *
 * - **整层不吃指针事件**。洞里的真实 UI 照常点得到、拖得动；「这一步不许点什么」
 *   由画布那边的锁负责（`DuelScene.setBlockedCards`、编排层的 `tutorial-gate`），
 *   不靠遮罩挡。唯一的例外是 `onNext` 那几步：纯讲解的步骤本来就把界面锁死了，
 *   玩家没有别的可点，这时才铺一层点击捕获层接住「点任意处继续」。
 * - **位置每帧现量**，不认死坐标：`measure()` 由调用方给，它问的是画布场景
 *   （`anchorRect`），而手牌会重排、卡会飞，慢一帧圈就画在空处。
 *   量完先比一遍签名，真的变了才 setState——静止时一次重渲染都不会发生。
 * - **被全屏过场盖住**。这一层压过常规界面，但抛硬币 / 答题揭晓 / 技能抵消那几段
 *   是画在**画布里**的，它们一立起来提示就该让位。所以每一句提示都挂在某段演出的
 *   收尾信号上（步骤表的 `readyOn`），由调用方决定 `active` 什么时候为真——
 *   这一层自己不认识演出。
 *
 * 它铺的是**最近那个定位祖先**（`position: absolute; inset: 0`），
 * 所以调用方要把它和画布放进同一个定位容器里，两边的坐标才对得上。
 */

import { useEffect, useRef, useState } from 'react'
import {
  holePath,
  inflate,
  type OverlayRect,
  overlaySignature,
  TIP_WIDTH,
  tipPosition,
} from './overlayGeometry'
import './tutorialOverlay.css'

export interface TutorialOverlayProps {
  /** 一句话提示。null 或空串就不画气泡（纯粹在等一段演出走完的过渡态）。 */
  instruction: string | null
  /**
   * 这一步要挖洞高亮的那几块，**每帧调一次**。
   * 返回的是引导层自己那块里的坐标（和画布是同一套，两者铺同一个容器）。
   */
  measure(): readonly OverlayRect[]
  /** 压暗无关区域，默认 true。第 3 轮的弱引导只描边不压暗。 */
  dim?: boolean
  /** 这一步的提示可以出场了。为 false 时整层什么都不画。 */
  active: boolean
  /**
   * 这一步要玩家点一下才往前走，点了就调它。
   * null / 不传 = 这一步由对局流程或玩家的实际操作推进，不铺点击捕获层、也不画「下一步」。
   */
  onNext?: (() => void) | null
  /**
   * 「刚才那一下不行」的一句话，说完由调用方自己清掉。
   *
   * 和上面那句提示分开是有意的：那一句说的是「现在该做什么」，一直挂着；
   * 这一句说的是「刚才那一下不行」，两者同时出现也不该互相顶替。
   */
  blockTip?: string | null
}

/** 量出来的那一份：洞在哪儿、这一层自己多大。 */
interface Measured {
  holes: OverlayRect[]
  stage: { w: number; h: number }
}

const EMPTY: Measured = { holes: [], stage: { w: 0, h: 0 } }

export function TutorialOverlay({
  instruction,
  measure,
  dim = true,
  active,
  onNext = null,
  blockTip = null,
}: TutorialOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState<Measured>(EMPTY)

  /*
   * `measure` 每次渲染都是新函数，所以存 ref：把它放进依赖里的话这条 rAF 每渲染一次
   * 就要重启一遍，而重启那一下会把刚量好的结果丢掉（signature 重新从空串起算）。
   */
  const measureRef = useRef(measure)
  measureRef.current = measure

  useEffect(() => {
    if (!active) {
      setMeasured((current) => (current.holes.length === 0 ? current : EMPTY))
      return
    }
    let handle = 0
    let last = ''

    const tick = () => {
      handle = requestAnimationFrame(tick)
      const root = rootRef.current
      if (root === null) return
      const stage = { w: root.clientWidth, h: root.clientHeight }
      const holes = measureRef.current().map(inflate)
      const signature = overlaySignature(holes, stage)
      if (signature === last) return
      last = signature
      setMeasured({ holes, stage })
    }

    tick()
    return () => cancelAnimationFrame(handle)
  }, [active])

  if (!active) return <div className="ui-tutorial" ref={rootRef} aria-hidden="true" />

  const { holes, stage } = measured
  const tip = tipPosition(holes, stage, onNext !== null)
  const clip = holePath(holes, stage.w, stage.h)

  return (
    <div className="ui-tutorial" ref={rootRef}>
      {dim ? (
        // 一个洞都没有时 clip 是 null，整层铺满——那种步骤只压暗、不指具体元素。
        <div
          className="ui-tutorial__shade"
          style={clip === null ? undefined : { clipPath: clip }}
          aria-hidden="true"
        />
      ) : null}
      {holes.map((rect, index) => (
        // 按序号当 key：洞的位置每帧都可能变，拿位置当 key 会每帧重建整批节点，
        // 呼吸动画刚挂上就被拆掉。个数不变时节点就稳定复用。
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: 位置每帧都在变，只有序号是稳定的
          key={index}
          className="ui-tutorial__ring"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          aria-hidden="true"
        />
      ))}
      {onNext === null ? null : (
        // 「点任意处继续」的接盘手。铺在压暗层之上、气泡之下，和气泡是兄弟节点，
        // 所以点「下一步」按钮不会顺带触发这里（事件冒泡只往父节点走）。
        // 键盘用户走气泡里那颗真按钮，这层只是给指针用的，别出现在辅助树里。
        <button
          type="button"
          className="ui-tutorial__catcher"
          onClick={onNext}
          tabIndex={-1}
          aria-hidden="true"
        />
      )}
      {instruction === null || instruction === '' ? null : (
        <div className="ui-tutorial__tip" style={{ left: tip.x, top: tip.y, width: TIP_WIDTH }}>
          {/* 提示是给玩家读的，屏幕阅读器该念出来；换一句就重念一遍。 */}
          <p className="ui-tutorial__text" role="status">
            {instruction}
          </p>
          {onNext === null ? null : (
            <button type="button" className="ui-tutorial__next" onClick={onNext}>
              下一步 <span aria-hidden="true">▸</span>
            </button>
          )}
        </div>
      )}
      {blockTip === null || blockTip === '' ? null : (
        // 摆在顶上居中，和提示气泡互不遮挡。`role="status"` 让读屏也念得到——
        // 这句话是「操作被拒」的唯一反馈。
        <p className="ui-tutorial__blocked" role="status">
          {blockTip}
        </p>
      )}
    </div>
  )
}
