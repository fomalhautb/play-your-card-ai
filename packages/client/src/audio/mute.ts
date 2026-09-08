/**
 * 全站静音开关。
 *
 * 「现在响不响」由 `platform.audio` 持有，这里只补两件 platform 有意不管的事
 *（见 platform 的 audio.ts：静音状态存哪儿是设置层的事）：
 * 落盘，以及把它接进 React。
 *
 * 为什么要落盘：玩家关掉声音多半是「这台机器上一直别响」的意思，
 * 而全站每换一页都会重挂组件，只存在内存里的话点一次「返回」就白关了。
 */

import type { Platform, StorageSlot } from '@ai-duel/platform'
import { useCallback, useSyncExternalStore } from 'react'
import { z } from 'zod'

/**
 * 静音开关的存档位。
 *
 * 单独一位而不是并进主存档：它和收藏、胜场的读写时机完全不同（按一下就要立刻生效），
 * 而且主存档换版本号作废时，玩家不该连「我关过声音」都被忘掉。
 */
const MUTED_SLOT: StorageSlot<boolean> = {
  name: 'ai-duel-muted',
  version: 1,
  parse(raw) {
    const parsed = z.boolean().safeParse(raw)
    return parsed.success ? parsed.data : null
  },
}

/**
 * 把上次存下的静音状态装回播放器。启动时调一次。
 *
 * 没存过就当有声：默认出声是这类游戏的常态，而且玩家第一次进来还没机会表达意见。
 */
export function restoreMuted(platform: Platform): void {
  platform.audio.setMuted(platform.storage.read(MUTED_SLOT) ?? false)
}

/** 改静音状态并记到本机。界面上那颗按钮走它，不要直接调 `platform.audio.setMuted`。 */
export function setMuted(platform: Platform, muted: boolean): void {
  platform.audio.setMuted(muted)
  platform.storage.write(MUTED_SLOT, muted)
}

export function toggleMuted(platform: Platform): void {
  setMuted(platform, !platform.audio.isMuted())
}

/**
 * 当前静音状态，会跟着变化重渲染。
 *
 * 用 `useSyncExternalStore` 而不是自己 useState + useEffect：状态的真身在 platform 里，
 * 别处（比如启动时的 `restoreMuted`）也会改它，抄一份到组件状态里迟早对不上。
 */
export function useMuted(platform: Platform): boolean {
  // subscribe 必须是稳定引用，否则每渲染一次就退订重订一次。
  const subscribe = useCallback(
    (onChange: () => void) => platform.audio.onMutedChange(onChange),
    [platform],
  )
  return useSyncExternalStore(subscribe, () => platform.audio.isMuted())
}
