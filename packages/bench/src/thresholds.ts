/**
 * 《正式版架构》6.9 确定性指标的硬上限，全项目只在这里改。
 *
 * 每条都标了它对应哪条纪律。表里写「按验证结果定」的几行现在是**占位值**，
 * 带 `todo` 字段，跑批的时候会单独打出来提醒——迁移第 3 条要求用真实场景的
 * 验证结果把这些数字填实、再写回架构文档。占位值只挡住明显跑飞的情况。
 *
 * 别为了让某条过而放宽这里：这些上限是纪律本身，放宽等于把纪律删了。
 */

export type ProfileName = 'desktop' | 'mobile'

export interface Limit {
  value: number
  /** 对应《正式版架构》第 3 节的哪一条纪律；表里没写纪律的填 '6.9'。 */
  discipline: string
  /** 非空说明这是占位值，等真实场景跑出结果再填。 */
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

const TODO_VERIFY = '占位值，迁移第 3 条用真实场景的验证结果填实并写回架构文档'

/** 两档都一样的那些：它们是纪律本身，不随视口变。 */
const SHARED: Omit<Limits, 'offscreenBindsPerFrame' | 'batchBreaksPerFrame'> = {
  drawCallsPerFrame: { value: 200, discipline: '3.9 每帧绘制调用不超过 200' },
  overdrawMultiple: { value: 3, discipline: '3.2 全屏半透明层同屏不超过三层' },
  textureUploads: { value: 0, discipline: '3.4 纹理按场景装卸，动画期间不上传' },
  residentTextureBytes: {
    value: 64 * 1024 * 1024,
    discipline: '3.4 每场景设预算',
    todo: TODO_VERIFY,
  },
  shaderCompiles: { value: 0, discipline: '6.9 预热后为 0' },
  programLinks: { value: 0, discipline: '6.9 预热后为 0' },
  syncCalls: { value: 0, discipline: '6.9 动画期间为 0' },
  textCreated: { value: 0, discipline: '3.5 文字只创建一次并缓存' },
  heapBytesPerFrame: { value: 4096, discipline: '3.10 稳态每帧堆分配接近 0', todo: TODO_VERIFY },
  idleFrameLoop: { value: 0, discipline: '3.6 没有动画时停掉帧循环' },
}

export const LIMITS: Readonly<Record<ProfileName, Limits>> = {
  desktop: {
    ...SHARED,
    // 桩场景每帧最多打断 16 次，留四倍余量。定得太松这条就形同虚设。
    batchBreaksPerFrame: { value: 64, discipline: '3.9 合批被打断', todo: TODO_VERIFY },
    // 6.9 表：离屏渲染「移动端档位为 0，桌面档位设上限」。桌面允许少量离屏（结算遮罩这类），
    // 但不能每帧都来一次，所以这个数应当远小于每帧一次。
    offscreenBindsPerFrame: { value: 4, discipline: '3.1 离屏渲染', todo: TODO_VERIFY },
  },
  mobile: {
    ...SHARED,
    // 手机档比桌面严一档：同样的画面在手机上元素更少，打断次数不该和桌面持平。
    batchBreaksPerFrame: { value: 48, discipline: '3.9 合批被打断', todo: TODO_VERIFY },
    // 移动端这条不是占位值：纪律 3.1 说死了每个元素不挂 Filter，一次离屏都不许有。
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

/** 还是占位值的那几条，跑批结束时打出来提醒。 */
export function placeholderKeys(limits: Limits): LimitKey[] {
  return (Object.keys(limits) as LimitKey[]).filter((key) => limits[key].todo !== undefined)
}
