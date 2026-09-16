/**
 * 组件目录页条目：牌组编辑器（7.1 第 3 条）。
 *
 * 两档版式各三条关键帧——空牌组、从卡池拖一张进来（让位中）、满 20 张。
 * 卡池和牌组用的是一份最小的假卡池（见 storyDeck.ts）：`canvas` 不许依赖 `content`，
 * 而目录页要的只是「一屏每次都长一样的卡」。
 *
 * 状态矩阵：
 *   普通    三条关键帧，两档各一套
 *   悬停    不适用。各个控件的悬停在它们自己的条目里（`Canvas/SmallButton` 那几条）
 *   按下    不适用，同上
 *   禁用    「拖入让位」那一条里，满份数的卡和翻页钮的灰态都拍得到
 *   加载    不适用。这一页没有要等的东西——卡池是现成的，存档是同步读的
 *
 * 画布尺寸取 1280×800 和 390×844，理由同 DuelScene.stories.ts：
 * 截图回归的浏览器视口钉死在 1280×900，1920 宽的条目拍不进去；
 * 而 1280 的宽仍在断点 768 之上，走的是桌面档那套版式。
 */

import { storyDeps } from '../../storyCards'
import type { StoryStage } from '../../storyStage'
import { mountDeckScene } from './DeckScene'
import { pickDeckLayout } from './layout/pickLayout'
import {
  STORY_CARD_FACES,
  STORY_CATALOG,
  STORY_FACTIONS,
  STORY_POOL,
  storyDecks,
} from './storyDeck'

const DESKTOP = { width: 1280, height: 800 }
const MOBILE = { width: 390, height: 844 }

/** 哪一套牌组，以及要不要摆成「正拖着一张」。 */
type Frame = 'empty' | 'dragging' | 'full'

function mount(ctx: StoryStage, size: { width: number; height: number }, frame: Frame) {
  const deps = storyDeps(ctx)
  const textures = ctx.textures
  if (textures === null) throw new Error('这条条目要卡面图集')

  const decks = storyDecks()
  const scene = mountDeckScene(ctx.renderer, {
    // 场景挂在目录页的渲染器上，只用这个 canvas 订「上下文丢了」那条事件。
    canvas: ctx.renderer.canvas as HTMLCanvasElement,
    width: size.width,
    height: size.height,
    resolution: ctx.resolution,
    tier: 'high',
    textures,
    cardFaces: STORY_CARD_FACES,
    catalog: STORY_CATALOG,
    pool: STORY_POOL,
    factions: STORY_FACTIONS,
    decks,
    currentId: frame === 'full' ? 'full' : frame === 'dragging' ? 'half' : 'empty',
    manualClock: true,
    // 手机档靠 390 的宽度就够了，不用再假装指针是粗的。
    coarsePointer: false,
  })
  ctx.stage.addChild(scene.root)
  ctx.onFrame(() => scene.advance(0))

  /*
   * 手机档的抽屉一进来是收着的。
   *
   * 「满 20 张」那一帧要看牌组栏，所以先手动拉开；
   * 「拖入让位」那一帧**不能**先拉开——抽屉开着时卡池整层是藏起来的（也就抓不到牌），
   * 而从卡池抓起一张牌本来就会让抽屉自己升上来（见 deck/input.ts）。
   * 桌面档没有抽屉，这两下都是空操作。
   */
  if (frame === 'full') scene.toggleDrawer()
  if (frame === 'dragging') dragFirstCard(scene, size)

  return () => {
    scene.destroy()
    deps.dispose()
  }
}

/**
 * 摆出「正从卡池拖一张进牌组栏」那一帧。
 *
 * 走的是场景对外那三个合成入口（`pressAt / moveTo / releaseAt`），
 * 和交互测试、bench 剧本喂的是同一条路——**不松手**，画面就停在让位那一刻。
 * 坐标按版式现算：两档的卡池和牌组栏位置差得远，写死一组数只有一档对得上。
 *
 * 算出来的是**舞台坐标**，而那三个入口收的是**视口坐标**（见 DeckScene 的文件头），
 * 所以要自己乘回缩放、加上居中偏移。桌面档 1280×800 下缩放是 0.7656，
 * 不换算的话落点会偏到别处去。
 */
function dragFirstCard(
  scene: ReturnType<typeof mountDeckScene>,
  size: { width: number; height: number },
): void {
  // 条目自己算一遍版式：场景内部那份不对外露，而这里只要几个坐标。判据是同一条。
  const layout = pickDeckLayout(size.width, size.height, false)
  const toView = (x: number, y: number) => ({
    x: x * layout.stage.scale + layout.stage.x,
    y: y * layout.stage.scale + layout.stage.y,
  })
  const from = toView(
    layout.poolGrid.x + layout.poolGrid.cellWidth / 2,
    layout.poolGrid.y + layout.poolGrid.cellHeight / 2,
  )
  // 落在牌组栏第 3 格附近：前面已经有几张牌，让位那一格因此夹在中间，看得出来。
  const slotCenter = toView(
    layout.slots.x + layout.slots.cellWidth / 2,
    layout.slots.y + layout.slots.cellHeight * 1.5 + layout.slots.gapY,
  )
  scene.pressAt(from.x, from.y)
  // 分两步走：第一步过起拖阈值，第二步才是真正的落点。
  scene.moveTo(from.x + 40, from.y)
  scene.moveTo(slotCenter.x, slotCenter.y)
}

function spec(size: { width: number; height: number }, frame: Frame) {
  return {
    pixi: {
      ...size,
      needsAtlas: true,
      /*
       * 推到 0.4 秒再拍。
       *
       * 这一页没有开场动画，但「拖入让位」那一帧有三段补间要落定：抓起的姿态
       *（`DRAG_POSE_DUR` 0.25）、跟手（`DRAG_FOLLOW_DUR` 0.18）、整排让位
       *（`GAP_SHIFT_DUR` 0.22，见 scenes/deck/timings.ts）。不推的话拍到的是
       * 牌还停在原格、让出来的那一格还没让开的半路画面。
       * 另外两帧没有补间，推多少步画面都一样。
       */
      settleMs: 400,
      mount: (ctx: StoryStage) => mount(ctx, size, frame),
    },
  }
}

export default {
  title: 'Canvas/DeckScene',
  render: () => null,
}

/** 桌面档：左卡池右牌组栏，一张牌都还没选。 */
export const DesktopEmpty = { name: '桌面档 · 空牌组', parameters: spec(DESKTOP, 'empty') }

/** 桌面档：从卡池拖一张进来，牌组栏让出一格等它落下。 */
export const DesktopDragging = { name: '桌面档 · 拖入让位', parameters: spec(DESKTOP, 'dragging') }

/** 桌面档：满 20 张，进度条换成深绿，「确认牌组」亮起来。 */
export const DesktopFull = { name: '桌面档 · 满 20 张', parameters: spec(DESKTOP, 'full') }

/** 手机档：上卡池下抽屉，卡池一页只排三列。 */
export const MobileEmpty = { name: '手机档 · 空牌组', parameters: spec(MOBILE, 'empty') }

/** 手机档：同一次拖入，落点跟着抽屉里那套 4 列 × 5 行的卡位走。 */
export const MobileDragging = { name: '手机档 · 拖入让位', parameters: spec(MOBILE, 'dragging') }

/** 手机档：满 20 张。 */
export const MobileFull = { name: '手机档 · 满 20 张', parameters: spec(MOBILE, 'full') }
