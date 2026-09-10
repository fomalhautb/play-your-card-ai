/**
 * 画布外的 React 组件库：按钮、边框、列表、弹窗、表单。
 *
 * 只服务文字型界面（设置、商店、账号、弹窗、列表），这些界面自己做响应式，不依赖画布。
 * 每种组件只有编号的变体，界面代码只能选变体、传数据，不能自己画（见《正式版架构》7.1）。
 * 允许依赖：`design`（令牌）、`platform`（平台能力）。
 * 不依赖 `canvas`——两套组件库并列，互相不引用。
 *
 * 现在装着的是迁移第 21 条那批：按钮 A（墨蓝匾额）和弹窗 A（纸面对话框），
 * 也就是对局界面在画布之外唯一要用到的两样（离开确认那个弹窗）。
 * 其余变体按需求单（docs/design/组件需求单.md）在用到时补，不先建完整再用。
 *
 * 每个组件的样式跟着组件走（同名 .css，7.2 第 4 条），数值一律读 `@ai-duel/design`
 * 的 CSS 变量。变量要由应用壳 import 一次 `@ai-duel/design/tokens.css` 挂到 :root 上，
 * 这个包自己不 import 它——那样每个用到组件的页面都会重复引一遍同一份变量。
 */

export type { ButtonProps, ButtonState, ButtonVariant } from './Button'
export { Button } from './Button'
export type { DialogAction, DialogProps } from './Dialog'
export { Dialog } from './Dialog'
