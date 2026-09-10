/**
 * 「催一催」的四句喊话。
 *
 * 放在内容包而不是客户端：这一句要发给对面（协议的 `room:urge` 只带 id 不带文字），
 * 服务端得拿这张表判断 id 认不认识，认不出就回 `unknown-urge` 不转发。
 * 客户端和服务端读同一张表，就不会出现「这边喊得出、那边不认」。
 *
 * `text` 就是录音里念的那句话，两者必须对得上——气泡是给听不清或没开声音的人看的字幕。
 * 录音文件挂在哪个音效上不写在这里：那是客户端的事（见 client 的 audio/sounds.ts），
 * 内容包不认识播放器。
 */

export type UrgeId = 'canYouDoIt' | 'hurryUp' | 'comeOn' | 'questionAi'

export interface UrgeLine {
  id: UrgeId
  /** 录音内容的文字版，直接显示在气泡里。 */
  text: string
}

export const URGE_LINES: readonly UrgeLine[] = [
  { id: 'canYouDoIt', text: '到底行不行啊' },
  { id: 'hurryUp', text: '快点啊，我等的花都谢了' },
  { id: 'comeOn', text: '抓紧吧您嘞' },
  { id: 'questionAi', text: '这题你 AI 会吗' },
]

/** 网上进来的 id 可能是任何字符串，查不到就返回 null。 */
export function urgeLineOf(id: string): UrgeLine | null {
  return URGE_LINES.find((line) => line.id === id) ?? null
}

/** 服务端转发前的那道校验：认不认识这个 id。 */
export function isUrgeId(id: string): id is UrgeId {
  return urgeLineOf(id) !== null
}

/**
 * 摇一句喊话。
 *
 * 随机数由调用方传进来（和 `drawNewCard` 一个规矩）：这一句要同步给对面，
 * 只能摇一次再把结果发过去，两端各摇各的就会一个人听到 A、另一个人听到 B。
 *
 * @param random 取值范围 [0, 1)
 */
export function pickUrgeId(random: number): UrgeId {
  // 夹一下上界：传进来正好是 1（或浮点误差算出等于长度的下标）时不夹会取到 undefined。
  const index = Math.min(Math.floor(random * URGE_LINES.length), URGE_LINES.length - 1)
  return URGE_LINES[index]!.id
}
