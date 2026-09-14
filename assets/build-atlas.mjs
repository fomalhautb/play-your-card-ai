/**
 * 打卡面图集：把 assets/source/ 下的原画缩到一档尺寸、打成 spritesheet、分发到各个壳的 public，
 * 顺带把音频原样复制过去。
 * 跑法：仓库根目录 `pnpm assets:build`。打包配置在同目录的 atlas.config.mjs。
 *
 * 三步（加最后一步音频）：
 * 1. 暂存：原画尺寸不齐（大多 1024×1536，有一张 1060×1484），先统一缩成 512×768，
 *    图集里每一帧的尺寸才是恒定的；同一步里把卡面圆角烤进 alpha（见 roundedMask）。
 *    缩放和圆角都交给 sharp，AssetPack 自己那套按比例缩的选项对付不了尺寸不齐的输入。
 *    暂存写的是 **png** 而不是 webp：AssetPack 的 texturePacker 只收 jpg / png / gif，
 *    喂 webp 给它会安静地打出一张空图集（它对不认识的扩展名不报错，直接当没有文件）。
 *    最终产物仍然是 webp——那一步由打包配置里的 compress 完成。
 * 2. 打包：AssetPack 按 `{tps}` 标记分组打图集（models / skills / backs 各一组）。
 * 3. 分发：产物复制到 apps/web 和 packages/bench 的 public 下。
 *    两处都进 .gitignore——图集是构建产物，源头是 assets/source/cards 下那些原画。
 * 4. 音频：assets/source/music 原样复制到 apps/web/public/audio/music。
 *    音频不需要任何转换（源文件已经是 AAC/m4a），这一步只是「把源搬成产物」，
 *    好让 apps/web/public 下一件手写的东西都没有，整个目录都能进 .gitignore。
 *
 * 输入是 `assets/source/`，是全部美术和音频的唯一源头（见那个目录下的 README）。
 */

import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AssetPack } from '@assetpack/core'
import sharp from 'sharp'
import { atlasConfig, FRAME_HEIGHT, FRAME_RADIUS, FRAME_WIDTH } from './atlas.config.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const sourceDir = join(here, 'source')
const cards = join(sourceDir, 'cards')

const distDir = join(here, 'dist')
const stagingDir = join(distDir, 'staging')
const atlasDir = join(distDir, 'atlas')

/**
 * 每一组图集的来源。目录名末尾的 `{tps}` 是 AssetPack 的标记，意思是"这个目录打成一张图集"。
 * 组名（去掉标记之后的部分）就是加载时用的图集名，比如 `atlas/models.webp.json`。
 */
const SOURCES = [
  { group: 'models{tps}', from: join(cards, 'models'), pick: () => true },
  { group: 'skills{tps}', from: join(cards, 'skills'), pick: () => true },
  // 牌背和卡面原画不在同一个目录：models/ 和 skills/ 是按卡牌 id 命名的一张一张卡，
  // 牌背是整副牌共用的两张，直接躺在 cards/ 底下，所以要按前缀挑出来。
  { group: 'backs{tps}', from: cards, pick: (name) => name.startsWith('card-back-') },
]

/** 复制产物的去处。目录可能还不存在（bench 刚建骨架），所以要能自己建。 */
const TARGETS = [
  join(repoRoot, 'apps/web/public/atlas'),
  join(repoRoot, 'packages/bench/public/atlas'),
]

/**
 * 原样复制到网页壳 public 下的目录：`assets/source/<from>` → `apps/web/public/<to>`。
 *
 * 这几类不进图集，各有各的理由：
 * - 界面底图（首页、房间、对局场地、英雄）是整幅大图，一张一用，打进图集只会浪费图集页；
 *   英雄牌也在里面（`hero/card-<英雄 id>.webp`），它不进牌组、场上也不摆，用不着图集那条路。
 * - 音频不是图。目录名换成 `audio/music` 是为了给以后可能拆出来的音效留个 `audio/` 前缀，
 *   客户端那边按 `/audio/music/<名字>.m4a` 取（见 client 的 audio/music.ts）。
 *
 * 卡面（`cards/`）刻意不在这里：正式版的卡一律从图集取纹理，把原画也复制过去等于
 * 让同一张图有两个地址，改图时只换掉没人用的那份。
 */
const COPIES = [
  { from: 'battle', to: 'battle' },
  { from: 'hero', to: 'hero' },
  { from: 'info', to: 'info' },
  { from: 'music', to: 'audio/music' },
]

/**
 * 圆角遮罩：一整块白色的圆角矩形，用 dest-in 混合上去就只留下圆角以内的像素。
 *
 * 用 SVG 而不是自己拼像素，是因为 sharp 会用 librsvg 把它抗锯齿地栅格化，
 * 圆弧边缘自带半透明过渡；手写像素就得自己做抗锯齿，边上会有台阶。
 * 每张图都用同一块 Buffer，不用每张重新生成——所有帧的尺寸和半径都一样。
 */
const roundedMask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}">` +
    `<rect width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" rx="${FRAME_RADIUS}" ry="${FRAME_RADIUS}" fill="#fff"/>` +
    `</svg>`,
)

async function stage() {
  await rm(distDir, { recursive: true, force: true })
  let count = 0
  for (const source of SOURCES) {
    const outDir = join(stagingDir, source.group)
    await mkdir(outDir, { recursive: true })
    const files = (await readdir(source.from)).filter(
      (name) => name.endsWith('.webp') && source.pick(name),
    )
    for (const name of files) {
      await sharp(join(source.from, name))
        // cover：原画基本都是 2:3，尺寸不齐的那张会被裁掉边上一点，不会被拉变形。
        .resize(FRAME_WIDTH, FRAME_HEIGHT, { fit: 'cover', position: 'centre' })
        // 原画是不透明的 webp，先给它一条 alpha 通道，下面那步才有东西可扣。
        .ensureAlpha()
        // 圆角烤进 alpha：运行期就不用遮罩也不用 Filter 去切卡角了（纪律 3.1）。
        .composite([{ input: roundedMask, blend: 'dest-in' }])
        .png()
        .toFile(join(outDir, name.replace(/\.webp$/, '.png')))
      count += 1
    }
  }
  return count
}

async function main() {
  const staged = await stage()
  console.log(`暂存完成：${staged} 张原画缩到 ${FRAME_WIDTH}×${FRAME_HEIGHT}`)

  const pack = new AssetPack(atlasConfig(stagingDir, atlasDir))
  await pack.run()
  console.log(`图集打包完成：${atlasDir}`)

  for (const target of TARGETS) {
    await rm(target, { recursive: true, force: true })
    await mkdir(dirname(target), { recursive: true })
    await cp(atlasDir, target, { recursive: true })
    console.log(`已复制到 ${target}`)
  }

  await copyRaw()

  // 暂存目录是中间产物，留着只会让人以为它也是要提交的东西。
  await rm(stagingDir, { recursive: true, force: true })
}

/**
 * 把 COPIES 里那几个目录原样复制到 apps/web/public 下。
 *
 * 每次先整个删掉再复制：源目录里删掉一张图之后，产物里那一份不会自己消失，
 * 而客户端的清单测试查的是源目录，谁也不会发现产物里还留着一张没人要的图。
 */
async function copyRaw() {
  for (const { from, to } of COPIES) {
    const target = join(repoRoot, 'apps/web/public', to)
    await rm(target, { recursive: true, force: true })
    await mkdir(dirname(target), { recursive: true })
    await cp(join(sourceDir, from), target, { recursive: true })
    console.log(`已复制到 ${target}`)
  }
}

await main()
