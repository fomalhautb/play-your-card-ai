/**
 * 一个 Durable Object 只有**一个** alarm，房间却有两件定时的事要办：
 * 答题阶段到点替 AI 交卷（autopilot.ts），以及空房太久自己收摊（lifecycle.ts）。
 * 这个文件就是把两件事挤进同一个 alarm 的那点调度。
 *
 * 做法：每种任务各记一个到点时刻，存在房间自己的 SQLite 里（`deadlines` 那一行），
 * 运行时的 alarm 永远对到**最早**的那个。alarm 响了就把到点的那几种摘出来交给各自的处理函数，
 * 剩下的重新对表。为什么不是「存一个字段说下次 alarm 是干什么的」：
 * 那样排第二种任务时得先比较谁更早、还要记住被挤掉的那个什么时候补回来，
 * 到点时刻各存一份反而没有需要维护的额外状态。
 *
 * ## 「到点」为什么不是 `dueAt <= now`
 *
 * `takeDue` 把**最早的那个**一律当作到点，哪怕 `Date.now()` 还差一点点。
 * 运行时保证 alarm 只会在最早那个时刻附近被叫醒，早零点几毫秒是可能的；
 * 严格按 `dueAt <= now` 判会得出「一个都没到点」，然后原样重排一次 alarm，
 * 极端情况下反复空转。顺带的好处是测试可以直接把 alarm 叫醒
 * （`runDurableObjectAlarm`），不必真等 2.5 秒。
 */

import type { AlarmDeadlines, AlarmKind, RoomStore } from './state'

/** 把运行时的 alarm 对到最早那个到点时刻；一个都没排就把 alarm 撤掉。 */
async function syncAlarm(ctx: DurableObjectState, deadlines: AlarmDeadlines): Promise<void> {
  const times = Object.values(deadlines)
  if (times.length === 0) {
    await ctx.storage.deleteAlarm()
    return
  }
  await ctx.storage.setAlarm(Math.min(...times))
}

/** 排一件定时的事，同一种再排一次就是改时间（不会排出两份）。 */
export async function scheduleAlarm(
  ctx: DurableObjectState,
  store: RoomStore,
  kind: AlarmKind,
  at: number,
): Promise<void> {
  const deadlines = { ...store.deadlines(), [kind]: at }
  store.saveDeadlines(deadlines)
  await syncAlarm(ctx, deadlines)
}

/** 撤掉这几种任务。房间收摊时把两种一起撤掉，对象就再也不会被叫醒了。 */
export async function cancelAlarms(
  ctx: DurableObjectState,
  store: RoomStore,
  ...kinds: AlarmKind[]
): Promise<void> {
  const deadlines = store.deadlines()
  for (const kind of kinds) delete deadlines[kind]
  store.saveDeadlines(deadlines)
  await syncAlarm(ctx, deadlines)
}

/**
 * alarm 回调开头调用：把到点的那几种取走（从表里删掉），剩下的重新对表。
 *
 * 取走之后才跑处理函数，所以处理函数里可以放心地把同一种再排一次
 * （空房超时就是这么一轮一轮续下去的）。
 */
export async function takeDueAlarms(
  ctx: DurableObjectState,
  store: RoomStore,
  now: number,
): Promise<AlarmKind[]> {
  const deadlines = store.deadlines()
  const times = Object.values(deadlines)
  if (times.length === 0) return []
  const earliest = Math.min(...times)
  const due: AlarmKind[] = []
  for (const [kind, at] of Object.entries(deadlines) as [AlarmKind, number][]) {
    if (at > now && at > earliest) continue
    due.push(kind)
    delete deadlines[kind]
  }
  store.saveDeadlines(deadlines)
  await syncAlarm(ctx, deadlines)
  return due
}
