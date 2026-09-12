/**
 * 音频能力：循环背景音乐、并发音效、全站静音开关。
 *
 * 接口按旧代码里真的用到的四件事切：
 * - 一首循环 BGM 跨界面复用，切歌不叠播（黑客松版的 src/ui/backgroundMusic.ts）；
 * - 音效可以同时响好几段，但同一「声道」上只留最新那一段
 *   （四句「催一催」连点时不能几段人声叠着响，见 ui/soundEffects.ts 的 channel）；
 * - 右上角那颗静音钮（ui/audioMute.ts）；
 * - 移动端和 Chrome 的自动播放限制：第一次点击之前 play() 是不出声的。
 *
 * 静音状态存哪儿不归这里管。旧代码把它直接写进 localStorage，重写时拆开：
 * 音频能力只持有「现在响不响」，要不要记到下次进游戏是设置层的事，走 storage 能力。
 * 这样音频实现不用为了一个开关去认识存储。
 */

export interface SoundSpec {
  /** 音频地址。同一个地址只加载一次，多次播放共用同一份解码结果。 */
  src: string
  /** 循环播放。背景音乐是 true，音效是 false。 */
  loop?: boolean
  /**
   * 0~1 的音量。
   *
   * 上限就是 1：旧代码为了把几段录得偏轻的人声放大到 2~3 倍，绕开 audio 元素直接用
   * Web Audio 的 GainNode。那是素材没做响度归一化的补丁，正式版在构建期把音频统一响度，
   * 运行时不再需要「超过 100%」这种东西。
   */
  volume?: number
}

export interface PlayOptions {
  /**
   * 声道名。同一个声道同时只响一段，新的把没播完的旧的掐掉。
   * 不给就是自由并发（点击音这类短音，叠着响也没问题）。
   */
  channel?: string
  /** 覆盖 SoundSpec 里的音量，同样是 0~1。 */
  volume?: number
  /** 从 0 淡入到目标音量的时长。0 或不给就是直接出声。 */
  fadeInMs?: number
}

export interface Playback {
  /** 停掉这一段。已经播完了再调也没事。 */
  stop(fadeOutMs?: number): void
  /**
   * 这一段播到头时回调，返回退订函数。
   *
   * 循环音每转一圈也算一次：旧代码首页那句问候就是挂在 BGM 每次循环回开头上的
   *（ui/soundEffects.ts 的 useHomeIntroSound），不是只在第一次播放时响。
   */
  onEnd(listener: () => void): () => void
}

export interface AudioCapability {
  /**
   * 预取一批音频，第一次播放不必再等网络。
   * 永不抛错：音效是反馈层，加载失败不能挡住按钮自己的操作。
   */
  preload(specs: readonly SoundSpec[]): Promise<void>
  play(spec: SoundSpec, options?: PlayOptions): Playback
  /** 停掉某个声道上正在响的那一段。切界面时用来收掉上一页的声音。 */
  stopChannel(channel: string): void
  setMuted(muted: boolean): void
  isMuted(): boolean
  /** 订阅静音状态变化，返回退订函数。按钮和播放器都靠它跟着变。 */
  onMutedChange(listener: (muted: boolean) => void): () => void
  /**
   * 浏览器还在等用户手势才肯出声。
   *
   * 界面拿它决定要不要提示「点一下开声音」。真正的解锁由实现自己做（首次点击时静默解锁），
   * 调用方不需要为此写任何手势监听。
   */
  isBlocked(): boolean
  onBlockedChange(listener: (blocked: boolean) => void): () => void
  /** 卸掉全部已加载的音频，释放内存。换大场景时用。 */
  unloadAll(): void
}
