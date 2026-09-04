/**
 * 场景里所有随机数的唯一来源，定种子、可重放。
 *
 * 不用 Math.random：6.9 要求「同一段剧本在任何机器上产生的确定性指标必须一模一样」，
 * 而烟尘往哪儿飘、飘多远都会影响画面和绘制调用，一处用了系统随机整条断言就废了。
 * 用 pure-rand 是因为 `packages/core` 已经在用同一个库做确定性随机，全仓库一个口径。
 *
 * 生成器选 mersenne 而不是更快的 xoroshiro128plus，理由和 core 的 engine.ts 一样：
 * 后者从整数种子起步时相邻种子的头几个输出低位强相关，而剧本里的 seed 往往就是
 * 1、2、3 这种连号，第一把烟尘会跟着种子走出规律来。
 *
 * pure-rand v8 没有包根入口，只能按子路径 import，所以下面几行看着才这么长。
 */

import { uniformFloat64 } from 'pure-rand/distribution/uniformFloat64'
import { mersenne } from 'pure-rand/generator/mersenne'
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator'

export class Rng {
  private readonly generator: RandomGenerator

  constructor(seed: number) {
    this.generator = mersenne(seed)
  }

  /** [0, 1) 之间的一个数。 */
  next(): number {
    // uniformFloat64 就地推进生成器状态，不会每次取数都新建一个 generator 对象
    // ——粒子一次要取几十个数，这条路径上不该有额外分配（3.10）。
    return uniformFloat64(this.generator)
  }

  /** [min, max) 之间的一个数。 */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }
}
