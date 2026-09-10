/**
 * 面板内嵌提示条（需求单提示 A）：贴在一块面板底边的一行小字，说清这一屏能怎么操作。
 *
 * 构筑页上有两条：卡池底边那条（「问号看背面 · 点击放大 · 加号或拖拽加入」）和
 * 牌组栏底边那条（「点减号移除 · 拖回卡池也行」）。它们压在两种底上，所以有两档配色。
 *
 * 纯显示，不吃指针事件。换文案会**重建那行字**（字要现烤一张纹理，见 Label），
 * 所以调用方只在提示真的变了的时候调 `setText`——别每帧调。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics } from 'pixi.js'
import type { TextTextureCache } from '../runtime/textCache'
import { Label } from './Label'

/** 提示条上那行字的字号和字距。组件私有，不进令牌（理由见 design 的 README）。 */
const HINT_TYPE = { fontSize: 12, letterSpacing: 0.72 } as const

/** 压在哪种底上。`dark` 是夜色卡池，`paper` 是纸面牌组栏。 */
export type HintTone = 'dark' | 'paper'

export interface HintBarDeps {
  text: TextTextureCache
}

export interface HintBarOptions {
  width: number
  height: number
  tone?: HintTone
  text?: string
}

export class HintBar extends Container {
  private readonly deps: HintBarDeps
  private readonly plate = new Graphics()
  private readonly slot = new Container()
  private readonly tone: HintTone
  private boxWidth: number
  private boxHeight: number
  private content: string | null = null

  constructor(options: HintBarOptions, deps: HintBarDeps) {
    super()
    this.deps = deps
    this.tone = options.tone ?? 'dark'
    this.boxWidth = options.width
    this.boxHeight = options.height
    this.eventMode = 'none'
    this.addChild(this.plate, this.slot)
    this.paint()
    this.setText(options.text ?? '')
  }

  resize(width: number, height: number): void {
    if (width === this.boxWidth && height === this.boxHeight) return
    this.boxWidth = width
    this.boxHeight = height
    this.paint()
    this.place()
  }

  /** 换一行字。内容没变就什么都不做——重建一次要新烤一张纹理。 */
  setText(text: string): void {
    if (text === this.content) return
    this.content = text
    for (const child of this.slot.removeChildren()) child.destroy({ children: true })
    if (text === '') return
    const label = new Label(
      // 太长就整体缩一档，不换行也不裁字：这条只有一行高。
      text,
      { ...HINT_TYPE, maxWidth: Math.max(1, this.boxWidth - 24) },
      this.deps,
      this.tone === 'dark' ? tokens.color.deck.chipInk : tokens.color.paper.inkMuted,
    )
    this.slot.addChild(label)
    this.place()
  }

  private place(): void {
    const [label] = this.slot.children
    label?.position.set(this.boxWidth / 2, this.boxHeight / 2)
  }

  private paint(): void {
    this.plate.clear()
    if (this.tone === 'dark') {
      // 夜色档：比底板再深一点的一条，靠透明度压出来，不另配一个颜色令牌。
      this.plate
        .rect(0, 0, this.boxWidth, this.boxHeight)
        .fill({ color: tokens.color.paper.navy, alpha: tokens.opacity.deck.hintBase })
      return
    }
    this.plate
      .rect(0, 0, this.boxWidth, this.boxHeight)
      .fill({ color: tokens.color.paper.shade })
      .stroke({ width: 1, color: tokens.color.paper.line })
  }
}
