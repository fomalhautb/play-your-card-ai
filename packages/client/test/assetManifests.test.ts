/**
 * 清单和 assets/source/ 里实际的文件必须一一对上。
 *
 * 守的是同一个毛病的两面：
 * - 清单里有、文件没有 → 那张图永远加载失败、那段声音永远不响；
 * - 文件有、清单里没有 → 那张图要等真用到时才开始下，玩家先看到一块白再看到它显影。
 * 两种都不会让程序报错，只会让画面难看、声音消失，所以只能靠测试盯着。
 *
 * 直接扫目录而不是维护一份「应该有哪些文件」的名单：那份名单本身也会漂移，
 * 等于把同一个问题往后推一层。查的是**源目录**而不是壳的 public：public 下那些是
 * `pnpm assets:build` 的产物，本机没跑过就是空的（见 assets/README.md）。
 *
 * 这是测试而不是产品代码，dependency-cruiser 不扫 test/，跨目录读文件不违反依赖方向。
 */

import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MUSIC_TRACKS } from '../src/audio/music'
import { SOUNDS } from '../src/audio/sounds'
import { BATTLE_IMAGES, HERO_IMAGES, INFO_IMAGES, PRELOAD_GROUPS } from '../src/preload/manifests'

const ASSETS_DIR = fileURLToPath(new URL('../../../assets/source', import.meta.url))

/**
 * 会被 `assets:build` 复制到壳 public 下、并且由清单负责等的那几个目录。
 *
 * `cards/` 不在里面：卡面打成了图集，由场景自己装卸，不走这套清单。
 * 站点图标和 manifest 也不在：那些由浏览器按 `<link>` 自己取，进清单只会白等。
 * `home/` 和 `room/` 整个没了：正式版简化第 4 步把这两页剥成素方块，那两批图一起删了。
 */
const IMAGE_DIRS = ['battle', 'hero', 'info']

/** 音频落在壳 public 的 `audio/music/` 下，源目录却叫 `music/`（见 assets/README.md 的复制表）。 */
const AUDIO_URL_PREFIX = '/audio/music/'
const AUDIO_DIR = 'music'

/** 源目录下这几个目录的全部文件，返回的是清单里用的那种根绝对路径。 */
function listSourceFiles(dirs: readonly string[]): string[] {
  const found: string[] = []
  for (const dir of dirs) {
    for (const name of readdirSync(`${ASSETS_DIR}/${dir}`)) found.push(`/${dir}/${name}`)
  }
  return found.sort()
}

describe('图片清单', () => {
  const files = listSourceFiles(IMAGE_DIRS)
  const listed = new Set([BATTLE_IMAGES, HERO_IMAGES, INFO_IMAGES].flat())

  it('这几个目录下的每一张图都登记在某份清单里', () => {
    // 逐个报缺失的文件名，而不是只说数字对不上——加图忘了登记的人要的是「哪一张」。
    expect(files.filter((url) => !listed.has(url))).toEqual([])
  })

  it('清单里的每个地址在源目录下都有对应文件', () => {
    const existing = new Set(files)
    expect([...listed].filter((url) => !existing.has(url)).sort()).toEqual([])
  })

  it('只有 webp（png / jpg 都已转掉）', () => {
    // 同一张图有两种格式时，代码引哪个全凭记忆，改图很容易只换掉没人用的那份。
    expect(files.filter((url) => !url.endsWith('.webp'))).toEqual([])
  })

  it('后台预载队列覆盖全部清单，且组之间不漏人', () => {
    // 分组只是排队顺序，不该借机把某一页整份漏掉——漏掉的那页就退回「进去才开始下」。
    expect(new Set(PRELOAD_GROUPS.flat())).toEqual(listed)
  })
})

describe('音频清单', () => {
  const files = readdirSync(`${ASSETS_DIR}/${AUDIO_DIR}`).sort()
  const listed = [
    ...new Set([...Object.values(MUSIC_TRACKS), ...Object.values(SOUNDS).map((spec) => spec.src)]),
  ]

  it('背景音乐和音效在源目录下都有对应文件，一个不多一个不少', () => {
    const names = listed.map((url) => url.replace(AUDIO_URL_PREFIX, '')).sort()
    expect(names).toEqual(files)
  })

  it('地址都在 /audio/music/ 底下（assets:build 的复制目标）', () => {
    expect(listed.filter((url) => !url.startsWith(AUDIO_URL_PREFIX))).toEqual([])
  })

  it('只有 m4a', () => {
    // 新增音频先用 ffmpeg 转成 AAC；背景音乐会整首往下拉，保留原始 MP3 会额外抢带宽。
    expect(files.filter((name) => !name.endsWith('.m4a'))).toEqual([])
  })
})
