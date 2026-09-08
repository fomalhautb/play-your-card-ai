/**
 * 组件目录页条目：中央横幅（7.1 第 3 条）。
 *
 * 状态矩阵：横幅没有普通/悬停/按下/禁用/加载这五态，全部不适用——它是一段一次性的演出，
 * 不吃指针事件，也没有加载过程。它自己的"变体"是**演到哪一拍**，也就是下面三条。
 *
 * 三条各停在一个关键帧上：淡入弹到一半、停留期间的静止帧、淡出正在放大变淡。
 * 一条横幅总共 1.4 秒（`BANNER_TOTAL_MS`），三个时刻按那三段的比例挑：
 * 淡入 0~0.3、停留 0.3~1.05、淡出 1.05~1.4。
 *
 * 命名和 title 用英文的理由见 CardSprite.stories.ts 的文件头。
 */

import { storyDeps } from '../storyCards'
import type { StoryStage } from '../storyStage'
import { Banner } from './Banner'

/** 画布尺寸。横幅最宽 860，46px 的字加上放大到 1.05 倍还要有余量。 */
const SIZE = { width: 960, height: 200 }

function mount(ctx: StoryStage, text: string) {
  const deps = storyDeps(ctx)
  const banner = new Banner(deps)
  banner.position.set(ctx.width / 2, ctx.height / 2)
  ctx.stage.addChild(banner)
  banner.show(text)
  return () => deps.dispose()
}

function spec(text: string, settleMs: number) {
  return {
    pixi: {
      ...SIZE,
      settleMs,
      mount: (ctx: StoryStage) => mount(ctx, text),
    },
  }
}

export default {
  title: 'Canvas/Banner',
  render: () => null,
}

/** 淡入到一半：字还没到原大，`back.out` 正要冲过头。150ms 落在 0~300 那段的中点。 */
export const FadingIn = { name: '淡入到一半', parameters: spec('第 3 轮 · 历史掌故', 150) }

/** 停留：整条完全不透明、原大，是这段演出里唯一静止的一拍。 */
export const Holding = { name: '停留', parameters: spec('轮到你出牌', 600) }

/** 淡出：字正一边变淡一边涨到 1.05 倍，像被推远。1250ms 落在 1050~1400 那段中间。 */
export const FadingOut = { name: '淡出', parameters: spec('对方出牌中', 1250) }
