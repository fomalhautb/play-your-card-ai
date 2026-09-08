/**
 * 存储能力的网页实现：localStorage。
 *
 * 没有引第三方库。要做的只是「按键存取一个字符串」，localStorage 本身就是这个形状；
 * idb 那类库解决的是异步、大对象、结构化查询，而这里存的是几 KB 的存档，用不上。
 * 三个壳里 localStorage 都有：Electron 的渲染进程是 Chromium，Capacitor 是系统 WebView。
 *
 * 每一处都吞异常：隐私模式、站点数据被禁、配额满的浏览器上，**光是读一下** localStorage
 * 就会抛。存档丢了最多是这次白玩，不该把整个界面带崩。
 */

import type { StorageCapability, StorageSlot } from '../storage'
import { storageKeyOf } from '../storage'

export function createWebStorage(): StorageCapability {
  return {
    read(slot) {
      const raw = readText(storageKeyOf(slot))
      if (raw === null) return null
      return parseSlot(slot, raw)
    },
    write(slot, value) {
      try {
        localStorage.setItem(storageKeyOf(slot), JSON.stringify(value))
      } catch {
        // 写不进去就算了，本次会话内的内存状态照常有效。
      }
    },
    remove(slot) {
      try {
        localStorage.removeItem(storageKeyOf(slot))
      } catch {
        // 删不掉也不影响这次会话。
      }
    },
  }
}

function readText(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * 反序列化再交给存档位自己校验。
 *
 * JSON.parse 和 parse 一起包在 try 里：存档是玩家机器上的文本，可能被手改成半截 JSON，
 * 而 parse 里通常有一串字段判断，写错了也会抛。两种都当「这份存档不能用」处理。
 */
function parseSlot<T>(slot: StorageSlot<T>, raw: string): T | null {
  try {
    return slot.parse(JSON.parse(raw))
  } catch {
    return null
  }
}
