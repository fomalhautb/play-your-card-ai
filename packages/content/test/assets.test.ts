import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AI_MODEL_CARD_IDS, HEROES, SKILL_DESIGN_CARD_IDS } from '../src/index'

/**
 * 《正式版架构》6.4：资源引用存在。
 *
 * 每张卡、每位英雄的 id 同时是原画的文件名，所以改 id 等于换图：改了这边没改那边，
 * 卡面会悄悄退回占位插画（见 legacy-client 的 ui/cardArt.ts 的 cardArtFor），
 * 一个错都不报，只是画错。这条测试就是那个"不报错"的补丁。
 *
 * 映射规则照抄 legacy-client：
 *   AI 牌   ui/aiModelArt.ts   → public/cards/models/<卡牌 id>.webp
 *   技能牌   ui/skillCardArt.ts → public/cards/skills/<卡牌 id>.webp
 *   英雄     ui/heroArt.ts      → public/hero/card-<英雄 id>.webp
 *
 * **美术资源现在还住在 legacy-client 里**（迁移第 33 条才搬到新的资源目录），
 * 所以这里跨包指着它的 public/。搬家那天改下面这个 PUBLIC_DIR 就行，
 * 三条映射规则本身不会变。
 * 这是测试而不是产品代码，dependency-cruiser 不扫 test/，没有违反依赖方向。
 */

const PUBLIC_DIR = fileURLToPath(new URL('../../legacy-client/public', import.meta.url))

/** 缺哪几张一次列全，别修一张跑一次。 */
function missing(paths: readonly string[]): string[] {
  return paths.filter((path) => !existsSync(`${PUBLIC_DIR}${path}`))
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
