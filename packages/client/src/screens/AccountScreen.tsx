/**
 * 账号（`/account`）。首页菜单里「账号」那一项进来。
 *
 * 身份有两种，走哪一种由壳决定（见 auth/session.ts）：
 * - **游客**：进站自动开一个号，会话在 cookie 里，**换个浏览器就是另一个人**；
 * - **Steam**：Steam 壳里用会话票据登录，换台电脑进度还在。
 *
 * 所以这一页说四件事：你是哪一种身份、叫什么、这个号的 id、以及登出。
 * 「把游客攒的进度接到正式账号上」还没做——现在进度存在本机，换号不会丢，
 * 但也不会跟着人走。这句话摆在明面上，藏起来的话玩家只会以为这个版本没打算做账号。
 *
 * ## 登出为什么要刷新整页
 *
 * 登出就是让服务端把会话 cookie 清掉（`POST /api/auth/sign-out`）。清掉之后，
 * 内存里那份 `AuthSession` 手上还攥着旧账号的 id 和那个已经 resolve 的 Promise，
 * 而它是挂在 Router 外面、整个应用一份的（见 auth/useSession.tsx），没有「重来一次」的口子。
 * 与其给它加一条只有这里会走的重置路径，不如**整页重载**：一次 `location.reload()`
 * 之后所有状态都是新的，`AuthProvider` 会照常再登一次——网页上是开一个新的游客号，
 * Steam 壳里是拿票据登回同一个号。代价是屏幕会白一下，而登出本来就是低频操作。
 */

import { Button, Dialog, Notice, Page } from '@ai-duel/ui'
import { useState } from 'react'
import { useLocation } from 'wouter'
import { usePlatform } from '../app/platform'
import { useSession } from '../auth/useSession'
import { signOutUrl } from '../net/endpoints'
import './accountScreen.css'

/** 两种身份在界面上的说法。「游客」这个词是旧版就在用的，别改成「匿名」。 */
const PROVIDER_LABEL = { guest: '游客', steam: 'Steam' } as const

export function AccountScreen() {
  const platform = usePlatform()
  const [, navigate] = useLocation()
  const session = useSession()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signOut = async (): Promise<void> => {
    setConfirming(false)
    setError(null)
    try {
      await platform.network.requestJson<unknown>(signOutUrl(window.location.origin), {
        method: 'POST',
        // better-auth 认 JSON 体；登出不需要任何字段，但空体它不收（同 sign-in/anonymous）。
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      window.location.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <Page title="账号" onBack={() => navigate('/')}>
      <dl className="account__facts">
        <dt>身份</dt>
        <dd>{session.status === 'ready' ? PROVIDER_LABEL[session.provider] : '还没登录'}</dd>
        <dt>名字</dt>
        <dd>{session.name ?? '—'}</dd>
        <dt>账号 id</dt>
        {/*
          id 是一串三十多位的随机字符，`word-break` 让它在窄屏上断得开
          （见 accountScreen.css）。摆出来是为了报障时对得上——玩家看不懂它，但我们看得懂。
        */}
        <dd className="account__id">{session.userId ?? '—'}</dd>
      </dl>

      {session.status === 'failed' && session.error !== null ? (
        <Notice>{session.error}</Notice>
      ) : null}

      <Notice tone="info">
        {session.provider === 'steam'
          ? '这个号跟着你的 Steam 账号走，换台电脑登同一个 Steam 还是它。进度目前存在本机，暂时不跟着账号走。'
          : '绑定账号还没做好。在那之前，进度只留在这台机器的这个浏览器里——换浏览器、清网站数据，都会变成一个新号。'}
      </Notice>

      <div className="account__actions">
        <Button disabled={session.status !== 'ready'} onClick={() => setConfirming(true)}>
          登出
        </Button>
      </div>

      {error === null ? null : <Notice>{`登出失败：${error}`}</Notice>}

      <Dialog
        open={confirming}
        title="登出"
        confirm={{ label: '确定登出', onSelect: () => void signOut() }}
        cancel={{ label: '再想想', onSelect: () => setConfirming(false) }}
        onDismiss={() => setConfirming(false)}
      >
        {session.provider === 'steam'
          ? '登出之后会立刻用这台机器上的 Steam 账号重新登进来——也就是说，除了断开重连一次，什么都不会变。'
          : '登出之后这台机器会开一个新的游客号，现在这个号的进度就找不回来了。'}
      </Dialog>
    </Page>
  )
}
