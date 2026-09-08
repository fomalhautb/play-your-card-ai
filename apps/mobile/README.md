# @ai-duel/mobile

iOS 和 Android 的 Capacitor 壳，**现在只是占位**，里面什么都没有。

迁移第 36 条才接入：Capacitor 套系统 WebView 跑 `apps/web` 的同一份网页构建，
出 iOS 和 Android 包，同时给 `packages/platform` 补 capacitor 实现。
见 `docs/正式版架构.md` 第 8 节。

注意第 1 节写明 Capacitor 是整套方案最弱的一环：iPhone 11 没问题，
2018 年中端安卓走 Chrome WebView 时性能余量最小，接进来之后要盯性能剧本。

壳里不写业务：入口挂 `@ai-duel/client` 的根组件，其余是构建配置。
