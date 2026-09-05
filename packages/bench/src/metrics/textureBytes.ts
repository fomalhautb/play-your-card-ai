/**
 * 一张纹理占多少字节。给 6.9 表「常驻纹理内存」那行用。
 *
 * 单独拆出来是因为它是纯算术、和 WebGL 上下文无关，可以在 Node 里直接跑单元测试；
 * glCounters.ts 那边全是包装真实上下文的副作用代码，测不了。
 *
 * 这里算的是「驱动至少要为这一层分配多少字节」，不含驱动自己的对齐和压缩，
 * 所以是下界不是精确值。作为预算门禁够用：真实占用只会更大，不会更小。
 */

/** 未定尺寸的基础格式 → 通道数。这几个的每通道字节数要看 type。 */
const CHANNELS_BY_BASE_FORMAT: Readonly<Record<number, number>> = {
  6406: 1, // ALPHA
  6409: 1, // LUMINANCE
  6410: 2, // LUMINANCE_ALPHA
  6407: 3, // RGB
  6408: 4, // RGBA
  6403: 1, // RED
  33319: 2, // RG
  6402: 1, // DEPTH_COMPONENT
  34041: 2, // DEPTH_STENCIL
}

/** 像素类型 → 每通道字节数。打包类型（5_6_5 这些）在下面单独处理。 */
const BYTES_BY_TYPE: Readonly<Record<number, number>> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5124: 4, // INT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
  5131: 2, // HALF_FLOAT
}

/** 每个像素固定字节数的打包类型和已定尺寸的 internalformat。 */
const BYTES_PER_PIXEL: Readonly<Record<number, number>> = {
  // 打包的像素类型
  33635: 2, // UNSIGNED_SHORT_5_6_5
  32819: 2, // UNSIGNED_SHORT_4_4_4_4
  32820: 2, // UNSIGNED_SHORT_5_5_5_1
  33640: 4, // UNSIGNED_INT_2_10_10_10_REV
  35899: 4, // UNSIGNED_INT_10F_11F_11F_REV
  35902: 4, // UNSIGNED_INT_5_9_9_9_REV
  34042: 4, // UNSIGNED_INT_24_8
  // 已定尺寸的 internalformat（WebGL2）
  33321: 1, // R8
  33323: 2, // RG8
  32849: 3, // RGB8
  32856: 4, // RGBA8
  35905: 3, // SRGB8
  35907: 4, // SRGB8_ALPHA8
  36194: 2, // RGB565
  32854: 2, // RGBA4
  32855: 2, // RGB5_A1
  32857: 4, // RGB10_A2
  35898: 4, // R11F_G11F_B10F
  33325: 2, // R16F
  33327: 4, // RG16F
  34843: 6, // RGB16F
  34842: 8, // RGBA16F
  33326: 4, // R32F
  33328: 8, // RG32F
  34837: 12, // RGB32F
  34836: 16, // RGBA32F
  33189: 2, // DEPTH_COMPONENT16
  33190: 4, // DEPTH_COMPONENT24
  36012: 4, // DEPTH_COMPONENT32F
  35056: 4, // DEPTH24_STENCIL8
  36013: 8, // DEPTH32F_STENCIL8
}

/** 认不出来的格式按 RGBA8 算。宁可高估，也别让一整张纹理从预算里消失。 */
const FALLBACK_BYTES_PER_PIXEL = 4

/** 一个像素多少字节。type 传 0 表示只知道 internalformat（texStorage2D 就是这种）。 */
export function bytesPerPixel(internalFormat: number, type: number): number {
  const sized = BYTES_PER_PIXEL[internalFormat]
  if (sized !== undefined) return sized

  const packed = BYTES_PER_PIXEL[type]
  if (packed !== undefined) return packed

  const channels = CHANNELS_BY_BASE_FORMAT[internalFormat]
  const perChannel = BYTES_BY_TYPE[type]
  if (channels !== undefined && perChannel !== undefined) return channels * perChannel

  return FALLBACK_BYTES_PER_PIXEL
}

/** 一层（一个 mip level）占多少字节。 */
export function levelBytes(
  width: number,
  height: number,
  internalFormat: number,
  type: number,
): number {
  if (!(width > 0) || !(height > 0)) return 0
  return Math.round(width * height * bytesPerPixel(internalFormat, type))
}

/**
 * texStorage2D 一次把所有 mip 层都分配掉，这里把它们加起来。
 * 每层宽高各减半、最小到 1，所以总量接近第 0 层的 4/3 倍。
 */
export function storageBytes(
  levels: number,
  width: number,
  height: number,
  internalFormat: number,
): number {
  let total = 0
  let w = width
  let h = height
  for (let i = 0; i < levels; i += 1) {
    total += levelBytes(w, h, internalFormat, 0)
    w = Math.max(1, w >> 1)
    h = Math.max(1, h >> 1)
  }
  return total
}

/**
 * generateMipmap 在第 0 层之外补出来的字节数。
 *
 * 完整 mip 链是 1 + 1/4 + 1/16 + … ≈ 4/3 倍，所以补出来的约等于第 0 层的 1/3。
 * 这里不逐层精算：调用点只知道「某张纹理生成了 mipmap」，各层的实际尺寸要再查一遍状态，
 * 而 1/3 的误差远小于它在预算里占的比重。
 */
export function mipmapExtraBytes(levelZeroBytes: number): number {
  return Math.round(levelZeroBytes / 3)
}

/** 从 texImage2D 的 6 参数重载里那个 source 参数上读宽高。读不出来就返回 null。 */
export function sourceSize(source: unknown): { width: number; height: number } | null {
  if (source === null || typeof source !== 'object') return null
  const any = source as Record<string, unknown>
  const width = any.width ?? any.videoWidth ?? any.naturalWidth ?? any.displayWidth
  const height = any.height ?? any.videoHeight ?? any.naturalHeight ?? any.displayHeight
  if (typeof width !== 'number' || typeof height !== 'number') return null
  return { width, height }
}
