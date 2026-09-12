/**
 * 组件目录页条目：底板（7.1 第 3 条）。
 *
 * 状态矩阵：普通一条，其余四态全部不适用——底板是背景，不吃指针事件，也没有加载过程。
 * 需求单里面板 A / B / C / D / E / F / G / M 的状态那一行写的都是「普通 ✓ · 其余 —」。
 *
 * 一个变体一条，侧栏底板（B）两档配色各一条（见 Panel.ts 的 `tone`）。
 * 每条只画底板本身，上面不摆任何内容——面板不装内容（见 Panel.ts 的文件头），
 * 拍的就是「这块底长什么样」。
 */

import { bakeUiTextures } from '../fx/uiTextures'
import type { StoryStage } from '../storyStage'
import { Panel, type PanelOptions, type PanelVariant } from './Panel'

/** 默认画布。Token 细条是 44×470 的竖长条，装不下，单独放大画布。 */
const SIZE = { width: 360, height: 300 }
const CANVAS: Partial<Record<PanelVariant, { width: number; height: number }>> = {
  E: { width: 200, height: 520 },
}

/** A~D 的尺寸由版式定，这里各给一个够看清的。 */
const GIVEN: Partial<Record<PanelVariant, { width: number; height: number }>> = {
  A: { width: 320, height: 260 },
  B: { width: 200, height: 240 },
  C: { width: 320, height: 72 },
  D: { width: 320, height: 240 },
}

function mount(ctx: StoryStage, options: PanelOptions) {
  const ui = bakeUiTextures(ctx.renderer)
  const given = GIVEN[options.variant]
  const panel = new Panel({ ...options, width: given?.width, height: given?.height }, { ui })
  panel.position.set((ctx.width - panel.boxWidth) / 2, (ctx.height - panel.totalHeight) / 2)
  ctx.stage.addChild(panel)
  return () => ui.destroy()
}

function spec(options: PanelOptions) {
  return {
    pixi: {
      ...(CANVAS[options.variant] ?? SIZE),
      mount: (ctx: StoryStage) => mount(ctx, options),
    },
  }
}

export default {
  title: 'Canvas/Panel',
  render: () => null,
}

/** 纸面页底：整页那张纸，四周一圈往里收的暗角。构筑页那几块纸面的地基。 */
export const Page = { name: '纸面页底', parameters: spec({ variant: 'A' }) }

/** 侧栏底板（对局档）：一整块纸，右缘一条竖描边。 */
export const Sidebar = { name: '侧栏底板 · 对局', parameters: spec({ variant: 'B' }) }

/** 侧栏底板（构筑档）：纸色暗一档、四周一整圈框、圆角 4。 */
export const SidebarDeck = {
  name: '侧栏底板 · 构筑',
  parameters: spec({ variant: 'B', tone: 'deck' }),
}

/** 顶栏：横贯整幅的纸带，下沿一深一浅两条线。 */
export const Topbar = { name: '顶栏', parameters: spec({ variant: 'C' }) }

/** 夜色卡池底板：深蓝底、一圈描边、内缘一道极淡的高光。 */
export const CardPool = { name: '夜色卡池底板', parameters: spec({ variant: 'D' }) }

/** Token 细条：吊在战场右缘，只有左边两个角是圆的。 */
export const TokenRail = { name: 'Token 细条', parameters: spec({ variant: 'E' }) }

/** 下一题纸匾：三道框线、四角卷草、上下冠饰、两侧铆钉，外加两根吊绳。 */
export const NextPlaque = { name: '下一题纸匾', parameters: spec({ variant: 'F' }) }

/** 对方回合吊匾：深蓝匾体加一圈框线，外加两根吊绳。 */
export const TurnPlaque = { name: '对方回合吊匾', parameters: spec({ variant: 'G' }) }

/** 技能说明卡背：铺满一张卡的米色纸面，里面一圈细线。 */
export const SkillBack = { name: '技能说明卡背', parameters: spec({ variant: 'M' }) }
