/**
 * 设置（`/settings`）。首页菜单里「设置」那一项进来。
 *
 * 四条开关加一颗「重置存档」。每一条的真身都在别处，这一页只是把它们摆出来：
 * 静音在 `platform.audio`（落盘在 audio/mute.ts）、减少动效在存档里
 * （落盘在 save/saveStore.ts，生效在 app/reducedMotion.ts）、全屏在 `platform.fullscreen`。
 *
 * ## 没有音量滑块
 *
 * `platform.audio` 只有静音一个口子，没有音量（见 platform 的 audio.ts 的
 * `AudioCapability`）。补一个音量能力要连带改 web 实现、fake 实现和两处调用，
 * 而「关掉声音」已经覆盖了绝大多数要调音量的场合，所以这一条先只做静音——
 * 真要音量时补的是 platform 那一层，不是在这里绕过它去碰 `AudioContext`。
 *
 * ## 全屏那一条为什么可能是灰的
 *
 * iPhone 上的浏览器不给网页整页全屏（iOS 里所有浏览器底下都是同一个 WebKit），
 * `fullscreen.isSupported()` 因此是 false。那时这一条摆出来但点不动，并在说明里
 * 写清为什么——藏起来的话玩家只会以为这个版本少了个功能
 *（见 platform 的 fullscreen.ts：先问能力再给入口）。
 *
 * ## 重置存档要二次确认
 *
 * 它删的是收藏、胜场和选过的英雄，删了回不来，所以走 `Dialog`。
 * 牌组不在这一位存档里（那是另一位，见 save/deckStore.ts），所以这颗钮**不动牌组**——
 * 说明里写清楚了，免得有人指望它把自己编坏的牌组也一起清掉。
 */

import { Button, Dialog, Notice, Page, Toggle } from '@ai-duel/ui'
import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { usePlatform } from '../app/platform'
import { applyReducedMotion } from '../app/reducedMotion'
import { setMuted, useMuted } from '../audio/mute'
import { loadSave, resetSave, setReducedMotion } from '../save/saveStore'
import './settingsScreen.css'

export function SettingsScreen() {
  const platform = usePlatform()
  const [, navigate] = useLocation()
  const muted = useMuted(platform)

  /*
   * 这一位的真身在存档里，读一次抄进组件状态。
   *
   * 可以抄是因为**只有这一页会改它**：不像静音那样在对局顶栏也有入口，
   * 所以不会出现「别处改了这里还显示旧值」（静音那边正因此走 useSyncExternalStore）。
   */
  const [reduced, setReduced] = useState(() => loadSave(platform).reducedMotion)
  const [fullscreen, setFullscreen] = useState(() => platform.fullscreen.isActive())
  const [confirming, setConfirming] = useState(false)
  /** 重置完那句话。点一下就出现，之后一直留着——玩家需要看到「真的清掉了」。 */
  const [reset, setReset] = useState(false)

  // 玩家可能走浏览器自己的全屏入口（F11、退出全屏），不能只在按钮回调里记。
  useEffect(() => platform.fullscreen.onChange(setFullscreen), [platform])

  const canFullscreen = platform.fullscreen.isSupported()

  const toggleReduced = (next: boolean): void => {
    setReduced(next)
    setReducedMotion(platform, next)
    // 当场生效，不等下次进页面：玩家点它就是想立刻看到区别。
    applyReducedMotion(next)
  }

  const toggleFullscreen = (next: boolean): void => {
    /*
     * 必须在这个点击回调里**同步**发起：全屏和方向锁都只认用户手势
     *（见 platform 的 fullscreen.ts）。真正的状态由上面那个 onChange 回填，
     * 这里不抢着 setFullscreen——浏览器可能拒绝，那时界面该退回原样。
     */
    if (next) void platform.fullscreen.enterLandscape()
    else void platform.fullscreen.exit()
  }

  return (
    <Page title="设置" onBack={() => navigate('/')}>
      <div className="settings__group">
        <Toggle
          label="关闭声音"
          hint="音乐和音效一起静音。这一项记在本机上，换台机器要重新关。"
          checked={muted}
          onChange={(next) => setMuted(platform, next)}
        />
        <Toggle
          label="减少动效"
          hint="关掉画面上的弹跳、震屏和跟着指针跑的倾斜，留下必要的淡入淡出。"
          checked={reduced}
          onChange={toggleReduced}
        />
        <Toggle
          label="全屏"
          hint={
            canFullscreen
              ? '进全屏并尽量把屏幕锁成横屏，手机上画面会大一圈。'
              : '这台设备的浏览器不给网页整页全屏（iPhone 上都是这样）。'
          }
          checked={fullscreen}
          disabled={!canFullscreen}
          onChange={toggleFullscreen}
        />
      </div>

      <div className="settings__danger">
        <p className="settings__danger-title">重置存档</p>
        <p className="settings__danger-text">
          清掉收藏的卡牌、胜场和选过的英雄，回到新号的样子。
          <strong>不动牌组</strong>——那是另一份存档，要清的话去牌组页删。
        </p>
        <Button onClick={() => setConfirming(true)}>重置存档</Button>
        {reset ? <Notice tone="ok">存档已经清空，回到新号的状态了。</Notice> : null}
      </div>

      <Dialog
        open={confirming}
        title="重置存档"
        confirm={{
          label: '确定清空',
          onSelect: () => {
            resetSave(platform)
            setConfirming(false)
            setReset(true)
          },
        }}
        cancel={{ label: '再想想', onSelect: () => setConfirming(false) }}
        onDismiss={() => setConfirming(false)}
      >
        清掉之后回不来。牌组不受影响。
      </Dialog>
    </Page>
  )
}
