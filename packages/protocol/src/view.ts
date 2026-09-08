/**
 * 裁剪视图在电线上的两种形态：带目录的完整视图，和不带目录的事件批视图。
 *
 * `PlayerView` 里带着整个公开卡池（`catalog`，见 core 的 `Catalog`），而卡池就是那份视图的绝大部分：
 * 按现在的 42 张卡 + 7 个英雄量一下，一份视图 JSON 约 10.5 KB，其中 9.6 KB 是卡池，
 * 剩下的局面只有 0.9 KB（数字在 test/messages.test.ts 里有一条测试盯着，卡表越加差距越大）。
 * core 那边不动：视图自包含是有用的——服务端存局面、回放对局都靠状态里那份目录。
 * 但电线上每批事件都跟一份完整视图（为什么每批都带，见 room.ts 的 `matchEventsSchema`），
 * 一局几十批就是同一份卡池发了几十遍。所以拆分放在**协议这一层**：
 *
 * - `match:started` / `match:snapshot` 发完整 `PlayerView`，带目录。
 *   这两条本来就是「整份局面」，开局给一次、重连补一次。
 * - `match:events` 发 `ViewDelta`，不带目录。
 *
 * 服务端发之前过一道 `stripCatalog`，客户端收到之后用 `attachCatalog` 把开局拿到的那份接回去。
 * 客户端手上一定有一份目录可接：`match:started`（seq 从 1 起）必然排在任何 `match:events`
 * 前面，断线重连补的 `match:snapshot` 也带目录。
 *
 * ## 为什么不让客户端直接用自己打包的 content
 *
 * 因为房间用的是**开局那一刻的目录快照**：`createGame` 收下一份目录存进 `GameState.catalog`，
 * 之后引擎一律查状态里那份（见 core 的 `Catalog`）。平衡改动上线之后，
 * 已经开着的房间照旧按老数值算完这一局——这正是把目录塞进状态的目的之一。
 *
 * 客户端打包的 content 是它自己那个版本的，和房间冻住的那份未必一样：
 * 玩家可能刚加载了带新数值的版本，也可能挂着一个没刷新的旧页面。
 * 拿本地那份去渲染就会出现「界面写着 3 费、服务端按 4 费扣」这种对不上。
 * 所以卡面数据一律以服务端发来的这份为准，一个字段都别从本地内容表里补。
 */

import type { Catalog, PlayerView } from '@ai-duel/core'
import { z } from 'zod'

/**
 * 判断一个值是不是一份裁剪视图。**故意只做形状粗筛，不逐字段校验。**
 *
 * 视图是服务端 `viewFor` 算出来的，只往客户端一个方向走，客户端不需要防着自己的服务端
 *（真正的信任边界在反方向的指令上，那条在 command.ts 里手写了完整 schema）。
 *
 * 粗筛认 `viewer` 而不是别的字段：那是「这份视图是给谁看的」，客户端拿它对座位，
 * 缺了它整份视图没法用。
 */
const looksLikeView = (value: unknown): boolean =>
  typeof (value as { viewer?: unknown } | null)?.viewer === 'number'

/** 一份完整的裁剪视图，带目录。`match:started` 和 `match:snapshot` 用它。 */
export const playerViewSchema = z.custom<PlayerView>(looksLikeView, {
  message: '不是一份裁剪视图',
})

/**
 * 去掉目录之后的裁剪视图，`match:events` 里发的就是这个。
 *
 * 只少 `catalog` 一个字段，别的和 `PlayerView` 一模一样——写成 `Omit` 而不是另抄一份接口，
 * 是为了让 core 往视图里加字段时这边自动跟上，不会悄悄少发一样东西。
 */
export type ViewDelta = Omit<PlayerView, 'catalog'>

/**
 * 摘掉目录。服务端把 `match:events` 发出去之前过一道。
 *
 * 返回新对象，不改原视图：同一份 `viewFor` 的产物要发给日志、存档等好几个地方，
 * 就地 `delete` 会让后面拿到它的人少一份目录。
 */
export function stripCatalog(view: PlayerView): ViewDelta {
  const { catalog: _catalog, ...delta } = view
  return delta
}

/**
 * 把目录接回去。客户端收到 `match:events` 之后过一道，`catalog` 用
 * `match:started`（或最近一次 `match:snapshot`）里存下来的那一份。
 *
 * 接回去而不是让界面直接读 delta，是为了让视图在客户端里只有一种形状：
 * 界面代码一路拿到的都是完整 `PlayerView`，查卡面时不用先想「这份有没有目录」。
 */
export function attachCatalog(delta: ViewDelta, catalog: Catalog): PlayerView {
  return { ...delta, catalog }
}

/**
 * `match:events` 里那份视图的 schema。
 *
 * 带了 `catalog` 的视图**不拒收，只把目录丢掉**——这是下行那半边的一贯口径
 *（严松不对称，见 index.ts）：上行是不可信输入，多一个字段整条拒；
 * 下行来自自家服务端，多出来的字段悄悄丢掉，好让服务端能先上线带新字段的版本。
 * 拒收的代价也不对称：整条 `match:events` 作废会让客户端看到序号断档、
 * 白跑一趟 `room:resync`，而多带的目录本身除了浪费带宽并不会算错任何东西。
 *
 * 丢掉还顺手堵住一个坑：客户端拿到的 delta 上永远没有 `catalog`，
 * 就不会有人图省事直接把它当 `PlayerView` 用，而漏掉 `attachCatalog` 这一步。
 * 「服务端别把目录塞进事件批」由服务端发送前的 `stripCatalog` 和测试保证。
 */
export const viewDeltaSchema = z
  .custom<PlayerView>(looksLikeView, { message: '不是一份裁剪视图' })
  .transform(stripCatalog) satisfies z.ZodType<ViewDelta>
