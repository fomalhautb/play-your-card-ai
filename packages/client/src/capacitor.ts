/**
 * 手机壳专用的第二个入口：`@ai-duel/client/capacitor`。
 *
 * 整个文件只有下面那一行。单独开一个入口不是为了分类好看，是为了**包体**：
 * `createCapacitorPlatform()` 底下 import 了 `@capacitor/core`，那个包有副作用
 *（模块一加载就往 window 上挂东西），打包器摇不掉。它要是从 `src/index.ts` 转出去，
 * 网页壳和 Steam 壳的产物里就会白白多背一份用不到的 Capacitor 运行时
 * ——实测 `apps/web` 多 8.2 kB（gzip 后 3.1 kB）。
 * 分成两个入口之后，只有 import 了这一条的壳才会把它打进去。
 *
 * 为什么壳不直接 import `@ai-duel/platform/capacitor`：`apps/` 下的壳只许依赖 client
 *（见 .dependency-cruiser.cjs 的「依赖方向-apps-只挂-client」），
 *「建哪一套平台实现」这个选择要经过装配层的门（见 index.ts 的文件头）。
 * 这个文件就是那道门在手机壳那一侧的样子。
 *
 * 网页壳和 Steam 壳照旧走主入口，一个字都不用改。
 */
export type { CapacitorPlatformOptions } from '@ai-duel/platform/capacitor'
export { createCapacitorPlatform } from '@ai-duel/platform/capacitor'
