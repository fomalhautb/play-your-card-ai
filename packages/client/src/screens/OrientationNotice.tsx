/**
 * 竖屏提示：请把手机横过来玩。从旧版 `ui/OrientationNotice.tsx` 搬过来。
 *
 * 为什么必须有：对局界面是两档并列的版式（见 canvas 的 scenes/duel/layout），
 * 但两档都是横的——竖屏下战场那一排五格和底下的手牌区上下叠不下。
 * 所以竖屏不是「排版差一点」，而是根本没法玩，与其做第三套版式，不如让玩家转个手腕
 *（绝大多数横版手游的做法）。
 *
 * ## 判据是两条都成立
 *
 * 竖屏 **且** 主指针是粗指针。只判竖屏的话，把电脑浏览器窗口拖成竖条的人也会被弹一脸提示，
 * 而他们本来就该自己拉宽窗口；`pointer: coarse` 描述的是主指针设备的精度，
 * 手机平板才为真，恰好是这条提示要拦的人（旧版同一条理由）。
 *
 * 两条都从 `platform.safeArea` 问：方向由它的快照给（转屏、地址栏伸缩、软键盘顶上来
 * 那些情况它自己都算过了），粗指针由 `isCoarsePointer()` 给。
 * 自己去 `matchMedia` 问等于把平台判断散到界面里（架构第 2 节第 5 条）。
 *
 * ## 两颗按钮
 *
 * 「一键横屏」进全屏 + 锁横屏，玩家不用转手机、也不用去关系统的旋转锁定。
 * 支持不了的设备（iPhone 上两样都没有）不摆它，提示退回纯文字版。
 * 「仍要继续」是给「系统开了旋转锁定、又按不了一键横屏」的人留的出口——
 * 没有它他们就被永久挡在门外了。关掉之后转回横屏再转回竖屏会重新弹：
 * 这一次关闭只对**当前这一次竖屏**有效，不写存档，理由和整块提示一样（它本就该是临时的）。
 */

import { Dialog } from '@ai-duel/ui'
import { useEffect, useState } from 'react'
import { usePlatform } from '../app/platform'

export function OrientationNotice() {
  const platform = usePlatform()
  /** 初值恒为 false、进 effect 再判：首帧不弹，免得它抢在页面画出来之前先糊在屏幕上。 */
  const [portrait, setPortrait] = useState(false)
  /** 玩家按过「仍要继续」。转回横屏时清掉（见下面 apply）。 */
  const [dismissed, setDismissed] = useState(false)
  /**
   * 「一键横屏」能不能用。浏览器支持什么一开始就定死，只算一次。
   * 两个条件都要：光能全屏、锁不了方向的话（比如 iPad Safari），按下去画面变大但没转过来，
   * 玩家会以为按钮坏了，不如不给。
   */
  const [canRotate] = useState(
    () => platform.fullscreen.isSupported() && platform.fullscreen.canLockOrientation(),
  )

  useEffect(() => {
    const coarse = platform.safeArea.isCoarsePointer()
    const apply = (orientation: string): void => {
      const next = coarse && orientation === 'portrait'
      setPortrait(next)
      // 离开竖屏就把「仍要继续」忘掉：下一次转回竖屏是新的一次，该重新提示。
      if (!next) setDismissed(false)
    }
    apply(platform.safeArea.metrics().orientation)
    return platform.safeArea.onChange((metrics) => apply(metrics.orientation))
  }, [platform])

  return (
    <Dialog
      open={portrait && !dismissed}
      title="请横屏游玩"
      confirm={
        canRotate
          ? {
              label: '一键横屏',
              // 必须在这个点击回调里同步发起：全屏和方向锁都只认用户手势。
              onSelect: () => void platform.fullscreen.enterLandscape(),
            }
          : { label: '仍要继续', onSelect: () => setDismissed(true) }
      }
      // 能一键横屏时「仍要继续」退到次要位置；不能时它就是唯一那颗，上面已经摆过了。
      cancel={canRotate ? { label: '仍要继续', onSelect: () => setDismissed(true) } : undefined}
    >
      {canRotate
        ? '这一局要横屏才排得下战场和手牌。点下面这颗，画面会自动转成横屏并铺满。'
        : '这一局要横屏才排得下战场和手牌。把手机横过来，画面会自动铺满。'}
    </Dialog>
  )
}
