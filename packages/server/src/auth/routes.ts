import { AUTH_BASE_PATH, createAuth } from './betterAuth'

/**
 * `/api/auth/*` 这一段全部原样交给 better-auth。
 *
 * 它自己认得游客登录、拿会话、换 JWT、公钥集这些路由，我们不在外面再抄一层路由表——
 * 抄一层的下场是每次升级 better-auth 都要跟着补路径。
 *
 * 形状和旧转发器的 `handleLegacyRequest` 一样：不是自己的路径返回 null 交给上层，
 * 这样总路由那边只是一串 `if`，谁先谁后一眼能看出来。
 */
export async function handleAuthRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  // 只认前缀完全对上的，`/api/authxxx` 这种不算。
  if (url.pathname !== AUTH_BASE_PATH && !url.pathname.startsWith(`${AUTH_BASE_PATH}/`)) {
    return null
  }
  return createAuth(env, url.origin).handler(request)
}
