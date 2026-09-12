/**
 * 图标 B（控件线稿图标）和图标 C（星芒与菱形）的 React 版（需求单「十、图标」）。
 *
 * 和 canvas 的 `fx/controlIcons.ts` 是**同一批图标的两套实现**，不是两个组件：
 * 画布上那份要烤成纹理给 Pixi 用，这一份是内联 SVG 给文字界面用。
 * 两边的形状照着同一份旧代码画（`BackButton`、`MuteButton`、`OrientationNotice`、
 * `FullscreenEntry` 各自内联的那几段 path）。
 *
 * ## 为什么内联 SVG，不是图标字体也不是 `<img>`
 *
 * 需求单图标 B 那条写死了：字体里的符号各家系统画风差得很远，而 `<img>` 换不了颜色。
 * 内联的 `path` 描边取 `currentColor`，换色只要改容器的 `color`——设置页那一排图标
 * 跟着文字色走，静音钮在纸面和夜色两种底上各是一档色，都靠这一条。
 *
 * ## 尺寸只有一个旋钮
 *
 * `size` 同时决定宽和高（图标全是正方形取景框）。描边粗细跟着尺寸走
 *（`stroke-width` 用 viewBox 单位，SVG 自己会缩），所以小图标不会糊成一团。
 *
 * 旧版那圈「手绘位移滤镜」不接：整套正式版界面都不再用 SVG 滤镜（同 Button.tsx 的
 * 文件头第 1 条），观感差别是线条少了一点抖动。
 */

import type { ReactNode } from 'react'
import './icon.css'

/**
 * 认得的图标名。
 *
 * 前七个是图标 B（控件线稿），后两个是图标 C（星芒与菱形，纯装饰）。
 * 需求单图标 B 里还有「离开的门」「问号」「复制」「书本」三样，画在 canvas 那边——
 * 它们只出现在对局顶栏、卡角和房间页，那三处都是画布。要用时再往这里补。
 */
export type IconName =
  | 'back'
  | 'muted'
  | 'unmuted'
  | 'fullscreen'
  | 'share'
  | 'rotate'
  | 'help'
  | 'star'
  | 'diamond'

export interface IconProps {
  name: IconName
  /** 边长（px）。默认 24，正好是取景框的原始尺寸，描边粗细在这一档最准。 */
  size?: number
}

/**
 * 一个图标的形状。
 *
 * `filled` 的那两个（星芒、菱形）用 `fill: currentColor` 且不描边——它们是实心小装饰，
 * 在 9~21px 上描边会把内部空间挤没。其余全是描边不填充的线稿。
 */
const SHAPES: Record<IconName, { filled?: true; title: string; body: ReactNode }> = {
  back: {
    title: '返回',
    body: <path d="M14.5 5.5 8 12l6.5 6.5M8 12h11" />,
  },
  unmuted: {
    title: '有声',
    body: (
      <>
        <path d="M4.6 9.4h2.4L11 6v12L7 14.6H4.6Z" />
        <path d="M14.7 10.1a2.6 2.6 0 0 1 0 3.8" />
        <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      </>
    ),
  },
  muted: {
    title: '静音',
    body: (
      <>
        <path d="M4.6 9.4h2.4L11 6v12L7 14.6H4.6Z" />
        {/* 有声那两道声波换成一个叉，喇叭本体两档共用（同旧版 MuteButton 的画法）。 */}
        <path d="m14.6 10 3.4 3.4m0-3.4-3.4 3.4" />
      </>
    ),
  },
  fullscreen: {
    title: '全屏',
    body: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  },
  share: {
    title: '分享',
    body: (
      <>
        <path d="M12 3v12M12 3l-4 4M12 3l4 4" />
        <path d="M7 11H5v10h14V11h-2" />
      </>
    ),
  },
  rotate: {
    title: '转成横屏',
    body: (
      <>
        <rect x="8.5" y="2.5" width="7" height="19" rx="1.6" />
        <path d="M10.5 4.6h3" />
        <path d="M12 19.2h.01" />
      </>
    ),
  },
  help: {
    title: '说明',
    body: (
      <>
        <circle cx="12" cy="12" r="8.6" />
        <path d="M9.6 9.6a2.4 2.4 0 1 1 2.9 2.4v1.4" />
        <path d="M12.4 16.6h.01" />
      </>
    ),
  },
  star: {
    filled: true,
    title: '星芒',
    /* 四角星：四条从中心鼓出去的尖，腰身用曲线收进去。旧版首页那颗花饰星就是这个形状。 */
    body: (
      <path d="M12 1.5c.9 6.2 2.4 8.6 8.5 10.5-6.1 1.9-7.6 4.3-8.5 10.5-.9-6.2-2.4-8.6-8.5-10.5 6.1-1.9 7.6-4.3 8.5-10.5Z" />
    ),
  },
  diamond: {
    filled: true,
    title: '菱形',
    body: <path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" />,
  },
}

export function Icon({ name, size = 24 }: IconProps) {
  const shape = SHAPES[name]
  return (
    <svg
      className="ui-icon"
      data-name={name}
      data-fill={shape.filled === true ? 'true' : undefined}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {/*
        `<title>` 是给读屏软件的，但这里每个图标都在一颗带 `aria-label` 的按钮里，
        再读一遍就重复了，所以整个 svg 用 `aria-hidden` 藏起来。
        标题仍然写出来是因为 biome 的 a11y 规则要求 svg 有标题，而且它在
        开发者工具里能一眼看出这是哪个图标。
      */}
      <title>{shape.title}</title>
      {shape.body}
    </svg>
  )
}
