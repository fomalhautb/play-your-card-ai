/**
 * 存储能力：把一份数据存在这台机器上，下次进游戏还在。
 *
 * 旧代码里两处存档（legacy-client/src/save/save.ts 的收藏和胜场、deckStore.ts 的牌组）
 * 各自重复了同一套动作：拼一个带版本号的 key、JSON 序列化、读的时候逐字段校验、
 * 全程 try/catch 静默失败。重复的那三件事挪到接口上，实现只剩「按 key 存取字符串」。
 *
 * 为什么读写都不抛错：隐私模式、站点数据被禁、配额满的浏览器上，光是碰一下存储就会抛。
 * 而这里存的是游戏进度——丢了最多是这次白玩，不值得把整个界面带崩。
 */

export interface StorageSlot<T> {
  /** 存档位的名字，同一个应用里唯一。 */
  name: string
  /**
   * 结构版本号。改了字段就 +1：旧数据读不出来就当新号，不写迁移代码。
   * 项目不做向后兼容（见 AGENTS.md），所以版本号是「作废旧档」的开关，不是迁移的路标。
   */
  version: number
  /**
   * 把读出来的 JSON 校验并规整成 T。返回 null 表示这份存档不能用，调用方回落到默认值。
   *
   * 这一步不能省：存档是玩家机器上的一段文本，可能被手改过，也可能是上个版本留下的。
   * 旧代码里两处存档都是在这儿把不存在的卡 id 滤掉的——不滤的话，渲染时才炸。
   */
  parse(raw: unknown): T | null
}

export interface StorageCapability {
  /** 读不到、解析失败、parse 判定作废、浏览器不让读，一律返回 null。 */
  read<T>(slot: StorageSlot<T>): T | null
  /** 写不进去（隐私模式、配额满）就静默放弃，本次会话内的内存状态照常有效。 */
  write<T>(slot: StorageSlot<T>, value: T): void
  /** 删掉这一位存档。用于「清空存档回到新号」。 */
  remove<T>(slot: StorageSlot<T>): void
}

/**
 * 存档位在底层存储里的键名。
 *
 * 版本号拼进键名而不是写进内容：旧版本的数据就此再也读不到，
 * 不需要读出来判断版本再丢掉，也不会出现「读了一半才发现版本不对」。
 * 形状照抄旧代码的 `ai-duel-save-v7`。
 */
export function storageKeyOf(slot: StorageSlot<unknown>): string {
  return `${slot.name}.v${slot.version}`
}
