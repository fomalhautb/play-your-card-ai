/**
 * 定种子随机数。6.9 要求「随机定种子」，剧本里所有抖动、粒子偏移都从这里来。
 *
 * 用 mulberry32：三十行不到、纯整数运算，同一个种子在任何 JS 引擎上都给出同一串数。
 * 不用 Math.random——它没有种子，一跑一个样，确定性指标立刻变成噪声。
 * core 包里那个 pure-rand 是给规则引擎用的，bench 不依赖 core（见 7.2 第 1 条）。
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
