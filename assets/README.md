# 美术和音频资源

## 目录

```
assets/
  source/          全部原始素材（原画、界面底图、音频、站点图标），唯一的源
  build-atlas.mjs  `pnpm assets:build`：打卡面图集、分发产物
  atlas.config.mjs 图集打包配置（AssetPack）
  dist/            build-atlas 的本地产物，不进 git
```

`source/` 下按用途分目录：

| 目录 | 内容 | 谁在用 |
|---|---|---|
| `cards/` | 卡面原画（`models/`、`skills/`）和旧版用的两档缩图（`mid/`、`thumbs/`） | 正式版走图集；旧版直接铺 `mid/`、`thumbs/` |
| `hero/` | 七张英雄牌 + 选英雄页底图 | 两版都直接当图用（英雄牌不进图集） |
| `home/` `room/` `info/` `battle/` | 首页、房间页、关于页、对局场地的界面底图 | 两版都直接当图用 |
| `music/` | 四首循环 BGM + 七段音效，都是 m4a（AAC） | 两版 |
| `favicon.svg` `icon*.png` `icon.svg` `manifest.webmanifest` | 「添加到主屏幕」那一套 | 只有旧版；正式版的壳还没做这一套 |

新增音频请先用 ffmpeg 转成 AAC（`.m4a`）再放进来：旧版的背景音乐是 `preload='auto'`，
留着原始 MP3 等于每换一页多下一倍带宽。新增图片请先转成 webp。

## 三个 public 目录的关系

- **`assets/source/`**：源。改图改音频只改这里。
- **`packages/legacy-client/public`**：**指向 `assets/source` 的相对符号链接**。
  旧客户端仍是线上版本（`packages/server/wrangler.jsonc` 的静态资源指着它的 `dist`），
  素材搬走之后它的构建和 `test/assetManifest.test.ts` 还得照常跑，所以在原位置留一个链接接回去。
  Vite 复制 `public/` 和那份测试扫目录时都会跟着链接走到真实文件，两边都不用改代码。

  链接指的是 `public` 这一级，而不是它下面的每个目录：`readdirSync(..., {withFileTypes:true})`
  不跟链接走，`entry.isDirectory()` 对「指向目录的链接」返回 false，
  `assetManifest.test.ts` 的递归扫描会把这样的目录整个跳过。链在 `public` 这一级，
  扫描从第一层起看到的就全是真目录。
- **`apps/web/public/`**：**全是 `pnpm assets:build` 的产物**，除了 `.gitkeep` 一件手写的东西都没有，
  整批进 `.gitignore`。内容是卡面图集（`atlas/`）、界面底图（`battle/` `home/` `hero/` `info/` `room/`）
  和音频（`audio/music/`）。卡面原画不复制过来：正式版的卡一律从图集取纹理，
  复制一份等于同一张图有两个地址。

## `pnpm assets:build` 做了什么

1. 把 `source/cards/{models,skills,mid}` 的原画缩到 512×768、把卡面圆角烤进 alpha，写进暂存目录；
2. AssetPack 打成 `models` / `skills` / `backs` 三张图集（webp）；
3. 图集复制到 `apps/web/public/atlas` 和 `packages/bench/public/atlas`；
4. 界面底图和音频原样复制到 `apps/web/public/` 下（音频落在 `audio/music/`）。

改了 `source/` 下的图或音频之后要重跑一遍，否则正式版那边看到的还是上一版。
