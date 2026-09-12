/**
 * 端到端跑起来之前要就位的本地产物里，**浏览器那一样**：卡面图集。
 *
 * 它不进仓库，刚 clone 完的仓库里没有；少了它画面上一张牌都没有。
 * 这一份直接复用组件目录页的（它只认 apps/web/public/atlas）。
 *
 * 服务端要的那两样（`.dev.vars`、账号库的表）**不在这里**：Playwright 的
 * `globalSetup` 跑在 `webServer` **之后**，而那两样是服务端一启动就要用的。
 * 它们挂在服务端那条 `command` 的前半段，见 e2e/ensureServer.mjs。
 */

import ensureAtlas from '../dev/storybook/ensureAtlas'

export default function globalSetup(): void {
  ensureAtlas()
}
