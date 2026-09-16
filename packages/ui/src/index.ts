/**
 * 画布外的 React 组件库：按钮、弹窗、表单、文字页外壳。
 *
 * 只服务文字型界面（设置、账号、关于、结算、弹窗），这些界面自己做响应式，
 * 不依赖画布。不依赖 `canvas`——两套组件库并列，互相不引用。
 *
 * ## 现在全是素方块
 *
 * 正式版简化第 3 步（视觉整套重做的前一步）把这里的样式**全部剥掉**了：
 * 没有颜色、字体、圆角、阴影、动画、图标，能用原生元素默认外观的就不写样式，
 * 写出来的几个 `.css` 文件里只剩摆位（铺满、一列、居中、边框、遮罩那一档黑）。
 * 编号变体（按钮 A~D）和「用 prop 摆出悬停 / 按下」那套目录页专用的摆态也一起去掉了——
 * 前者没有第二档可选，后者没有样式可拍。
 *
 * 跟着一起删掉的两样：`Icon`（只有按钮和 `Page` 内部在用，两者改成文字后没人用）、
 * 令牌一览那条目录页条目（对素方块没有意义）。
 *
 * ## 按钮只有一种
 *
 * 2026-09-16 起**只有 `Button` 一种按钮**：原来那颗 `SealButton` 只多一个 `pressed`，
 * 剥成素方块之后连长相都一样了，合并进 `Button`（开关语义由 `pressed` 继续管）。
 * 它也是这个包里唯一一个写了视觉的组件——长相对齐画布上的素方块，
 * 剩下的组件仍然只有摆位（见 Button.tsx）。要第二种按钮等视觉整套重做时再议。
 *
 * 每个组件仍然保留一条目录页条目（`XXX.stories.tsx`，7.1 第 3 条），
 * 截图回归的机制要留着，重做视觉时它就是第一道检查。
 */

export type { ButtonProps } from './Button'
export { Button } from './Button'
export type { CodeInputProps } from './CodeInput'
export { CodeInput } from './CodeInput'
export type { DialogAction, DialogProps } from './Dialog'
export { Dialog } from './Dialog'
export type { NoticeProps, NoticeTone } from './Notice'
export { Notice } from './Notice'
export type { PageProps } from './Page'
export { Page } from './Page'
export type { SheetProps } from './Sheet'
export { Sheet } from './Sheet'
export type { TextFieldProps } from './TextField'
export { TextField } from './TextField'
export type { ToggleProps } from './Toggle'
export { Toggle } from './Toggle'
export type { VeilProps } from './Veil'
export { Veil } from './Veil'
