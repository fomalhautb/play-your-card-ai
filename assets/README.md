# 美术和音频资源

## 目录

```
assets/
  source/          全部原始素材（原画、界面底图、音频、站点图标），唯一的源
  build-atlas.mjs  `pnpm assets:build`：打卡面图集、分发产物
  atlas.config.mjs 图集打包配置（AssetPack）
  dist/            build-atlas 的本地产物，不进 git
```

首页、房间页和对局页从前各有一批界面底图（`source/home/` 四张、`source/room/` 十四张切片，
外加切片的来源 `room-ui-sheet.png` 和切图脚本 `slice-room-ui.py`；`source/battle/` 六张——
战场底图、猜先的两张硬币、终局结算的三张底板）。
正式版简化第 4 步把这三页剥成了画布上的素方块，那些图一张都没人引用，整批删掉了。
之五又删了选英雄页那张背景底图（`source/hero/hero-bg.webp`），那一页现在只剩七张人物卡。
第 5 步收尾时又清掉两张没人引用的：关于页的背景底图（`source/info/info-bg.webp`，
整个 `info/` 目录跟着没了）和技能牌那张多出来的牌背（`cards/skills/skill-card-back.webp`——
技能牌翻面用的是 `cards/card-back-v1.webp`，那张从来没被引用过）。

`source/` 下按用途分目录：

| 目录 | 内容 | 谁在用 |
|---|---|---|
| `cards/` | 卡面原画（`models/`、`skills/`）和两张共用牌背（`card-back-*.webp`） | 全部打进图集 |
| `hero/` | 七张英雄牌 | 直接当图用，不进图集；复制时烤圆角（见下） |
| `music/` | 四首循环 BGM + 三段音效，都是 m4a（AAC） | 客户端按 `/audio/music/<名字>.m4a` 取 |
| `favicon.svg` `icon*.png` `icon.svg` `manifest.webmanifest` | 「添加到主屏幕」那一套 | **暂时没人用**，见下 |

站点图标那一套现在没有任何构建步骤会碰它：网页壳（`apps/web`）的 `index.html` 还没挂
favicon 和 manifest，`assets:build` 也没把它们复制进产物。留着是因为图还在、重画一套不值当，
真要给网页壳补「添加到主屏幕」时直接拿这几个文件用，顺手把 `build-atlas.mjs` 的 `COPIES` 补一条。

新增音频请先用 ffmpeg 转成 AAC（`.m4a`）再放进来。新增图片请先转成 webp。

## 两个目录的关系

- **`assets/source/`**：源。改图改音频只改这里。
- **`apps/web/public/`**：**全是 `pnpm assets:build` 的产物**，除了 `.gitkeep` 一件手写的东西都没有，
  整批进 `.gitignore`。内容是卡面图集（`atlas/`）、人物卡（`hero/`）和音频（`audio/music/`）。
  卡面原画不复制过来：卡一律从图集取纹理，
  复制一份等于同一张图有两个地址。
  Steam 壳和手机壳（`apps/steam`、`apps/mobile`）的 Vite 配置直接借用这个目录当 `publicDir`，
  所以三个壳共用同一批产物，不用各打一份。

## `pnpm assets:build` 做了什么

1. 把 `source/cards/{models,skills}` 的原画和两张 `card-back-*.webp` 缩到 512×768、
   把卡面圆角烤进 alpha，写进暂存目录；
2. AssetPack 打成 `models` / `skills` / `backs` 三张图集（webp）；
3. 图集复制到 `apps/web/public/atlas` 和 `packages/bench/public/atlas`；
4. 音频原样复制到 `apps/web/public/audio/music`；
   七张人物卡也复制过去，但**逐张把圆角烤进 alpha**（半径按卡宽的比例取，768 宽的原画
   烤 41，和图集那一档同一条规矩）——选英雄页把它整幅贴在一块透视网格上，运行期要圆角
   就只剩遮罩和 Filter 两条路，纪律 3.1 两条都不许。

改了 `source/` 下的图或音频之后要重跑一遍，否则界面上看到的还是上一版。
