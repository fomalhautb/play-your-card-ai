/**
 * 打卡面图集：把旧客户端 public/ 下的原画缩到一档尺寸、打成 spritesheet、分发到各个壳的 public。
 * 跑法：仓库根目录 `pnpm assets:build`。打包配置在同目录的 atlas.config.mjs。
 *
 * 三步：
 * 1. 暂存：原画尺寸不齐（大多 1024×1536，有一张 1060×1484），先统一缩成 512×768，
 *    图集里每一帧的尺寸才是恒定的。缩放交给 sharp，AssetPack 自己那套按比例缩的选项
 *    对付不了尺寸不齐的输入。
 *    暂存写的是 **png** 而不是 webp：AssetPack 的 texturePacker 只收 jpg / png / gif，
 *    喂 webp 给它会安静地打出一张空图集（它对不认识的扩展名不报错，直接当没有文件）。
 *    最终产物仍然是 webp——那一步由打包配置里的 compress 完成。
 * 2. 打包：AssetPack 按 `{tps}` 标记分组打图集（models / skills / backs 各一组）。
 * 3. 分发：产物复制到 apps/web 和 packages/bench 的 public 下。
 *    两处都进 .gitignore——图集是构建产物，源头是 public/cards 下那些原画。
 *
 * 输入暂时还指着 `packages/legacy-client/public/cards`。那个包是冻结的行为规格，
 * 原画本身没有新旧之分，等美术资源搬进正式版的目录（迁移第 33 条）再把 SOURCES 改过来。
 */

import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AssetPack } from '@assetpack/core'
import sharp from 'sharp'
import { atlasConfig, FRAME_HEIGHT, FRAME_WIDTH } from './atlas.config.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const cards = join(repoRoot, 'packages/legacy-client/public/cards')

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
  // 牌背取的是 mid/ 那一档：它本来就是给中等尺寸准备的版本，缩到 512 宽刚好，
  // 而同名的原画档（1024 宽）缩下来并不会更清楚。
  { group: 'backs{tps}', from: join(cards, 'mid'), pick: (name) => name.startsWith('card-back-') },
]

/** 复制产物的去处。目录可能还不存在（bench 刚建骨架），所以要能自己建。 */
const TARGETS = [
  join(repoRoot, 'apps/web/public/atlas'),
  join(repoRoot, 'packages/bench/public/atlas'),
]

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

  // 暂存目录是中间产物，留着只会让人以为它也是要提交的东西。
  await rm(stagingDir, { recursive: true, force: true })
}

await main()
