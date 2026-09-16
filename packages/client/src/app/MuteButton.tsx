/**
 * 钉在视口右上角的静音钮：全站每一页都够得着的声音开关。
 *
 * 为什么非要有这一颗：正式版的界面几乎整个画在画布上（架构 2.1），文字页之外没有地方
 * 摆控件，而设置页那条「关闭声音」得先离开当前这一页才点得到。玩家要的是随手一按就静音。
 *
 * 状态的真身在 `audio/mute.ts`（落盘 + `platform.audio`），这里一格状态都不自己存：
 * 对局顶栏那一格（画布里，见 canvas 的 components/TopBar.ts）和设置页那条开关读的是
 * 同一份，三处必须永远一致。
 *
 * 钮面长相归 `ui` 的方块按钮（`pressed` 那一档反色，静音开着时看得出来），
 * 这里只写把它钉在角上的那几句。
 *
 * 哪一页不渲染它由调用方决定，见 App.tsx。
 */

import { Button } from '@ai-duel/ui'
import { toggleMuted, useMuted } from '../audio/mute'
import { usePlatform } from './platform'
import './muteButton.css'

export function MuteButton() {
  const platform = usePlatform()
  const muted = useMuted(platform)

  return (
    // Button 不收 className（ui 包里的组件不让外面改样子），摆位套在外面这一层上。
    <div className="mute-button">
      <Button pressed={muted} onClick={() => toggleMuted(platform)}>
        {muted ? '打开声音' : '关闭声音'}
      </Button>
    </div>
  )
}
