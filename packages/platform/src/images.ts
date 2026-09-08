/**
 * 图片加载能力：把一批图拉下来、解好码，然后交给画布或界面用。
 *
 * 三种用法都来自旧代码（legacy-client/src/ui/preloadAssets.ts、backgroundPreload.ts）：
 * 1. 首屏闸门：一个界面要用的图全部到齐再让它上场，否则玩家会看着一层层图往上冒；
 * 2. 后台预载：玩家在首页看画的那几十秒里，把对局要用的几 MB 卡面悄悄下完；
 * 3. 问一句「这张在缓存里了吗」：在缓存里就别再闪一次 loader。
 *
 * 交出去的是 ImageBitmap：Pixi 拿它直接建纹理，不必再解码一次
 *（性能纪律第 4 条要按场景装卸纹理，所以还要能主动释放）。
 * 接口里不出现 Pixi 的任何类型——platform 不认识画布用的是什么引擎。
 */

export interface LoadedImage {
  /** 加载时给的地址，也是缓存的键。 */
  url: string
  /**
   * 已解码的位图。
   *
   * 用完要还：位图占的是实打实的内存，浏览器不会因为没人引用就立刻放掉，
   * 所以释放走 `release()`，不要自己 close——缓存里可能还有别人在用同一张。
   */
  bitmap: ImageBitmap
  /**
   * 给 React 和 CSS 用的地址。
   *
   * 网页和 WebView 上就是 url 本身（图已经进了 HTTP 缓存，<img> 不会再发一次请求）；
   * 将来 Electron 那类壳如果要从本地文件读图，这里会变成一个 blob: 或 file: 地址，
   * 所以界面代码一律用这个字段，别自己拿 url 拼。
   */
  displayUrl: string
}

export interface ImageLoadProgress {
  /** 已经有结果的张数。加载成功和失败的都算——闸门等的是「有没有结果」。 */
  loaded: number
  /** 这批清单一共几张。 */
  total: number
}

export interface LoadAllOptions {
  /**
   * 连着这么久**一张图都没到**就不等了，默认 10 秒。
   *
   * 计的是「停滞多久」而不是「总共等了多久」：对局那批有四十多张、几 MB，
   * 慢网下总时长轻松超过任何一个定死的上限，按总时长算等于闸门必然超时、白设。
   * 只要还在一张接一张地到货就说明连接是通的，值得继续等。
   */
  stallMs?: number
  /**
   * 进度变化时回调。调用这一刻会先同步报一次当前进度（缓存里已有的直接算数），
   * 所以缓存命中时进度条不会从 0 再补跑一遍。
   */
  onProgress?(progress: ImageLoadProgress): void
}

export interface BackgroundLoadOptions {
  /** 同时下几张，默认 3。限并发是为了不占满浏览器对同一域名的连接。 */
  concurrency?: number
}

export interface ImagesCapability {
  /** 加载并解码一张图。同一个地址并发调用共用一次请求。失败时 reject。 */
  load(url: string): Promise<LoadedImage>
  /**
   * 首屏闸门：等一批图全部有结果，或者连着 stallMs 一张都没到。
   *
   * 永不 reject，失败的那几张也算「等到了」：缺一张图是画面问题，
   * 卡在 loader 里进不去是致命问题。
   */
  loadAll(urls: readonly string[], options?: LoadAllOptions): Promise<void>
  /**
   * 后台悄悄拉一批图，不挡任何界面：限并发、标低优先级、不设超时（没人在等）。
   * 已经有结果的直接跳过，所以清单之间重复不要紧。同样永不 reject。
   */
  loadInBackground(urls: readonly string[], options?: BackgroundLoadOptions): Promise<void>
  /**
   * 这张图已经有结果了没有（成功和失败都算）。
   *
   * 界面拿它决定首帧要不要显示 loader。失败的也算，是不想每次回到这一页
   * 都为同一张取不到的图重新卡满超时。
   */
  isSettled(url: string): boolean
  /** 从缓存里取已经加载好的那张；没有（或加载失败过）就返回 null。 */
  get(url: string): LoadedImage | null
  /** 释放这几张图占的内存，并把它们从缓存里摘掉。按场景装卸纹理时用。 */
  release(urls: readonly string[]): void
}
