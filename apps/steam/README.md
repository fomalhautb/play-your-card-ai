# @ai-duel/steam

Steam 版（Windows 和 macOS）的 Electron 壳，**现在只是占位**，里面什么都没有。

迁移第 35 条才接入：Electron 打包、steamworks.js、Steam 登录走 session ticket，
同时给 `packages/platform` 补 electron 实现。见 `docs/正式版架构.md` 第 8 节。

选 Electron 的原因是它自带 Chromium——Steam 上只有一种渲染引擎，
不用管各家浏览器的差异（见第 1 节的选型表）。

壳里不写业务：入口挂 `@ai-duel/client` 的根组件，其余是构建配置。
