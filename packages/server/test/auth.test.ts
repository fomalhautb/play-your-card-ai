/**
 * 账号与握手鉴权（迁移第 25 条）：better-auth 的游客登录、换 JWT，
 * 以及房间和大厅那道验签门到底挡不挡得住伪造的 token。
 *
 * 正例只有一条路——真的调 `/api/auth/*` 拿 token，和客户端将来干的事一模一样。
 * 反例全部是拿真 kid 或真密钥去改的（见 accounts.ts），不是随手编一串乱码：
 * 编乱码的那种连解析都过不了，验不出验签这一步到底有没有把关。
 */

import { SELF } from 'cloudflare:test'
import { CLOSE_UNAUTHORIZED } from '@ai-duel/protocol'
import { describe, expect, it } from 'vitest'
import {
  AUTH_BASE,
  accountId,
  expiredToken,
  forgedToken,
  oversizedSubjectToken,
  rotateSigningKey,
  symmetricToken,
  tamperedToken,
  tokenFor,
  unsecuredToken,
} from './accounts'
import { Client, HELLO, setupRoom } from './helpers'

/** 带这张 token 连大厅，断言进不去：reason 和关闭码两样都要（同 handshake.test.ts）。 */
async function expectRejected(token: string): Promise<void> {
  const client = await Client.connectLobby(token)
  expect((await client.expect('session:rejected')).reason).toBe('unauthorized')
  expect((await client.waitClosed()).code).toBe(CLOSE_UNAUTHORIZED)
}

describe('游客登录', () => {
  it('登录换出来的 JWT 连大厅，welcome 里就是这个账号', async () => {
    const client = await Client.connectLobby(await tokenFor('guest-lobby'))
    client.send(HELLO)
    const welcome = await client.expect('session:welcome')
    expect(welcome.userId).toBe(await accountId('guest-lobby'))
    expect(welcome.place).toEqual({ kind: 'lobby' })
    client.close()
  })

  it('同一个账号连房间，座位按建房名单分', async () => {
    await setupRoom('5000', ['guest-room', 'guest-peer'])
    const client = await Client.connect('5000', await tokenFor('guest-room'))
    client.send(HELLO)
    const welcome = await client.expect('session:welcome')
    expect(welcome.userId).toBe(await accountId('guest-room'))
    expect(welcome.place).toEqual({ kind: 'room', code: '5000', seat: 0 })
    client.close()
  })

  it('没有会话就换不到 JWT', async () => {
    const anonymous = await SELF.fetch(`${AUTH_BASE}/token`)
    expect(anonymous.ok).toBe(false)
  })

  it('公钥集只发公钥，私钥留在库里', async () => {
    const response = await SELF.fetch(`${AUTH_BASE}/jwks`)
    const { keys } = (await response.json()) as { keys: Record<string, unknown>[] }
    expect(keys.length).toBeGreaterThan(0)
    const key = keys[0]!
    expect(key.alg).toBe('EdDSA')
    expect(key.crv).toBe('Ed25519')
    // `d` 是 OKP 私钥那一半。它要是漏出来，谁都能签一张能用的 token。
    expect(key.d).toBeUndefined()
  })
})

describe('伪造的 token 一律进不去', () => {
  it('拿外来私钥签、kid 写成真的那个', async () => {
    await expectRejected(await forgedToken('forge'))
  })

  it('换成对称算法签（拿公钥当共享密钥那种绕过）', async () => {
    await expectRejected(await symmetricToken('symmetric'))
  })

  it('alg: none，根本没签名', async () => {
    await expectRejected(await unsecuredToken('unsecured'))
  })

  it('把真 token 的 sub 改成别人，签名原样留着', async () => {
    await expectRejected(await tamperedToken('victim', 'thief'))
  })

  it('真密钥签的，但已经过期', async () => {
    await expectRejected(await expiredToken('stale'))
  })

  it('真密钥签的，但 sub 长得离谱', async () => {
    // 超长的 sub 会原样进 `session:welcome`，而那条消息在客户端要过 schema，
    // 长了整条作废——所以在门口就拒掉（见 src/auth/verify.ts 的长度上限）。
    await expectRejected(await oversizedSubjectToken())
  })
})

/**
 * 这一段必须放在文件最后。
 *
 * `rotateSigningKey` 把密钥换掉，服务端内存里那份公钥集缓存跟着变；
 * 而这个 pool 每条用例跑完会把 D1 回滚回去，缓存却回滚不了。
 * 所以换过密钥之后，同一个文件里再跑别的用例就可能拿着「已经不认识」的 token。
 */
describe('换密钥（放在最后）', () => {
  it('新密钥签的进得来，旧密钥签的立刻失效', async () => {
    const stale = await tokenFor('rotate-before')
    await rotateSigningKey()
    const fresh = await tokenFor('rotate-after')

    // 缓存里没有新 kid，服务端应该自己回 D1 再读一次，而不是把新密钥挡在外面。
    const ok = await Client.connectLobby(fresh)
    ok.send(HELLO)
    await ok.expect('session:welcome')
    ok.close()

    // 旧密钥已经不在库里了，缓存也不该让它续命。
    await expectRejected(stale)
  })
})
