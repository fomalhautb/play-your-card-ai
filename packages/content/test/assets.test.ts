import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AI_MODEL_CARD_IDS, HEROES, SKILL_DESIGN_CARD_IDS } from '../src/index'

/**
 * 《正式版架构》6.4：资源引用存在。
 *
 * 每张卡、每位英雄的 id 同时是原画的文件名，所以改 id 等于换图：改了这边没改那边，
 * 打图集那一步（assets/build-atlas.mjs）扫的是目录里有什么，不认识卡表，
 * 所以少一张原画不会有任何人报错——只是图集里少一帧，那张卡到了画面上是个空位。
 * 这条测试就是那个"不报错"的补丁。
 *
 * 映射规则：
 *   AI 牌   ui/aiModelArt.ts   → cards/models/<卡牌 id>.webp
 *   技能牌   ui/skillCardArt.ts → cards/skills/<卡牌 id>.webp
 *   英雄     ui/heroArt.ts      → hero/card-<英雄 id>.webp
 *
 * 查的是资源源目录 `assets/source/`，不是哪个壳的 public：
 * public 下的图集是 `pnpm assets:build` 的产物、进了 .gitignore，跑测试时未必打出来过，
 * 而「这张图存不存在」问的是源，跟谁怎么用它无关。
 * 这是测试而不是产品代码，dependency-cruiser 不扫 test/，没有违反依赖方向。
 */

const ASSETS_DIR = fileURLToPath(new URL('../../../assets/source', import.meta.url))

/** 缺哪几张一次列全，别修一张跑一次。 */
function missing(paths: readonly string[]): string[] {
  return paths.filter((path) => !existsSync(`${ASSETS_DIR}${path}`))
}

describe('原画文件都在', () => {
  it('18 张 AI 牌各有一张原画', () => {
    expect(missing(AI_MODEL_CARD_IDS.map((id) => `/cards/models/${id}.webp`))).toEqual([])
  })

  it('24 张技能牌各有一张原画', () => {
    expect(missing(SKILL_DESIGN_CARD_IDS.map((id) => `/cards/skills/${id}.webp`))).toEqual([])
  })

  it('7 位英雄各有一张原画', () => {
    expect(missing(Object.keys(HEROES).map((id) => `/hero/card-${id}.webp`))).toEqual([])
  })
})
