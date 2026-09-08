/**
 * 图片加载能力的网页实现。
 *
 * 没有引第三方库：要做的是「取一张图、解码、记进缓存」，fetch + createImageBitmap 就够，
 * 而现成的加载器（Pixi Assets 那类）会把纹理和渲染引擎一起绑进来，platform 不该认识引擎。
 * 「一批图怎么等」那部分在 ../imageBatch.ts，和假实现共用。
 *
 * 和旧代码（legacy-client/src/ui/preloadAssets.ts）最大的差别是解码这一步：
 * 旧版用 `new Image()` + `decode()`，而 decode() 在页面切到后台时会一直不结算——不是慢，
 * 是真的不返回，串行的后台预载会整条队停在那儿。旧版为此加了「下完了、页面在后台就别等解码」
 * 那段绕。createImageBitmap 不吃这个亏，那段绕就不用抄过来了。
 */

import { batchBackground, batchLoad } from '../imageBatch'
import type { ImagesCapability, LoadedImage } from '../images'

/** fetch 的优先级提示。Chromium 系认，别的浏览器忽略掉这个字段。 */
interface PriorityRequestInit extends RequestInit {
  priority?: 'high' | 'low' | 'auto'
}

export function createWebImages(): ImagesCapability {
  /** 加载成功的图。 */
  const cache = new Map<string, LoadedImage>()
  /**
   * 已经有结果的地址，加载失败的也记进来。
   *
   * 记失败是为了不让同一张取不到的图每次回到这一页都重新卡满一次超时。
   */
  const settled = new Set<string>()
  /**
   * 正在下载、还没有结果的地址。
   *
   * 后台预载和界面闸门经常同时要同一张图（后台正慢慢往下拉，玩家已经点进了那一页），
   * 各发一次请求就是两轮流量。共用同一个 Promise，谁先起的头谁负责，另一边搭车等着。
   */
  const inFlight = new Map<string, Promise<LoadedImage>>()

  function load(url: string, background = false): Promise<LoadedImage> {
    const cached = cache.get(url)
    if (cached !== undefined) return Promise.resolve(cached)
    const running = inFlight.get(url)
    if (running !== undefined) return running

    const task = fetchImage(url, background).then(
      (image) => {
        cache.set(url, image)
        settled.add(url)
        inFlight.delete(url)
        return image
      },
      (reason: unknown) => {
        settled.add(url)
        inFlight.delete(url)
        throw reason
      },
    )
    inFlight.set(url, task)
    return task
  }

  const settle = (url: string, background: boolean): Promise<void> =>
    load(url, background).then(
      () => undefined,
      () => undefined,
    )
  const isSettled = (url: string): boolean => settled.has(url)

  return {
    load: (url) => load(url),
    loadAll: (urls, options) => batchLoad(settle, isSettled, urls, options),
    loadInBackground: (urls, options) => batchBackground(settle, isSettled, urls, options),
    isSettled,
    get: (url) => cache.get(url) ?? null,

    release(urls) {
      for (const url of urls) {
        cache.get(url)?.bitmap.close()
        cache.delete(url)
        // 一并忘掉「有结果了」，下次再要这张图会重新下载，闸门也会重新等它。
        settled.delete(url)
      }
    },
  }
}

async function fetchImage(url: string, background: boolean): Promise<LoadedImage> {
  // 低优先级只对后台预载有意义：让浏览器把这张排在当前页面真正要用的资源后面。
  // 搭车的情况下它不起作用——已经发出去的请求改不了优先级。
  const init: PriorityRequestInit = background ? { priority: 'low' } : {}
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`图片加载失败：${url}（HTTP ${response.status}）`)
  const bitmap = await createImageBitmap(await response.blob())
  // displayUrl 就是原地址：图已经进了 HTTP 缓存，界面上的 <img> 不会再发一次请求。
  return { url, bitmap, displayUrl: url }
}
