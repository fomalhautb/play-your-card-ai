import { describe, expect, it } from 'vitest'
import { isUrgeId, pickUrgeId, URGE_LINES, urgeLineOf } from '../src/index'

/**
 * 催一催的喊话表。
 *
 * 这张表同时是服务端的转发白名单和气泡上的字幕，所以两头都要守：
 * id 不能重、查不到的 id 一律拒，摇号不能摇出表外的东西。
 */
describe('催一催喊话表', () => {
  it('四句喊话，id 不重复、文字都不为空', () => {
    expect(URGE_LINES).toHaveLength(4)
    expect(new Set(URGE_LINES.map((line) => line.id)).size).toBe(URGE_LINES.length)
    for (const line of URGE_LINES) expect(line.text.length).toBeGreaterThan(0)
  })

  it('表里的 id 认得出来，表外的一律不认', () => {
    for (const line of URGE_LINES) expect(isUrgeId(line.id)).toBe(true)
    expect(isUrgeId('没有这句')).toBe(false)
    // 查的是数组不是对象，所以原型链上的名字天然不会误判；写一条钉住这个行为。
    expect(isUrgeId('toString')).toBe(false)
  })

  it('urgeLineOf 查得到文字，查不到返回 null', () => {
    expect(urgeLineOf('hurryUp')?.text).toBe('快点啊，我等的花都谢了')
    expect(urgeLineOf('没有这句')).toBeNull()
  })

  it('摇号只会摇出表里的 id，边界值也不越界', () => {
    expect(pickUrgeId(0)).toBe(URGE_LINES[0]!.id)
    // 1 不在 [0,1) 里，但调用方传错时也不能返回 undefined。
    expect(pickUrgeId(1)).toBe(URGE_LINES[URGE_LINES.length - 1]!.id)
    for (let i = 0; i < URGE_LINES.length; i += 1) {
      expect(isUrgeId(pickUrgeId(i / URGE_LINES.length))).toBe(true)
    }
  })
})
