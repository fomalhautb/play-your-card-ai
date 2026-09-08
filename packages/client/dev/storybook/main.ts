/**
 * 组件目录页的 Storybook 配置（《正式版架构》7.1 第 3 条）。
 *
 * 放在 `client/dev` 下而不是仓库根：7.2 第 5 条规定开发专用页面都归这里，生产构建剔除。
 * 剔除靠的是「没人 import」——`apps/web` 的入口只到 `client/src`，
 * 这一整个 `dev/storybook` 目录不在任何一条 import 链上，打包器根本看不到它。
 *
 * 构建器选 react-vite：目录页里的 React 组件本来就跑在 Vite 上（apps/web 是 Vite），
 * 两边同一套解析规则和插件，story 里能直接 import workspace 包的源码。
 *
 * story 文件跟着组件走，不集中放：`canvas` 的在 canvas 包里，`ui` 的在 ui 包里。
 * 集中放的话新增组件要改两个地方，而 7.1 第 3 条要求「每个组件必须有目录页条目」——
 * 条目和组件挨着，漏了一眼就看得出来。
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from '@storybook/react-vite'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 仓库根：本文件在 packages/client/dev/storybook 下，往上四层。 */
const REPO_ROOT = resolve(HERE, '../../../..')

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../../../canvas/src/**/*.stories.@(ts|tsx)', '../../../ui/src/**/*.stories.@(ts|tsx)'],
  /*
   * 把 web 壳的 public 原样当静态根：卡面图集在 `apps/web/public/atlas/` 下
   * （`pnpm assets:build` 的产物，进了 .gitignore），story 里的加载路径因此和开发页
   * 完全一样是 `/atlas/xxx.json`——两边共用 src/dev/cardAtlas.ts 那一份加载代码。
   */
  staticDirs: [resolve(REPO_ROOT, 'apps/web/public')],
  addons: [],
  // 目录页是本地和 CI 里跑的检查工具，不给 Storybook 上报使用数据。
  core: { disableTelemetry: true },
  viteFinal(viteConfig) {
    /*
     * story 文件在 packages/canvas 和 packages/ui 下，而 Vite 的根是 packages/client。
     * Vite 默认只允许伺服根目录以内的文件，所以显式把仓库根加进白名单。
     * （Vite 自己也会探测 pnpm workspace 根，这里写死一份是为了不依赖那个探测。）
     */
    viteConfig.server ??= {}
    viteConfig.server.fs ??= {}
    viteConfig.server.fs.allow = [...(viteConfig.server.fs.allow ?? []), REPO_ROOT]
    return viteConfig
  },
}

export default config
