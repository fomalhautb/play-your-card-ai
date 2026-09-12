/**
 * 一个对话框：标题、一段内容、一到两个操作。离开确认、加入房间、牌组改名都用它。
 *
 * ## 为什么是原生 `<dialog>`
 *
 * 从前这一层是自己搭的：一块 `position: fixed` 的遮罩加一张纸，还得用
 * `createPortal` 传送到 `document.body`——对局界面里那颗触发它的按钮画在画布上，
 * 而画布外层是会被 transform 缩放的舞台容器，留在原地渲染的话 `fixed` 会退化成
 * 相对那个祖先定位（CSS 规范里 transform 会给 fixed 建一个新的包含块）。
 *
 * `showModal()` 把对话框放进浏览器的**顶层**（top layer），顶层不认任何祖先的
 * transform，所以传送那一整套连同它的测试一起删掉了。顺带白拿了三样：
 * `::backdrop` 遮罩、Esc 退出、以及「底下那一屏整个变 inert（点不动也 Tab 不到）」。
 *
 * ## 关掉的三条路
 *
 * 点遮罩、按 Esc、点「取消」都走同一个 `onDismiss`。**没有取消按钮时前两条也照样通**——
 * 「只有一个确认」的对话框本来就是可以直接退掉的；真要拦住玩家的对话框不该走这个组件。
 *
 * 开关由调用方的 `open` 说了算，组件自己不改它：所以 Esc 那一下要 `preventDefault()`
 * 拦住原生的关闭，只报 `onDismiss`，等调用方把 `open` 改成 false 再卸载。
 * 不拦的话元素被浏览器关掉而 React 这边仍以为它开着，下次就再也打不开了。
 */

import { type ReactNode, useEffect, useRef } from 'react'
import { Button } from './Button'
import './dialog.css'

/** 底下那排操作里的一个。 */
export interface DialogAction {
  label: string
  onSelect: () => void
  disabled?: boolean
}

export interface DialogProps {
  /** false 时整个不渲染（连元素都不建）。 */
  open: boolean
  title: string
  /** 标题下面那段内容。不给就只有标题和按钮。 */
  children?: ReactNode
  /** 主操作。必填——一个按钮都没有的对话框退不掉。 */
  confirm: DialogAction
  /** 退让选项。不给就只有一颗按钮，那时点遮罩和按 Esc 仍然能退（见文件头）。 */
  cancel?: DialogAction
  /** 点遮罩、按 Esc，以及点「取消」时叫它。不给就这三条路都不通。 */
  onDismiss?: () => void
  /**
   * 不进顶层，就在原地开（`show()` 而不是 `showModal()`）。**只给组件目录页用**：
   * 截图回归拍的是条目那一块，进了顶层之后那一块的布局尺寸是 0，拍到的是一片空。
   * 真界面别传——不进顶层就会踩上文件头说的那个 transform 包含块的坑。
   */
  inline?: boolean
}

export function Dialog({
  open,
  title,
  children,
  confirm,
  cancel,
  onDismiss,
  inline = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  /*
   * 元素进了 DOM 之后再开。`<dialog open>` 那种写法开出来的是**非模态**的，
   * 顶层和 ::backdrop 都要靠这两个方法调，属性写不出来。
   *
   * `open` 必须在依赖里：关掉时下面那句 `return null` 只是把元素摘掉，组件本身还挂着，
   * 不重跑这个 effect 的话再开一次就只剩一个没人调 `showModal()` 的空元素
   *（原生 `<dialog>` 不 open 时是 `display: none`，界面上什么都不出现）。
   */
  useEffect(() => {
    if (!open) return
    const dialog = ref.current
    if (dialog === null || dialog.open) return
    if (inline) dialog.show()
    else dialog.showModal()
  }, [inline, open])

  if (!open) return null

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 点遮罩对应的键盘操作是原生 Esc，下面 onCancel 已经收了
    <dialog
      ref={ref}
      className="ui-dialog"
      aria-label={title}
      onCancel={(event) => {
        // 关不关由调用方决定，理由见文件头。
        event.preventDefault()
        onDismiss?.()
      }}
      onClick={(event) => {
        // 点在遮罩上时事件的目标就是 <dialog> 本身，点在里面的内容上不是。
        if (event.target === ref.current) onDismiss?.()
      }}
    >
      <h2>{title}</h2>
      {children}
      <div>
        {cancel === undefined ? null : (
          <Button disabled={cancel.disabled ?? false} onClick={cancel.onSelect}>
            {cancel.label}
          </Button>
        )}
        <Button disabled={confirm.disabled ?? false} onClick={confirm.onSelect}>
          {confirm.label}
        </Button>
      </div>
    </dialog>
  )
}
