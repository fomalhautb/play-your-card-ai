/**
 * 存储能力的假实现：一个内存 Map。
 *
 * 键的算法和 web 实现共用（storageKeyOf），所以「换了版本号就读不到旧档」这条规矩
 * 在假实现上也成立——版本这件事只要有一处写错，测试就该红。
 */

import { createSignal } from '../listeners'
import type { StorageCapability, StorageSlot } from '../storage'
import { storageKeyOf } from '../storage'

export interface FakeStorage extends StorageCapability {
  /** 底层存的原文，键是「名字.v版本」。断言存了什么、存了几次都看它。 */
  readonly entries: ReadonlyMap<string, string>
  /**
   * 直接塞一段原文进去。
   * 用来模拟被手改过的存档、上个版本留下的存档，以及压根不是 JSON 的一段字符串。
   */
  setRaw(key: string, text: string): void
  /**
   * 让接下来的读写都抛错，模拟隐私模式那种「碰一下存储就炸」的浏览器。
   * 接口保证这种情况下调用方什么都不用做，测试要能把这条验出来。
   */
  setBroken(broken: boolean): void
  /** 每次写入之后通知一次，参数是写入的键。 */
  onWrite(listener: (key: string) => void): () => void
  clear(): void
}

export function createFakeStorage(): FakeStorage {
  const entries = new Map<string, string>()
  const written = createSignal<string>()
  let broken = false

  return {
    entries,

    read<T>(slot: StorageSlot<T>): T | null {
      if (broken) return null
      const raw = entries.get(storageKeyOf(slot))
      if (raw === undefined) return null
      try {
        return slot.parse(JSON.parse(raw))
      } catch {
        // 半截 JSON，或者 parse 自己写崩了。两种都当这份存档不能用。
        return null
      }
    },
    write(slot, value) {
      if (broken) return
      const key = storageKeyOf(slot)
      entries.set(key, JSON.stringify(value))
      written.emit(key)
    },
    remove(slot) {
      if (broken) return
      entries.delete(storageKeyOf(slot))
    },

    setRaw(key, text) {
      entries.set(key, text)
    },
    setBroken(next) {
      broken = next
    },
    onWrite: (listener) => written.add(listener),
    clear() {
      entries.clear()
    },
  }
}
