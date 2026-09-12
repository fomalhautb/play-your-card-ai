/**
 * 常驻的全屏入口：画面角上那颗小圆章，以及 iOS 专用的「添加到主屏幕」三步引导。
 * 从旧版 `ui/FullscreenEntry.tsx` 搬过来。
 *
 * 为什么需要它：手机浏览器的地址栏和底栏吃掉的是高度，而横屏手机上对局那一档版式
 * 恰好被高度卡住（战场、手牌区、顶栏上下叠着排，见 canvas 的 mobileLayout）——
 * 少一条栏，整块画面就大一圈。
 *
 * 两条分叉，判据是浏览器给不给整页全屏（`platform.fullscreen.isSupported()`，
 * 纯特性检测不看 UA）：
 * - 给（安卓 Chrome 等）：点下去当场进全屏并锁横屏，一步到位。
 * - 不给（iPhone / iPad 的 Safari 和 Chrome，iOS 上都是同一个 WebKit）：
 *   网页这条路是死的，唯一能去掉地址栏的办法是把站点加到主屏幕、再从图标启动，
 *   所以点下去弹的是那份三步引导。
 *
 * 什么时候整个不出现：细指针（桌面，人家有 F11）、已经在全屏里、
 * 以及已经从主屏幕图标启动（`isStandalone()`）——那时地址栏本来就没了，再劝就是骚扰。
 *
 * ## 和旧版的两处出入
 *
 * 1. 引导**不再自己弹**，只留角上那颗钮。旧版第一次进站会自动弹一次，并把「弹过了」
 *    记进 localStorage。去掉是因为正式版的首页本身就是一整幅要等图的画，
 *    进站头一眼再盖一层引导太吵；而那颗钮一直在，想看随时能看。
 *    顺带也省掉了那一位只为「别再自动弹」而存在的存档。
 * 2. 平台判断全部走 `platform.fullscreen` / `platform.safeArea`，不自己碰
 *    `document.fullscreenElement` 和 `matchMedia`（架构第 2 节第 5 条）。
 */

import { Dialog, SealButton } from '@ai-duel/ui'
import { useEffect, useState } from 'react'
import { usePlatform } from '../app/platform'
import './fullscreenEntry.css'

export function FullscreenEntry() {
  const platform = usePlatform()
  /** 初值恒为 false、进 effect 再判：首帧不显示，免得它抢在页面画出来之前先糊在角上。 */
  const [enabled, setEnabled] = useState(false)
  /** 浏览器支持什么一开始就定死，只算一次。 */
  const [canFullscreen] = useState(() => platform.fullscreen.isSupported())
  const [active, setActive] = useState(false)
  const [guide, setGuide] = useState(false)

  useEffect(() => {
    // 桌面（细指针）有 F11，从主屏幕图标启动的本来就没有地址栏，两种都不摆这颗钮。
    if (!platform.safeArea.isCoarsePointer() || platform.fullscreen.isStandalone()) return
    setEnabled(true)
    setActive(platform.fullscreen.isActive())
    // 玩家可能走浏览器自己的入口进出全屏，不能只在按钮回调里记。
    return platform.fullscreen.onChange(setActive)
  }, [platform])

  // 进了全屏这颗钮的活就干完了，收起来。
  if (!enabled || active) return null

  return (
    <>
      {/*
        引导开着的时候不画这颗：它比引导低一档，会隔着那层半透明的黑底透出来，
        像一颗按不动的按钮（旧版同一条理由）。
      */}
      {guide ? null : (
        <div className="fs-entry">
          <SealButton
            icon="fullscreen"
            label={canFullscreen ? '进入全屏' : '如何全屏'}
            onClick={() => {
              // 能真全屏的设备上必须在这个点击回调里同步发起：只认用户手势。
              if (canFullscreen) void platform.fullscreen.enterLandscape()
              else setGuide(true)
            }}
          />
        </div>
      )}
      <Dialog
        open={guide}
        title="iPhone 上这样全屏"
        confirm={{ label: '知道了', onSelect: () => setGuide(false) }}
        onDismiss={() => setGuide(false)}
      >
        {/*
          写死三步而不做成通用文案：走到这里的只有 iOS——安卓那条分叉在上面就直接进全屏了，
          而 iOS 上不管用的是 Safari 还是 Chrome，底下都是同一个 WebKit，操作路径只有这一条。
          两个浏览器唯一的差别是「分享」按钮的位置，所以第一步把两处都点了出来。
        */}
        <p className="fs-entry__text">
          iOS 的浏览器不给网页整页全屏，地址栏赶不走。把本站加到主屏幕、再从图标启动，
          地址栏和底栏就都没有了，画面和卡面上的字都会大一圈。
        </p>
        <ol className="fs-entry__steps">
          <li>点「分享」（Safari 在底部，Chrome 在右上角）</li>
          <li>在列表里往下找，选「添加到主屏幕」</li>
          <li>回桌面，从新出现的图标启动本站</li>
        </ol>
      </Dialog>
    </>
  )
}
