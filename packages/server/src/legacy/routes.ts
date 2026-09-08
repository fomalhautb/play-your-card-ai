import { customAlphabet } from 'nanoid'

/**
 * 黑客松那版转发器的两条 HTTP 路由，**已冻结**（为什么还留着见同目录的 room.ts）。
 *
 * 一个容易踩的坑：compatibility_date >= 2025-04-01 之后，**导航请求**
 * （浏览器地址栏跳转，带 `Sec-Fetch-Mode: navigate` 头）根本不会调用 Worker 脚本，
 * 直接由静态资源层处理（Cloudflare 这么做是为了少算一次计费调用）。
 * WebSocket 升级请求不是导航请求，所以不受这条影响。
 * 例外是 wrangler.jsonc 的 assets.run_worker_first 里列出来的路径——
 * 那些路径无论如何都进 Worker，包括导航请求，所以 /room/:code 要给页面请求留兜底。
 */

/**
 * 4 位数字房间码。用 nanoid 而不是自己拿 crypto.getRandomValues 取模，
 * 是因为取模会让靠前的数字概率略高，而 nanoid 已经处理好了这件事。
 */
const newRoomCode = customAlphabet('0123456789', 4)

/**
 * `/api/room` 的跨域头，纯粹是为了本地开发。
 *
 * 本地是两个进程、两个 origin（Vite 在 5173，`wrangler dev` 在 8787），
 * 没有这个头浏览器会把 `/api/room` 的响应拦下来，前端拿不到房间码。
 * 线上前端和 Worker 同域，用不上它，但留着也没有坏处。
 *
 * 用 `*` 而不是白名单：这个接口是公开的、不带凭据，返回的只有一个房间码。
 * 不用处理 OPTIONS 预检——它是没有自定义头的 GET，属于简单请求。
 * WebSocket 升级不受 CORS 约束，所以只有这个 fetch 接口需要。
 */
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' }

/** 摇一个没人用的房间码。 */
async function createRoom(env: Env): Promise<Response> {
  // 四位码只有一万种，撞号是正常情况，撞到就重摇。
  // 但重摇次数要有上限：Worker 里的死循环会一直烧 CPU 时间。
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = newRoomCode()
    if ((await env.ROOM.getByName(code).occupancy()) === 0) {
      return Response.json({ code }, { headers: CORS_HEADERS })
    }
  }
  return Response.json(
    { error: '房间码摇不出来了，请稍后再试' },
    { status: 503, headers: CORS_HEADERS },
  )
}

/**
 * 旧转发器认得的路径就地处理掉，不认得的返回 null 交给上层。
 *
 * 返回 null 而不是自己兜底回静态资源：兜底是总路由那一层的事，
 * 新路径（/match/*）也要从这儿过，被这里吃掉就永远轮不到新代码。
 */
export async function handleLegacyRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)

  if (url.pathname === '/api/room') return createRoom(env)

  const roomPath = /^\/room\/(\d{4})\/?$/.exec(url.pathname)
  const isUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
  if (roomPath && isUpgrade) {
    // 房间码就是 Durable Object 的名字，同一个码永远路由到同一个实例。
    // getByName 是新 API，取代了老的 idFromName + get 两步写法。
    return env.ROOM.getByName(roomPath[1]!).fetch(request)
  }

  return null
}
