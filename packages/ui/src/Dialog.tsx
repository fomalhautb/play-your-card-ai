/**
 * 弹窗 A（纸面对话框）：盖在全屏遮罩上的一张纸，标题、一段说明、一到两个操作。
 *
 * 需求单去重记录第 6 条：旧版的离开确认、全屏提示、竖屏提示是同一套 CSS 抄了三遍，
 * 只有底部内边距差 2~4px。这里合成一个组件，三处将来都用它。
 *
 * ## 为什么要传送到 `document.body`
 *
 * 对局界面里那颗触发它的按钮画在画布上，而画布外层是会被缩放的舞台容器。
 * 留在原地渲染的话，`position: fixed` 会退化成相对那个带 transform 的祖先定位
 *（CSS 规范里 transform 会给 fixed 建一个新的包含块），弹窗跟着舞台一起缩小、还可能跑偏。
 * 传送到 body 之后它只认视口，和触发它的地方在哪一层无关。
 *
 * ## 关掉的三条路
 *
 * 点遮罩、按 Esc、点「取消」都走同一个 `onDismiss`。**没有取消按钮时前两条也照样通**——
 * 「只有一个确认」的对话框（比如全屏提示）本来就是可以直接退掉的；
 * 真要拦住玩家的对话框不该走这个组件，那属于另一档设计。
 *
 * 遮罩写成一颗真按钮而不是给 `<div>` 挂 onClick：那样它自带键盘可达和无障碍语义，
 * 不用为了糊弄 lint 往里塞一堆 role 和 onKeyDown。
 */

import { type ReactNode, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import './dialog.css'

/** 底下那排操作里的一个。 */
export interface DialogAction {
  label: string
  onSelect: () => void
  disabled?: boolean
}

export interface DialogProps {
  /** false 时整个不渲染（连遮罩都不建），退场动画留到真需要时再说。 */
  open: boolean
  title: string
  /** 标题下面那段说明。不给就只有标题和按钮。 */
  children?: ReactNode
  /** 主操作。必填——一个按钮都没有的对话框退不掉。 */
  confirm: DialogAction
  /** 退让选项。不给就只有一颗按钮，那时点遮罩和按 Esc 仍然能退（见文件头）。 */
  cancel?: DialogAction
  /** 点遮罩、按 Esc，以及点「取消」时叫它。不给就这三条路都不通。 */
  onDismiss?: () => void
  /**
   * 就地渲染，不传送到 body。**只给组件目录页用**：截图回归拍的是条目那一块
   *（见 client/dev/storybook/catalog.spec.ts），传送出去之后那一块里就什么都没有了。
   * 真界面别传——不传送就会踩上文件头说的那个 transform 包含块的坑。
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
  /*
   * Esc 挂在 document 上而不是面板上：面板刚出现时焦点还在触发它的那颗按钮上，
   * 挂在面板上要先抢焦点才收得到键盘事件，而抢焦点会把玩家原来的焦点位置弄丢。
   */
  useEffect(() => {
    if (!open || onDismiss === undefined) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onDismiss])

  if (!open) return null

  const layer = (
    <div className="ui-dialog" data-inline={inline ? 'true' : undefined}>
      {/*
        遮罩**永远画**，只有「点得动」这一档跟着 `onDismiss` 走。
        原来是没有 onDismiss 就整块不渲染，于是那种对话框浮在一片没压暗的页面上——
        底色是这块遮罩自己带的（见 dialog.css），不画它就等于没有底色。
        竖屏提示就是这一档（它要玩家从两颗钮里挑一条路，不给点一下就退掉的口子）。
      */}
      {onDismiss === undefined ? (
        <div className="ui-dialog__scrim" aria-hidden="true" />
      ) : (
        <button
          type="button"
          className="ui-dialog__scrim"
          aria-label="关闭对话框"
          onClick={onDismiss}
        />
      )}
      <div className="ui-dialog__panel" role="dialog" aria-modal="true" aria-label={title}>
        <p className="ui-dialog__title">{title}</p>
        {children === undefined ? null : <div className="ui-dialog__body">{children}</div>}
        <div className="ui-dialog__actions">
          {cancel === undefined ? null : (
            <Button disabled={cancel.disabled ?? false} onClick={cancel.onSelect}>
              {cancel.label}
            </Button>
          )}
          <Button disabled={confirm.disabled ?? false} onClick={confirm.onSelect}>
            {confirm.label}
          </Button>
        </div>
      </div>
    </div>
  )
  return inline ? layer : createPortal(layer, document.body)
}
