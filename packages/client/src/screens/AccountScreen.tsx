/**
 * 账号（`/account`）。首页菜单里「账号」那一项进来。
 *
 * 现在只有游客一种身份：进站自动开一个号，会话在 cookie 里，**换个浏览器就是另一个人**
 *（见 auth/session.ts）。所以这一页能说的只有三件事：你是谁、这个号的 id、以及登出。
 * 绑定账号（Steam）是第 35 条，这里先摆一句占位说明——把入口藏起来的话，
 * 玩家只会以为这个版本没打算做账号。
 *
 * ## 登出为什么要刷新整页
 *
 * 登出就是让服务端把会话 cookie 清掉（`POST /api/auth/sign-out`）。清掉之后，
 * 内存里那份 `AuthSession` 手上还攥着旧账号的 id 和那个已经 resolve 的 Promise，
 * 而它是挂在 Router 外面、整个应用一份的（见 auth/useSession.tsx），没有「重来一次」的口子。
 * 与其给它加一条只有这里会走的重置路径，不如**整页重载**：一次 `location.reload()`
 * 之后所有状态都是新的，`AuthProvider` 会照常再开一个游客号。
 * 代价是屏幕会白一下，而登出本来就是低频操作。
 */

import { Button, Dialog, Notice, Page } from '@ai-duel/ui'
import { useState } from 'react'
import { useLocation } from 'wouter'
import { usePlatform } from '../app/platform'
import { useSession } from '../auth/useSession'
import { signOutUrl } from '../net/endpoints'
import './accountScreen.css'

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
        <dd>{session.status === 'ready' ? '游客' : '还没登录'}</dd>
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
        绑定账号还没做好（那是 Steam 那一步的事）。在那之前，进度只留在这台机器的这个浏览器里
        ——换浏览器、清网站数据，都会变成一个新号。
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
        登出之后这台机器会开一个新的游客号，现在这个号的进度就找不回来了。
      </Dialog>
    </Page>
  )
}
