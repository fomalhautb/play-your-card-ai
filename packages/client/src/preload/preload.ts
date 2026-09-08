/**
 * 首屏闸门和后台预加载：先把一个界面要用的图全部拉完，再让它上场。
 *
 * 为什么需要：首页是十几张整幅图叠出来的一张画。浏览器是拿到一张画一张，
 * 不管的话玩家会看着夜空、人物、桌子、道具一层层往上冒。与其让人看半成品，
 * 不如整段时间都停在加载页上，好了再一次性亮出来。
 *
 * 「怎么等一批图」本身在 platform 里（`images.loadAll` / `loadInBackground`），
 * 这个文件只负责把它换成加载页要的那个进度状态。
 */

import type { ImageLoadProgress, Platform } from '@ai-duel/platform'

/**
 * 连着这么久**一张图都没到**就不等了。
 *
 * 计的是「停滞多久」而不是「总共等了多久」：对局那批有几十张、几 MB，慢网下总时长
 * 轻松超过任何一个定死的上限，按总时长算等于闸门必然超时、白设。只要还在一张接一张地到货，
 * 就说明连接是通的、值得继续等；真卡住了，这十秒里一张都不会完成。
 *
 * 数值和 platform 的默认值一样，写在这里是为了让「为什么是这个口径」有个落脚点，
 * 也方便某个界面单独调大调小。
 */
export const PRELOAD_STALL_MS = 10_000

/** 一批图的加载状态，给加载页画进度条用。 */
export interface PreloadState {
  /** 这批图能用了没有。超时放行也算能用——缺的图会自己在后面补上。 */
  ready: boolean
  /** 0~1 的进度。`ready` 之后一定是 1。 */
  progress: number
}

/**
 * 这批图现在的状态，同步返回，不发任何请求。
 *
 * 给界面的首帧用：从别的页面回到首页时图早就有结果了，先问一句就不用闪一下加载页。
 */
export function preloadState(platform: Platform, urls: readonly string[]): PreloadState {
  const loaded = urls.reduce(
    (count, url) => (platform.images.isSettled(url) ? count + 1 : count),
    0,
  )
  return { ready: loaded === urls.length, progress: ratio(loaded, urls.length) }
}

/**
 * 等一批图全部有结果（或者卡住太久），中途按张数报进度。永不 reject。
 *
 * 进度按「张数」算而不是按字节：想按体积算就得另外维护一份「每张图多大」的清单，
 * 加图漏登记就会算错。张数的代价是走得不匀（一张 600 KB 的原画和一张 20 KB 的图标各占一格），
 * 但至少一定是真的。
 *
 * `onProgress` 只会往前走：同一个地址可能同时被后台预载也盯着，
 * 而进度条往回缩比走得不匀难看得多。结束时一定补一次满格——超时放行时进度可能还没满，
 * 让玩家看着一条没走完的进度条切走反而像是出了错。
 */
export async function preloadAll(
  platform: Platform,
  urls: readonly string[],
  onProgress?: (state: PreloadState) => void,
  stallMs: number = PRELOAD_STALL_MS,
): Promise<void> {
  let highest = 0
  const report = ({ loaded, total }: ImageLoadProgress): void => {
    const progress = ratio(loaded, total)
    if (progress <= highest) return
    highest = progress
    onProgress?.({ ready: false, progress })
  }
  await platform.images.loadAll(urls, { stallMs, onProgress: report })
  onProgress?.({ ready: true, progress: 1 })
}

/**
 * 首页亮出来之后，在后台把剩下的图按 `PRELOAD_GROUPS` 的顺序全部拉完。
 *
 * 玩家从首页一路走到对局，每到一站都要停下来等一次；而对局用到的那几 MB，
 * 在玩家看首页、建房、等对手的那几十秒里完全可以悄悄下完。下完之后各页的闸门
 * 第一帧就是就绪状态，玩家一路点过去看不到任何加载页。
 *
 * 一组下完才开下一组（而不是一口气全排进去）：分组的意义就是「先用到的先下」，
 * 全丢进同一个队列的话，对局那几十张会和房间页那十几张抢同样的并发额度。
 * platform 那边已经限了并发、标了低优先级、不设超时，所以不会抢当前页面的带宽。
 */
export async function preloadInBackground(
  platform: Platform,
  groups: readonly (readonly string[])[],
): Promise<void> {
  for (const group of groups) {
    await platform.images.loadInBackground(group)
  }
}

/** 空清单当作已经满了，免得除出 NaN 把进度条宽度写成 NaN%。 */
function ratio(loaded: number, total: number): number {
  return total === 0 ? 1 : loaded / total
}
