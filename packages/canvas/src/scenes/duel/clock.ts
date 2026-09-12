/**
 * 场景自己的虚拟时钟：cue 队列，加上「过一会儿做一件事」的排程。
 *
 * 为什么场景要有自己的时钟，而不是收到 cue 就当场播：`cue.at` 是**编排层**虚拟时钟上的
 * 时刻，而编排层一次 `advance` 可能跨过好几秒——一批事件进去，几十条 cue 一起吐出来，
 * 每条各自标着自己该在第几毫秒演。当场全播就是几十段演出同时开始。
 * 所以这里按 `at` 排队，场景的时钟走到那一刻才播。
 *
 * 时钟只在 `step` 里前进，不认识真实时间：手动时钟下一帧推多久由调用方决定（6.9 的确定性前提），
 * 真实时钟下推的是这一帧的实际间隔。两条路走的是同一段代码。
 */

import type { Cue } from '../../director/cues'

interface Task {
  at: number
  /** 同一毫秒上按登记先后跑，保证顺序确定，不受数组扫描顺序影响。 */
  seq: number
  run: () => void
}

export interface SceneClock {
  /** 当前虚拟时刻（毫秒）。 */
  now(): number
  /** 把一批 cue 排进队列。它们已经按 `at` 升序（`drain()` 的约定）。 */
  enqueue(cues: readonly Cue[]): void
  /** 排一件将来要做的事。 */
  after(delayMs: number, run: () => void): void
  /** 推进时钟，把到点的 cue 和排程按时刻依次交出去。 */
  advance(deltaMs: number, playCue: (cue: Cue) => void): void
  /** 队列和排程都空了。 */
  isIdle(): boolean
  /** 全部丢掉，时钟归零（换一局）。 */
  reset(): void
}

export function createSceneClock(): SceneClock {
  let now = 0
  let seq = 0
  const cues: Cue[] = []
  const tasks: Task[] = []

  /** 找出不晚于 `limit` 的下一件排程：先比时刻，同刻比登记顺序。 */
  const nextTask = (limit: number): Task | undefined => {
    let best: Task | undefined
    for (const task of tasks) {
      if (task.at > limit) continue
      if (best === undefined || task.at < best.at || (task.at === best.at && task.seq < best.seq)) {
        best = task
      }
    }
    return best
  }

  return {
    now: () => now,

    /**
     * 队列空着时把时钟对到这一批的**第一条**上。
     *
     * 编排层和场景是两台各自推进的时钟，中间隔着「先 advance 再 drain 再 step」这一拍，
     * 不对一次的话场景永远慢编排层一截，而且那个差会随着场景建得晚一点越拉越大。
     * 只在队列空着时对：正演到一半时把时钟往前拨，会把还没播的那几条一次全倒出来。
     */
    enqueue(batch) {
      if (batch.length === 0) return
      if (cues.length === 0 && tasks.length === 0) now = Math.max(now, batch[0]!.at)
      cues.push(...batch)
      // `at` 升序是 drain() 的约定，但两批之间可能交错（上一批还没播完又来一批），所以稳一下。
      cues.sort((a, b) => a.at - b.at)
    },

    after(delayMs, run) {
      seq += 1
      tasks.push({ at: now + Math.max(0, delayMs), seq, run })
    },

    /**
     * 推进一帧。
     *
     * cue 和排程按时刻交错跑：一条 cue 排下的收尾可能就在同一帧内到点
     *（比如 `durationMs` 为 0 的那几种），而它排下的下一件事要按新的时刻算。
     * 所以每次都取「时刻最小的那一件」，而不是先把 cue 播完再跑排程。
     */
    advance(deltaMs, playCue) {
      const target = now + deltaMs
      for (;;) {
        const cue = cues[0]
        const task = nextTask(target)
        const cueDue = cue !== undefined && cue.at <= target
        if (!cueDue && task === undefined) break
        // cue 和排程同刻时先播 cue：排程是某条 cue 排下的收尾，收尾不该跑在自己前面。
        if (cueDue && (task === undefined || cue!.at <= task.at)) {
          cues.shift()
          now = Math.max(now, cue!.at)
          playCue(cue!)
          continue
        }
        if (task === undefined) break
        tasks.splice(tasks.indexOf(task), 1)
        now = Math.max(now, task.at)
        task.run()
      }
      now = target
    },

    isIdle: () => cues.length === 0 && tasks.length === 0,

    reset() {
      cues.length = 0
      tasks.length = 0
      now = 0
      seq = 0
    },
  }
}
