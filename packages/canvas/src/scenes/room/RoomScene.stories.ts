/**
 * 组件目录页条目：房间页（7.1 第 3 条）。
 *
 * 三条对应这一页的三种局面：什么都没开始、开了房在等人、双方都就绪。
 * 每条只是摆一份 `RoomView`——这一页是哑的（见 roomContract.ts），
 * 摆什么状态就长什么样，没有需要跑一段脚本才到得了的画面。
 *
 * 状态矩阵：
 *   普通    三条，见下面
 *   悬停    不适用。素方块没有悬停的视觉态（见 Box.ts）
 *   按下    不适用，同上
 *   禁用    「双方就绪」那条里的「已准备」就是禁用档
 *   加载    「正在匹配…」那半档由 `phase: 'busy'` 摆出来，并到「空房」之外单开一条没有价值
 *
 * 画布取 720×520：比面板（560×400）大一圈，能一起拍到面板下面那一条提示。
 * 命名和 title 用英文的理由见 client 的 dev/storybook/README.md。
 */

import type { StoryStage } from '../../storyStage'
import { mountRoomScene } from './RoomScene'
import type { RoomView } from './roomContract'

const SIZE = { width: 720, height: 520 }

/** 三条共用的底子，每条只改自己那几项。 */
const BASE: RoomView = {
  account: '游客 3f2a',
  phase: 'idle',
  status: null,
  code: null,
  ready: 'hidden',
  notice: null,
}

function mount(ctx: StoryStage, view: RoomView) {
  const scene = mountRoomScene(ctx.renderer, {
    // 场景挂在目录页的渲染器上，这个 canvas 只是拿来对齐尺寸。
    canvas: ctx.renderer.canvas as HTMLCanvasElement,
    ...SIZE,
    resolution: ctx.resolution,
    manualClock: true,
  })
  ctx.stage.addChild(scene.root)
  ctx.onFrame((deltaMs) => scene.advance(deltaMs))
  scene.setView(view)
  return () => scene.destroy()
}

function spec(view: RoomView) {
  return {
    pixi: {
      ...SIZE,
      // 不用 settleMs：这一页一条补间都没有，摆完那一帧就是最终画面。
      mount: (ctx: StoryStage) => mount(ctx, view),
    },
  }
}

export default {
  title: 'Canvas/RoomScene',
  render: () => null,
}

/** 什么都没开始：三颗入口钮竖着排，「匹配」在最上面。 */
export const Idle = { name: '空房', parameters: spec(BASE) }

/** 开了房，码已经到手，在等朋友念这个码进来。 */
export const Waiting = {
  name: '有码等待',
  parameters: spec({
    ...BASE,
    phase: 'room',
    code: '4821',
    status: '等对方进房…',
    ready: 'idle',
  }),
}

/** 双方都点过准备：「已准备」压到 0.4 透明度，只等服务端开局。下面那条提示是掉线过一次的样子。 */
export const BothReady = {
  name: '双方就绪',
  parameters: spec({
    ...BASE,
    phase: 'room',
    code: '4821',
    status: '对方已准备，就要开始了',
    ready: 'done',
    notice: '和服务器断开了，正在重连…',
  }),
}
