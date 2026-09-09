/**
 * 「一条 cue 怎么播」的签名。
 *
 * 播放器是纯函数：拿上下文和这一条 cue，动组件，不返回任何东西——
 * **渲染器不回调编排层**（见 director/cues.ts 的文件头），播完之后该发生什么由编排层
 * 自己在虚拟时钟上排好期，这边只管照做。
 */

import type { Cue } from '../../../director/cues'
import type { DuelContext } from '../context'

type CuePlayer<K extends Cue['kind']> = (ctx: DuelContext, cue: Extract<Cue, { kind: K }>) => void

/** 一整张表：每一种 cue 都得有一条。少一种编译不过（6.5 的对偶）。 */
export type CuePlayers = { [K in Cue['kind']]: CuePlayer<K> }

/** 一组播放器（按 cue 的种类分文件），几组并起来才是完整的表。 */
export type CuePlayerGroup<K extends Cue['kind']> = { [P in K]: CuePlayer<P> }
