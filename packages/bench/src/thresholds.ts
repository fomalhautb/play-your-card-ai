/**
 * 《正式版架构》6.9 确定性指标的硬上限，全项目只在这里改。
 *
 * 每条都标了它对应哪条纪律。6.9 表里原来写「按验证结果定」的那几行已经填实了：
 * 数字来自 2026-09-05 在 Apple M2 上对真实对局场景的验证（迁移第 3 条），
 * 口径是**实测峰值留约 1.5 倍余量再取整**。每条的实测值写在各自的注释里，
 * 和架构文档 6.9 那节「验证结果」小节里的表一一对应，改这里要同时改那边。
 *
 * 别为了让某条过而放宽这里：这些上限是纪律本身，放宽等于把纪律删了。
 * 场景改完超了，要改的是场景。
 */

export type ProfileName = 'desktop' | 'mobile'

export interface Limit {
  value: number
  /** 对应《正式版架构》第 3 节的哪一条纪律；表里没写纪律的填 '6.9'。 */
  discipline: string
  /**
   * 非空说明这是占位值，还没有真实场景的验证结果撑着。
   * 现在全部为空——6.9 表里那几行都已经填实（见文件头）。新加的指标可以先用它占位。
   */
  todo?: string
}

export type LimitKey =
  | 'drawCallsPerFrame'
  | 'batchBreaksPerFrame'
  | 'offscreenBindsPerFrame'
  | 'overdrawMultiple'
  | 'textureUploads'
  | 'residentTextureBytes'
  | 'shaderCompiles'
  | 'programLinks'
  | 'syncCalls'
  | 'textCreated'
  | 'heapBytesPerFrame'
  | 'idleFrameLoop'

export type Limits = Record<LimitKey, Limit>

/** 两档都一样的那些：它们是纪律本身，不随视口变。 */
const SHARED: Omit<Limits, 'offscreenBindsPerFrame' | 'batchBreaksPerFrame'> = {
  drawCallsPerFrame: { value: 200, discipline: '3.9 每帧绘制调用不超过 200' },
  overdrawMultiple: { value: 3, discipline: '3.2 全屏半透明层同屏不超过三层' },
  textureUploads: { value: 0, discipline: '3.4 纹理按场景装卸，动画期间不上传' },
  /*
   * 常驻纹理内存的预算。实测两档都是 30.80 MiB（卡面图集三页 + 牌背一页 + 烤出来的边框和文字），
   * 留 1.5 倍余量取整到 48 MiB。两档一样是因为纹理和视口无关：图集是整页传的，
   * 文字纹理按渲染倍率烤，而两档的倍率都封顶在 1.5（3.3）。
   * 文字光栅化在不同系统上差几百 KB，这点浮动这个余量吃得下。
   */
  residentTextureBytes: { value: 48 * 1024 * 1024, discipline: '3.4 每场景设预算' },
  shaderCompiles: { value: 0, discipline: '6.9 预热后为 0' },
  programLinks: { value: 0, discipline: '6.9 预热后为 0' },
  syncCalls: { value: 0, discipline: '6.9 动画期间为 0' },
  textCreated: { value: 0, discipline: '3.5 文字只创建一次并缓存' },
  /*
   * 稳态每帧堆分配。实测峰值 1457 B（手机档发牌那段：那一段最短，建卡牌对象的一次性开销
   * 摊到七十几帧上最显眼），留 1.5 倍余量取整到 2 KiB。
   * 出牌那段跑一千多帧，实测只有 200 B 上下，那才是真正的稳态水平。
   * 这个数是 DevTools 采样出来的估计值，两次跑之间会差个百分之十几，余量按噪声上沿留。
   */
  heapBytesPerFrame: { value: 2048, discipline: '3.10 稳态每帧堆分配接近 0' },
  idleFrameLoop: { value: 0, discipline: '3.6 没有动画时停掉帧循环' },
}

export const LIMITS: Readonly<Record<ProfileName, Limits>> = {
  desktop: {
    ...SHARED,
    /*
     * 实测峰值 34 次（出牌那段，手上十二张时纹理数超过一批能带的上限，每帧要重排纹理槽），
     * 留 1.5 倍余量取整到 48。
     * 34 里有 3 次是卡面反光那一层带来的：它有自己的着色器，进绘制队列就是一次程序切换加前后两次
     * 状态切换。2026-09-08 之前剧本的 hover 不喂指针位置，反光从没亮过，那时候实测是 31。
     */
    batchBreaksPerFrame: { value: 48, discipline: '3.9 合批被打断' },
    /*
     * 6.9 表原话是「移动端档位为 0，桌面档位设上限」，验证下来桌面档实测也是 0，所以就定 0。
     * 不是巧合：效果分档那三档都不挂 Filter（见 canvas 的 fx/effectTier.ts），
     * 发光和追光走的是预烤纹理加叠加混合，动画期间一次离屏都不需要。
     * 烤纹理本身要离屏，但那件事发生在建场景时，不在剧本的计数窗口里。
     */
    offscreenBindsPerFrame: { value: 0, discipline: '3.1 离屏渲染' },
  },
  mobile: {
    ...SHARED,
    // 实测峰值 21 次，比桌面低——手机档不开卡面倾斜和反光，参与合批的精灵更少。
    // 同样留 1.5 倍余量取整到 32。手机档比桌面严一档是应该的，不能跟着桌面一起放宽。
    batchBreaksPerFrame: { value: 32, discipline: '3.9 合批被打断' },
    // 纪律 3.1 说死了移动端每个元素不挂 Filter，一次离屏都不许有。
    offscreenBindsPerFrame: { value: 0, discipline: '3.1 移动端每个元素不挂 Filter' },
  },
}

/** 泄漏那条的容差：连打十局后堆和常驻纹理内存回到基线，偏差不超过 5%（6.9 表最后一行）。 */
export const LEAK_TOLERANCE = 0.05

/** 时间指标的帧预算，超过它两倍算一帧卡顿（6.9 时间指标那节）。 */
export const FRAME_BUDGET_MS = 1000 / 60

export function limitsFor(profile: ProfileName): Limits {
  return LIMITS[profile]
}

/** 还是占位值的那几条，跑批结束时打出来提醒。现在应当是空的。 */
export function placeholderKeys(limits: Limits): LimitKey[] {
  return (Object.keys(limits) as LimitKey[]).filter((key) => limits[key].todo !== undefined)
}
