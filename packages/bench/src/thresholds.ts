/**
 * 《正式版架构》6.9 确定性指标的硬上限，全项目只在这里改。
 *
 * 每条都标了它对应哪条纪律。6.9 表里原来写「按验证结果定」的那几行已经填实了：
 * 数字来自 2026-09-10 在 Apple M2 上对**真**对局场景的测量（迁移第 18 条），
 * 口径是**实测峰值留约 1.5 倍余量再取整**。在此之前这些数标定的是验证阶段那个
 * 只有手牌扇形的原型（迁移第 3 条），接上真场景之后全部重量了一遍。
 * 每条的实测值写在各自的注释里，和架构文档 6.9 那节的表一一对应，改这里要同时改那边。
 *
 * 别为了让某条过而放宽这里：这些上限是纪律本身，放宽等于把纪律删了。
 * 场景改完超了，要改的是场景。**至今只有合批那两条动过上限**（迁移第 18、20 条各一次），
 * 理由见它们各自的注释；其余各条一个没改。
 *
 * 迁移第 20 条加了「一轮结算」那段剧本，各条的实测峰值因此重取了一遍：结算层是全屏层，
 * 它顶上来的是合批那一条，其余各条（离屏为 0、过度绘制、文字重建为 0、纹理上传为 0）
 * 都还在原来的上限里——过程中修掉的两处见 canvas 的 components/Label.ts 和 SettleRow.ts。
 */

export type ProfileName = 'desktop' | 'mobile'

export interface Limit {
  value: number
  /** 对应《正式版架构》第 3 节的哪一条纪律；表里没写纪律的填 '6.9'。 */
  discipline: string
  /**
   * 这一条上限身上还欠着一笔账，跑批结束时会单独列出来提醒。两种情况：
   * 一是**占位值**，还没有真实场景的验证结果撑着（新加的指标可以先这么占位）；
   * 二是这个数被某个界面顶上去了、等某件事做完要压回来（现在合批那两条就是）。
   * 空着才是「这个上限是干净的」。
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
   * 常驻纹理内存的预算。实测桌面档 34.44 MiB、手机档 34.39 MiB
   *（卡面图集三页 + 牌背一页 + 烤出来的边框和文字），上限 48 MiB 是 1.39 倍余量。
   * 两档几乎一样是因为纹理和视口无关：图集是整页传的，文字纹理按渲染倍率烤，
   * 而两档的倍率都封顶在 1.5（3.3）；差的那几十 KB 是两档版式的文字条数不同。
   * 文字光栅化在不同系统上差几百 KB，这点浮动这个余量吃得下。
   */
  residentTextureBytes: { value: 48 * 1024 * 1024, discipline: '3.4 每场景设预算' },
  shaderCompiles: { value: 0, discipline: '6.9 预热后为 0' },
  programLinks: { value: 0, discipline: '6.9 预热后为 0' },
  syncCalls: { value: 0, discipline: '6.9 动画期间为 0' },
  textCreated: { value: 0, discipline: '3.5 文字只创建一次并缓存' },
  /*
   * 稳态每帧堆分配。实测峰值 1672 B（桌面档放大查看那段：三次进出展示层只跑两百多帧，
   * 每次建卡、建字幕的一次性开销摊不开），上限 2 KiB 是 1.22 倍余量。
   * 出牌那段跑一千多帧，实测 382 B（手机档 319 B），那才是真正的稳态水平。
   * 这个数是 DevTools 采样出来的估计值，两次跑之间会差个百分之十几；
   * 1672 加上噪声上沿仍在 2 KiB 以内，但余量已经不厚，再往上涨要先查是不是哪里在逐帧建对象。
   */
  heapBytesPerFrame: { value: 2048, discipline: '3.10 稳态每帧堆分配接近 0' },
  idleFrameLoop: { value: 0, discipline: '3.6 没有动画时停掉帧循环' },
}

export const LIMITS: Readonly<Record<ProfileName, Limits>> = {
  desktop: {
    ...SHARED,
    /*
     * 实测峰值 98 次（**结算那段**：结算层上题面、答案框、每张结果卡的名字 / 回答 / 推理 /
     * 判定章，全是各占一张纹理的文字，而它底下的整套对局界面还照画）。
     * 出牌那段是 54 次。留 1.33 倍余量取整到 132。
     *
     * 这个数被放宽过两次：迁移第 18 条接上真对局场景时 48 → 72，迁移第 20 条加上「一轮结算」
     * 那段剧本时 72 → 132。**它是全表唯一被放宽过的一条**，所以理由写长一点：
     * 不是「场景退步了」，而是这条计数器量的从来就不是它名字说的那件事。
     * 同一批数据里**每帧绘制调用远在 200 以内**，也就是说合批根本没被打断——
     * Pixi 是把几十张纹理绑到不同纹理单元、一次画完的。这条计数器数的是 `bindTexture`，
     * 于是它实际量的是「这一帧屏幕上有多少张不同的纹理」，而不是「批被切了几刀」。
     * 一整套对局界面（顶栏、侧栏两块面板、Token 细条、战场两排、手牌、对手手牌）
     * 比验证阶段那个只有手牌扇形的原型多出二十来张纹理，绝大多数是**文字**——
     * 每句话烤一张纹理（见 canvas 的 runtime/textCache.ts）。
     * 结算那一屏尤其明显：一张结果卡上四段字就是四张纹理。
     * 真要把这个数压回去，该做的是给文字来一张共用图集，而不是少画点东西——
     * `todo` 那一句就是记着这笔账，图集做完这两条要压回 72 / 64 那一档重新量。
     *
     * 余量收到 1.33 倍（别处是 1.5 倍）是因为这条不是采样估计值：它数的是屏幕上的纹理条数，
     * 跨机器完全确定——「同一段剧本跑两遍数字一模一样」那条断言本身就在保证这一点，
     * 所以它不需要留给噪声的那部分余量。
     */
    batchBreaksPerFrame: {
      value: 132,
      discipline: '3.9 合批被打断',
      todo: '被结算层的文字顶上去的，文字上共享图集之后要压回来',
    },
    /*
     * 6.9 表原话是「移动端档位为 0，桌面档位设上限」，验证下来桌面档实测也是 0，所以就定 0。
     * 不是巧合：效果分档那三档都不挂 Filter（见 canvas 的 fx/effectTier.ts），
     * 烟尘走预烤纹理、落地亮环走自己写的着色器，动画期间一次离屏都不需要。
     * 烤纹理本身要离屏，但那件事发生在建场景时，不在剧本的计数窗口里。
     */
    offscreenBindsPerFrame: { value: 0, discipline: '3.1 离屏渲染' },
  },
  mobile: {
    ...SHARED,
    // 实测峰值 80 次（结算那段；出牌那段是 46 次），比桌面的 98 低——手机档效果档 low
    // 不开卡面反光，那一层带自己的着色器，桌面档同一批数据里因此还多几次程序切换。
    // 留 1.33 倍余量取整到 108。手机档比桌面严一档是应该的，不能跟着桌面一起放宽。
    // 32 → 64 → 108 两次放宽的理由和桌面档那条一样，见上面。
    batchBreaksPerFrame: {
      value: 108,
      discipline: '3.9 合批被打断',
      todo: '被结算层的文字顶上去的，文字上共享图集之后要压回来',
    },
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

/** 上限身上还欠着账的那几条（见 `Limit.todo`），跑批结束时连同欠的是什么一起打出来提醒。 */
export function pendingLimits(limits: Limits): { key: LimitKey; todo: string }[] {
  const pending: { key: LimitKey; todo: string }[] = []
  for (const key of Object.keys(limits) as LimitKey[]) {
    const todo = limits[key].todo
    if (todo !== undefined) pending.push({ key, todo })
  }
  return pending
}
