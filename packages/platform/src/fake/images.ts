/**
 * 图片加载能力的假实现：不发请求，每张图什么时候到货由测试说了算。
 *
 * 「一批图怎么等」用的是和 web 实现同一份算法（../imageBatch.ts），
 * 所以进度回调、停滞超时这些行为测出来的就是真实现的行为。
 * 交出来的位图是个空壳（只有宽高和 close），Pixi 不会真去用它——
 * 需要真纹理的测试属于 canvas 包，不该跑到 platform 里来。
 */

import { batchBackground, batchLoad } from '../imageBatch'
import type { ImagesCapability, LoadedImage } from '../images'

export interface FakeImages extends ImagesCapability {
  /** 还没有结果的地址，按开始加载的先后。 */
  pending(): readonly string[]
  /** 让某张图加载成功。 */
  complete(url: string, size?: { width: number; height: number }): void
  /** 让某张图加载失败。 */
  fail(url: string): void
  /**
   * 自动结算，默认开着：load 一发出就在下一个微任务里成功。
   * 关掉之后要自己调 complete / fail——测进度条和停滞超时时用。
   */
  setAutoComplete(auto: boolean): void
  /** 被释放过的地址，按顺序。验「按场景装卸纹理」用。 */
  readonly released: readonly string[]
}

interface Waiting {
  promise: Promise<LoadedImage>
  resolve(image: LoadedImage): void
  reject(reason: Error): void
}

export function createFakeImages(): FakeImages {
  const cache = new Map<string, LoadedImage>()
  const settled = new Set<string>()
  const waiting = new Map<string, Waiting>()
  const released: string[] = []
  let autoComplete = true

  function load(url: string): Promise<LoadedImage> {
    const cached = cache.get(url)
    if (cached !== undefined) return Promise.resolve(cached)
    const running = waiting.get(url)
    if (running !== undefined) return running.promise

    let resolve!: (image: LoadedImage) => void
    let reject!: (reason: Error) => void
    const promise = new Promise<LoadedImage>((ok, no) => {
      resolve = ok
      reject = no
    })
    waiting.set(url, { promise, resolve, reject })
    // 放在微任务里而不是同步结算：真实现一定要等一轮网络，
    // 同步成功会掩盖掉「调用方以为已经有图了」这一类错。
    if (autoComplete) queueMicrotask(() => complete(url))
    return promise
  }

  function complete(url: string, size = { width: 1, height: 1 }): void {
    const pending = waiting.get(url)
    if (pending === undefined) return
    waiting.delete(url)
    settled.add(url)
    const image: LoadedImage = {
      url,
      displayUrl: url,
      bitmap: { width: size.width, height: size.height, close: () => undefined },
    }
    cache.set(url, image)
    pending.resolve(image)
  }

  function fail(url: string): void {
    const pending = waiting.get(url)
    if (pending === undefined) return
    waiting.delete(url)
    // 失败的也算「有结果了」：闸门不该为同一张取不到的图反复卡满超时。
    settled.add(url)
    pending.reject(new Error(`图片加载失败：${url}`))
  }

  const settle = (url: string): Promise<void> =>
    load(url).then(
      () => undefined,
      () => undefined,
    )
  const isSettled = (url: string): boolean => settled.has(url)

  return {
    released,
    load,
    loadAll: (urls, options) => batchLoad(settle, isSettled, urls, options),
    loadInBackground: (urls, options) => batchBackground(settle, isSettled, urls, options),
    isSettled,
    get: (url) => cache.get(url) ?? null,
    release(urls) {
      for (const url of urls) {
        cache.get(url)?.bitmap.close()
        cache.delete(url)
        settled.delete(url)
        released.push(url)
      }
    },

    pending: () => [...waiting.keys()],
    complete,
    fail,
    setAutoComplete(auto) {
      autoComplete = auto
    },
  }
}
