# 美术和音频资源

## 目录

```
assets/
  source/          全部原始素材（原画、界面底图、音频、站点图标），唯一的源
  build-atlas.mjs  `pnpm assets:build`：打卡面图集、分发产物
  atlas.config.mjs 图集打包配置（AssetPack）
  dist/            build-atlas 的本地产物，不进 git
```

首页和房间页从前各有一批界面底图（`source/home/` 四张、`source/room/` 十四张切片，
外加切片的来源 `room-ui-sheet.png` 和切图脚本 `slice-room-ui.py`）。
正式版简化第 4 步把这两页剥成了画布上的素方块，那批图一张都没人引用，整批删掉了。

`source/` 下按用途分目录：

| 目录 | 内容 | 谁在用 |
|---|---|---|
| `cards/` | 卡面原画（`models/`、`skills/`）和两张共用牌背（`card-back-*.webp`） | 全部打进图集 |
| `hero/` | 七张英雄牌 + 选英雄页底图 | 直接当图用（英雄牌不进图集） |
| `info/` `battle/` | 关于页和对局场地的界面底图 | 直接当图用 |
| `music/` | 四首循环 BGM + 三段音效，都是 m4a（AAC） | 客户端按 `/audio/music/<名字>.m4a` 取 |
| `favicon.svg` `icon*.png` `icon.svg` `manifest.webmanifest` | 「添加到主屏幕」那一套 | **暂时没人用**，见下 |

站点图标那一套现在没有任何构建步骤会碰它：网页壳（`apps/web`）的 `index.html` 还没挂
favicon 和 manifest，`assets:build` 也没把它们复制进产物。留着是因为图还在、重画一套不值当，
真要给网页壳补「添加到主屏幕」时直接拿这几个文件用，顺手把 `build-atlas.mjs` 的 `COPIES` 补一条。

新增音频请先用 ffmpeg 转成 AAC（`.m4a`）再放进来。新增图片请先转成 webp。

## 两个目录的关系

- **`assets/source/`**：源。改图改音频只改这里。
- **`apps/web/public/`**：**全是 `pnpm assets:build` 的产物**，除了 `.gitkeep` 一件手写的东西都没有，
  整批进 `.gitignore`。内容是卡面图集（`atlas/`）、界面底图（`battle/` `hero/` `info/`）
  和音频（`audio/music/`）。卡面原画不复制过来：卡一律从图集取纹理，
  复制一份等于同一张图有两个地址。
  Steam 壳和手机壳（`apps/steam`、`apps/mobile`）的 Vite 配置直接借用这个目录当 `publicDir`，
  所以三个壳共用同一批产物，不用各打一份。

## `pnpm assets:build` 做了什么

1. 把 `source/cards/{models,skills}` 的原画和两张 `card-back-*.webp` 缩到 512×768、
   把卡面圆角烤进 alpha，写进暂存目录；
2. AssetPack 打成 `models` / `skills` / `backs` 三张图集（webp）；
3. 图集复制到 `apps/web/public/atlas` 和 `packages/bench/public/atlas`；
4. 界面底图和音频原样复制到 `apps/web/public/` 下（音频落在 `audio/music/`）。

改了 `source/` 下的图或音频之后要重跑一遍，否则界面上看到的还是上一版。
