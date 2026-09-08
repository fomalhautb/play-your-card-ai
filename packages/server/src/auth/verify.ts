import { jwtVerify } from 'jose'

/**
 * 验一张 WebSocket 握手里带上来的 JWT，认出这是哪个账号。
 *
 * 这是整个服务端唯一的身份来源：座位、能不能进房、指令算谁发的，全部从这里的返回值推出来
 * （《正式版架构》5.5）。客户端说自己是谁一律不算数。
 *
 * 本 PR（迁移第 22 条）先用 HS256 + 一个共享密钥自己签自己验，
 * 迁移第 25 条换成 better-auth 签发（大概率是非对称的），但**这个函数的签名不变**：
 * 房间对象只知道「给我 token，还我一个 userId 或者 null」，换签发方不用改房间的代码。
 */

/**
 * 账号 id 的长度上限，和 protocol 的 `welcomeSchema` 里那条 `.max()` 一样。
 *
 * 超长的 sub 在这里就当验不过：它会原样进 `session:welcome`，
 * 而那条消息在客户端是要过 schema 的，长了整条消息作废，玩家只会看到一个莫名其妙的失败。
 * 与其让错误跑到客户端才炸，不如在门口就拒掉。
 */
const USER_ID_MAX_LENGTH = 64

/** 验过之后确定下来的身份。眼下只有账号 id，第 25 条接了 better-auth 可能会多几样。 */
export interface Identity {
  userId: string
}

/**
 * 验签 + 解出账号 id。任何一处不对都返回 null，不抛异常也不区分原因。
 *
 * 不区分原因是有意的：过期、签名错、算法不对、少了 sub，对调用方来说都是「这个人进不来」，
 * 分开报只会给试探的人多一点信息。真要排查线上问题看日志，不看返回值。
 *
 * `algorithms` 一定要钉死：不限定的话，攻击者可以拿一张头部写着 `alg: none`
 * 或者换成别的算法的 token 来绕过验签。
 */
export async function verifyToken(token: string, env: Env): Promise<Identity | null> {
  const secret = env.JWT_SECRET
  if (!secret) return null
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    })
    const userId = payload.sub
    if (typeof userId !== 'string') return null
    if (userId.length === 0 || userId.length > USER_ID_MAX_LENGTH) return null
    return { userId }
  } catch {
    return null
  }
}
