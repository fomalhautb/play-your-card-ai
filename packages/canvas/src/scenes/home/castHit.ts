/**
 * 首页人物的**逐像素 alpha 命中判定**，纯函数那一半（不碰 Pixi，vitest 里直接跑）。
 *
 * 为什么不能靠 Pixi 自己的命中判定：七张人物抠图都是和舞台等大的整幅透明图，
 * 一张盖一张铺在四张展示卡**之上**。谁收指针事件，谁就把底下的卡挡死了——
 * 这正是旧版 `screens/castHitTest.ts` 开头写死的那条约束，换成 Pixi 之后一字未变。
 *
 * 所以做法照旧：建场景时给每张图烤一张**低分辨率的 alpha 掩码**（怎么烤见 castMask.ts），
 * 指针移动时把坐标归一化，从最上层往下查哪张图在这个点是不透明的。
 * 每帧读像素是绝对不行的（那是一次 GPU 回读），而查一张已经在内存里的 Uint8Array
 * 只是一次下标访问。
 *
 * 压在人物之上的桌面弧和前景道具也各烤一张，当「遮挡层」从命中区里减掉：
 * 人物下半身被桌沿和地球仪压住的那部分在屏幕上根本看不见，不减掉就会出现
 * 「指着地球仪却弹出了它后面那个人的介绍卡」。
 */

/** 归一化包围盒，四个值都是 0~1 的比例（相对图片宽高）。介绍卡的落点按它算。 */
export interface NormalizedBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 一张图烤出来的 alpha 掩码。 */
export interface AlphaMask {
  width: number
  height: number
  /** 逐像素 alpha（0~255），行优先，长度 = width * height。 */
  alpha: Uint8Array
  /** 不透明像素的包围盒；整张全透明（或烤失败）时是 null。 */
  bbox: NormalizedBox | null
}

/**
 * 「这个像素算人物身上」的 alpha 下限。
 *
 * 抠图边缘是笔刷化开的半透明羽化，取 64（约 25%）是让指针必须真的压到人身上才算命中；
 * 蹭到轮廓外那圈虚边不触发，否则相邻两个人的虚边会重叠，高亮来回跳。
 * 数值抄旧版 `castHitTest.ts` 的 `CAST_ALPHA_THRESHOLD`。
 */
export const CAST_ALPHA_THRESHOLD = 64

/**
 * 掩码的目标宽度（1x 素材 1672 的四分之一）。
 *
 * 命中精度和内存的折中：每张落在约 418×235，一张约 96KB，九张不到 1MB，
 * 轮廓误差约 4 个屏幕像素，hover 判定完全够用。
 * 按**目标宽度**而不是按素材倍数缩，是因为人物抠图是 2x、遮挡层是 1x，
 * 按倍数缩必然顾此失彼（旧版同一处的理由）。
 */
export const CAST_MASK_WIDTH = 418

/**
 * 从 alpha 数组算不透明像素的归一化包围盒。
 *
 * 朴素地扫全图记四个极值：掩码一律缩到固定宽度，一张恒定就是十万个像素上下，
 * 而且每张一辈子只算一次，没必要为它做行列的提前跳出。
 */
export function alphaBBox(
  alpha: Uint8Array,
  width: number,
  height: number,
  threshold: number = CAST_ALPHA_THRESHOLD,
): NormalizedBox | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      if ((alpha[row + x] ?? 0) < threshold) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0 || maxY < 0) return null

  // 极值是像素下标，转成比例时右 / 下边界要 +1：下标 5 的像素占的是 [5, 6) 这一格。
  return {
    minX: minX / width,
    minY: minY / height,
    maxX: (maxX + 1) / width,
    maxY: (maxY + 1) / height,
  }
}

/** 读一张掩码在归一化坐标处的 alpha；空掩码（烤失败）当全透明。 */
function sample(mask: AlphaMask | undefined, nx: number, ny: number): number {
  if (mask === undefined || mask.width <= 0 || mask.height <= 0) return 0
  const x = Math.min(mask.width - 1, Math.floor(nx * mask.width))
  const y = Math.min(mask.height - 1, Math.floor(ny * mask.height))
  return mask.alpha[y * mask.width + x] ?? 0
}

/**
 * 在一组掩码上做命中判定，返回命中的下标（没命中是 null）。
 *
 * `masks` 的顺序就是叠放顺序，所以从**最后一项往前**查：站在前排的人排在数组后面，
 * 两个人重叠的地方应该判给挡在前面的那个。
 *
 * `occluders` 是排在人物**之上**的图层（桌面弧、前景道具）。它们不参与「命中谁」，
 * 只回答「这个点还看得见人吗」——任一遮挡层在这个点不透明，就当没命中。
 *
 * `nx` / `ny` 是相对整幅图的归一化坐标（左上角 0,0，右下角 1,1）。
 */
export function hitTestMasks(
  masks: readonly AlphaMask[],
  nx: number,
  ny: number,
  occluders: readonly AlphaMask[] = [],
  threshold: number = CAST_ALPHA_THRESHOLD,
): number | null {
  // 写成「不满足才返回」是为了顺手挡住 NaN：NaN 的任何比较都是 false。
  if (!(nx >= 0) || !(ny >= 0) || nx >= 1 || ny >= 1) return null

  // 遮挡层先查：只有两张，命中就能省下后面扫七张人物图的开销。
  for (const occluder of occluders) {
    if (sample(occluder, nx, ny) >= threshold) return null
  }

  for (let index = masks.length - 1; index >= 0; index -= 1) {
    if (sample(masks[index], nx, ny) >= threshold) return index
  }

  return null
}

/** 烤失败时的兜底：一张永远不命中、也没有包围盒的空掩码，让首页照常显示。 */
export function emptyMask(): AlphaMask {
  return { width: 0, height: 0, alpha: new Uint8Array(0), bbox: null }
}
