/**
 * 画布外的 React 组件库：按钮、边框、列表、弹窗、表单。
 *
 * 只服务文字型界面（设置、账号、关于、结算、加载页、弹窗），这些界面自己做响应式，
 * 不依赖画布。每种组件只有编号的变体，界面代码只能选变体、传数据，不能自己画
 *（见《正式版架构》7.1）。
 * 允许依赖：`design`（令牌）、`platform`（平台能力）。
 * 不依赖 `canvas`——两套组件库并列，互相不引用。
 *
 * 现在装着的是两批：
 *
 * - 第 21 / 27 / 28 条那批，也就是对局和房间页在画布之外非要不可的几样：
 *   按钮 A（墨蓝匾额，离开确认弹窗上那两颗）、弹窗 A（纸面对话框）、
 *   输入框 A（纸面数字框，「填四位房间码」是唯一非要真的 `<input>` 不可的事，
 *   见 CodeInput.tsx 的文件头）、单行输入框（构筑页改名用）。
 * - 第 31 条那批，四个文字界面（结算、设置、账号、关于）加加载页要用的：
 *   面板 H（`Sheet` 羊皮纸结算底板）、弹窗 E（`Veil` 结算遮罩）、条 B（`ProgressBar`）、
 *   条 D（`CardLoader`）、提示 E（`Notice`）、图标 B / C（`Icon`）、
 *   按钮 J（`SealButton` 夜色圆章）、设置开关（`Toggle`）、文字页外壳（`Page`）。
 *
 * 第 32 条那一个：新手教程的引导层（`TutorialOverlay`，压暗 + 挖洞 + 一句话气泡）。
 * 它在需求单里也没有编号——旧版那一层是就地写在 tutorial.css 里的。
 * 选 React 而不是画到画布上的理由写在它自己的文件头里。
 *
 * `Toggle` 和 `Page` 在需求单里还没有编号（旧版压根没有设置页），
 * 理由各写在自己的文件头里。其余变体按需求单（docs/design/组件需求单.md）在用到时补，
 * 不先建完整再用。
 *
 * 每个组件的样式跟着组件走（同名 .css，7.2 第 4 条），数值一律读 `@ai-duel/design`
 * 的 CSS 变量。变量要由应用壳 import 一次 `@ai-duel/design/tokens.css` 挂到 :root 上，
 * 这个包自己不 import 它——那样每个用到组件的页面都会重复引一遍同一份变量。
 */

export type { ButtonProps, ButtonState, ButtonVariant } from './Button'
export { Button } from './Button'
export type { CardLoaderProps } from './CardLoader'
export { CardLoader } from './CardLoader'
export type { CodeInputProps } from './CodeInput'
export { CodeInput } from './CodeInput'
export type { DialogAction, DialogProps } from './Dialog'
export { Dialog } from './Dialog'
export type { IconName, IconProps } from './Icon'
export { Icon } from './Icon'
export type { NoticeProps, NoticeTone } from './Notice'
export { Notice } from './Notice'
export type { OverlayRect } from './overlayGeometry'
export type { PageProps } from './Page'
export { Page } from './Page'
export type { ProgressBarProps } from './ProgressBar'
export { ProgressBar } from './ProgressBar'
export type { SealButtonProps, SealButtonState } from './SealButton'
export { SealButton } from './SealButton'
export type { SheetProps, SheetTone } from './Sheet'
export { Sheet } from './Sheet'
export type { TextFieldProps } from './TextField'
export { TextField } from './TextField'
export type { ToggleProps, ToggleState } from './Toggle'
export { Toggle } from './Toggle'
export type { TutorialOverlayProps } from './TutorialOverlay'
export { TutorialOverlay } from './TutorialOverlay'
export type { VeilProps } from './Veil'
export { Veil } from './Veil'
