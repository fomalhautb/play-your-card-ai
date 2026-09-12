/**
 * 游客账号：进站开一个号，之后每次连 WebSocket 现换一张短时效 JWT。
 *
 * 服务端那半边是 better-auth 配 D1（见 server README「账号与鉴权」）：
 * 会话在 cookie 里，`/api/auth/token` 拿会话换一张十五分钟有效的 JWT，
 * 握手时它塞在 `Sec-WebSocket-Protocol` 里（协议的 handshake.ts）。
 * 现在只有游客一种登录方式——**换个浏览器就是另一个人**，绑定邮箱是第 31 条的事。
 *
 * ## 三条请求为什么走 `platform.network.requestJson`
 *
 * 客户端的网络一律从平台能力走（架构第 2 节第 5 条），账号这几条也不例外：
 * `requestJson` 就是为「取一份 JSON」准备的那一个方法。它不暴露 `credentials`，
 * 靠的是同源默认会带 cookie——而同源正是这套部署的前提（前端和 Worker 是同一个 Worker，
 * 本地开发由 Vite 代理伪装成同源，见 net/endpoints.ts）。跨源部署会当场失效，
 * 那时该补的是 platform 那一层，不是在这里绕过它直接 `fetch`。
 *
 * ## 为什么先问一句 get-session
 *
 * 游客登录**不能重复做**：已经有游客会话时再 POST 一次 `/sign-in/anonymous`，
 * better-auth 会回 400（它的 `ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY`）。
 * 刷新页面就会撞上这一条，所以进站第一句是「我是谁」，没人才开号。
 */

import type { Platform } from '@ai-duel/platform'
import { z } from 'zod'
import { sessionUrl, signInAnonymousUrl, tokenUrl } from '../net/endpoints'

/**
 * 账号这一层现在处于什么状态。
 *
 * `'signing-in'` 包含「还没开始问」和「问到一半」两种：对界面来说都是「还不能联机」，
 * 分开只会让每个调用方多判一次。
 */
type AuthStatus = 'signing-in' | 'ready' | 'failed'

export interface AuthState {
  status: AuthStatus
  /** 账号 id，就是座位、匹配、重连认人用的那个。开号成功前是 null。 */
  userId: string | null
  /** 给人看的名字，「游客 3f2a」这种。开号成功前是 null。 */
  name: string | null
  /** 失败原因，可以直接显示。`status` 不是 `'failed'` 时是 null。 */
  error: string | null
}

export interface AuthSession {
  /** 配 React 的 useSyncExternalStore 用（见 auth/useSession.ts）。 */
  subscribe(listener: () => void): () => void
  /** 状态没变时必须返回同一个对象引用，否则界面会一直重渲染。 */
  getSnapshot(): AuthState
  /**
   * 现换一张握手用的 JWT。`serverDriver` 和 `lobbyClient` 每次（重）连都会调它。
   *
   * 没开号就先开号。失败时抛错——调用方是 partysocket 的子协议提供函数，
   * 它自己会退避重试，这一层不再另加循环。
   */
  token(): Promise<string>
  /** 失败之后重来一次。界面上那颗「重试」钮调它。 */
  retry(): void
}

export interface AuthSessionOptions {
  platform: Platform
  /**
   * 服务端的 http(s) 源。不给就用当前页面的 origin——前端和服务端同源是这套部署的前提
   *（本地开发由 Vite 代理伪装成同源，见 net/endpoints.ts）。测试必须传，node 里没有 window。
   */
  origin?: string
}

/** `/api/auth/get-session` 的答复。没登录过时整个是 `null`，所以外面那层是 nullable。 */
const sessionSchema = z
  .object({ user: z.object({ id: z.string().min(1) }) })
  .nullable()
  .catch(null)

/** `/api/auth/sign-in/anonymous` 的答复。 */
const signInSchema = z.object({ user: z.object({ id: z.string().min(1) }) })

/** `/api/auth/token` 的答复。 */
const tokenSchema = z.object({ token: z.string().min(1) })

/**
 * 账号 id 变成给人看的名字。
 *
 * 只取末尾四位：better-auth 的 id 是一串三十多位的随机字符，整串念不出来也记不住，
 * 而这个名字唯一的用处是「让两台机器上的人确认自己不是同一个号」，四位够分辨了。
 * 不用 better-auth `user` 表里那个 `name`——游客登录时它一律是字面量 `'Anonymous'`
 *（`anonymous` 插件的 `generateName` 没配就是这个值），四个人在房里全叫同一个名字。
 */
function nameOf(userId: string): string {
  return `游客 ${userId.slice(-4)}`
}

/**
 * 一次请求失败就再试一次，第二次还失败才认输。
 *
 * 只重一次不是随便定的：这几条请求都在**进站的头一秒**发生，玩家正对着一块空屏等，
 * 退避重试三五轮的话他等的是十几秒的白屏；而真正常见的那种失败（开发服务器刚起来、
 * 网络刚连上）第二次就好了。剩下的（服务端没起、密钥没配）重多少次都一样，
 * 不如早点把错误摆到界面上。
 */
async function twice<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch {
    return await run()
  }
}

/** 把任何抛出来的东西变成一句能显示的中文。 */
function messageOf(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return `连不上账号服务（${detail}）`
}

export function createAuthSession(options: AuthSessionOptions): AuthSession {
  const { network } = options.platform
  const origin = options.origin ?? window.location.origin
  const listeners = new Set<() => void>()

  let state: AuthState = { status: 'signing-in', userId: null, name: null, error: null }

  function patch(next: Partial<AuthState>): void {
    state = { ...state, ...next }
    for (const listener of [...listeners]) listener()
  }

  /**
   * 「这台机器上有账号了」这件事只做一次，做好之后一直复用同一个 Promise。
   *
   * 存 Promise 而不是存布尔：大厅和房间两条连接会几乎同时来要 token，
   * 存布尔的话第二条会看到「还没好」而再开一个号——同一个人于是有了两个账号，
   * 重连时拿的还是另一个号的 token，服务端认不出他是原来那个座位。
   * 失败时清回 null，`retry()` 才有得重来。
   */
  let account: Promise<string> | null = null

  async function readAccount(): Promise<string | null> {
    const raw = await network.requestJson<unknown>(sessionUrl(origin))
    return sessionSchema.parse(raw)?.user.id ?? null
  }

  async function openAccount(): Promise<string> {
    try {
      const raw = await network.requestJson<unknown>(signInAnonymousUrl(origin), {
        method: 'POST',
        // better-auth 认 JSON 体；游客登录不需要任何字段，但空体它不收。
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      return signInSchema.parse(raw).user.id
    } catch (cause) {
      /*
       * 开号失败的头号原因是「已经有号了」：better-auth 不许游客重复开号（回 400）。
       * 两个人会撞上它——开发构建下 StrictMode 把整棵树挂两遍，两份会同时问「我是谁」、
       * 同时得到「没有」、同时去开号，第二份必然被 400 挡回来。
       * 这时会话其实已经好了，再问一句就有答案，所以不当失败。
       */
      const existing = await readAccount()
      if (existing !== null) return existing
      throw cause
    }
  }

  function ensureAccount(): Promise<string> {
    if (account !== null) return account
    const pending = twice(async () => (await readAccount()) ?? (await openAccount()))
    account = pending
    pending.then(
      (userId) => patch({ status: 'ready', userId, name: nameOf(userId), error: null }),
      (cause: unknown) => {
        // 清掉才重试得了。清之前先确认还是自己这一次——retry() 已经换过一轮的话，
        // 把新的那个 Promise 清掉会让界面永远停在「登录中」。
        if (account === pending) account = null
        patch({ status: 'failed', error: messageOf(cause) })
      },
    )
    return pending
  }

  // 进站就开号：房间页要拿账号 id 显示「游客 xxxx」，等玩家点了「匹配」再开就晚了。
  void ensureAccount()

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    getSnapshot: () => state,

    async token() {
      await ensureAccount()
      const raw = await twice(() => network.requestJson<unknown>(tokenUrl(origin)))
      return tokenSchema.parse(raw).token
    },

    retry() {
      if (account !== null) return
      patch({ status: 'signing-in', error: null })
      void ensureAccount()
    },
  }
}
