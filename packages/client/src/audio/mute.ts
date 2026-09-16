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
 * `fallback` 只在**这台机器上从没存过**时作数：默认出声是这类游戏的常态，
 * 但本地开发要的是默认静音（见 App.tsx 那个调用点）。玩家自己拨过一次开关之后，
 * 存档就是唯一的准——在本地开过声音的人不该每刷新一次又被静音。
 *
 * 这里**故意不读 `import.meta.env`**：vitest 下 `DEV` 也是 true，读了单元测试就会跟着变；
 * 而且「现在跑在什么构建里」是装配层的知识，这个模块不该认识它。
 */
export function restoreMuted(platform: Platform, fallback = false): void {
  platform.audio.setMuted(platform.storage.read(MUTED_SLOT) ?? fallback)
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
