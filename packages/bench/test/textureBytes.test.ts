import { describe, expect, it } from 'vitest'
import {
  bytesPerPixel,
  levelBytes,
  mipmapExtraBytes,
  sourceSize,
  storageBytes,
} from '../src/metrics/textureBytes'

const RGBA = 0x1908
const RGB = 0x1907
const RGBA8 = 0x8058
const RGBA16F = 0x881a
const UNSIGNED_BYTE = 0x1401
const UNSIGNED_SHORT_5_6_5 = 0x8363
const HALF_FLOAT = 0x140b

describe('bytesPerPixel', () => {
  it('已定尺寸的 internalformat 直接查表', () => {
    expect(bytesPerPixel(RGBA8, UNSIGNED_BYTE)).toBe(4)
    expect(bytesPerPixel(RGBA16F, HALF_FLOAT)).toBe(8)
  })

  it('未定尺寸的按「通道数 × 每通道字节数」算', () => {
    expect(bytesPerPixel(RGBA, UNSIGNED_BYTE)).toBe(4)
    expect(bytesPerPixel(RGB, UNSIGNED_BYTE)).toBe(3)
  })

  it('打包的像素类型每像素字节数由 type 决定', () => {
    expect(bytesPerPixel(RGB, UNSIGNED_SHORT_5_6_5)).toBe(2)
  })

  it('认不出来的格式按 RGBA8 算，宁可高估也别让整张纹理从预算里消失', () => {
    expect(bytesPerPixel(0x9999, 0x8888)).toBe(4)
  })
})

describe('levelBytes', () => {
  it('宽 × 高 × 每像素字节数', () => {
    expect(levelBytes(128, 176, RGBA8, UNSIGNED_BYTE)).toBe(128 * 176 * 4)
  })

  it('宽高不合法时算 0，不产生 NaN 污染总量', () => {
    expect(levelBytes(0, 100, RGBA8, UNSIGNED_BYTE)).toBe(0)
    expect(levelBytes(Number.NaN, 100, RGBA8, UNSIGNED_BYTE)).toBe(0)
  })
})

describe('storageBytes', () => {
  it('把所有 mip 层加起来，每层宽高减半', () => {
    // 4×4 的 RGBA8：16×4 + 4×4 + 1×4 = 84
    expect(storageBytes(3, 4, 4, RGBA8)).toBe(84)
  })

  it('只有一层时就是第 0 层本身', () => {
    expect(storageBytes(1, 8, 8, RGBA8)).toBe(8 * 8 * 4)
  })

  it('非正方形也能一路减到 1', () => {
    expect(storageBytes(4, 8, 2, RGBA8)).toBe((8 * 2 + 4 * 1 + 2 * 1 + 1 * 1) * 4)
  })
})

describe('mipmapExtraBytes', () => {
  it('完整 mip 链约等于第 0 层的 4/3，补出来的是 1/3', () => {
    expect(mipmapExtraBytes(300)).toBe(100)
  })
})

describe('sourceSize', () => {
  it('认 width/height', () => {
    expect(sourceSize({ width: 64, height: 32 })).toEqual({ width: 64, height: 32 })
  })

  it('认视频和图片各自的尺寸字段', () => {
    expect(sourceSize({ videoWidth: 10, videoHeight: 20 })).toEqual({ width: 10, height: 20 })
    expect(sourceSize({ naturalWidth: 5, naturalHeight: 6 })).toEqual({ width: 5, height: 6 })
  })

  it('读不出尺寸就返回 null，让调用方跳过记账而不是记一笔假的', () => {
    expect(sourceSize(null)).toBeNull()
    expect(sourceSize({})).toBeNull()
    expect(sourceSize('not an object')).toBeNull()
  })
})
