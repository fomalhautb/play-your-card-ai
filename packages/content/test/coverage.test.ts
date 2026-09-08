import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HEROES, OPEN_SKILL_CARD_IDS, PLAYABLE_AI_CARD_IDS } from '../src/index'

/**
 * 《正式版架构》6.3 最后一条：**每张已启用的牌和每位已启用的英雄至少被一个测试点名**。
 *
 * 为什么要有这条：卡和英雄是一张一张加的，加的时候顺手补测试的人不多，
 * 而"这张牌到底有没有人测过"翻测试文件是数不出来的。这里把它变成一条会红的检查。
 *
 * 做法是扫测试源码的文本，看每个 id 有没有作为一个完整的词出现过。
 * 这当然测不出断言写得好不好——它只回答"有没有人提过这张牌"。
 * 挂了要做的是**补一条有意义的断言**（费用、技能字段、在进化链上的位置、能不能进牌组……），
 * 不是把 id 抄进注释糊弄过去，更不是把下面的名单放宽。
 *
 * 只要求"已启用"的那些：进不了卡池的牌（调不到模型的 2 张 AI、没实装的 14 张技能牌）
 * 和 comingSoon 的英雄玩家碰不到，强求覆盖只会逼人写一堆没内容的断言。
 */

const TEST_DIRS = [
  // 引擎测试打的也是真实卡牌，一部分牌只在那边被点过名（比如只有引擎会结算的那几张技能牌），
  // 所以两个目录都要扫。core 的测试目录挪了位置，这一行也得跟着改。
  fileURLToPath(new URL('../../core/test', import.meta.url)),
  fileURLToPath(new URL('.', import.meta.url)),
]

/**
 * 这个文件自己不算数。
 *
 * 下面几条自检里写了几个真实的卡牌 id 当例子，扫进来的话它们就变成了"被点名"——
 * 覆盖检查自己给自己盖章，那就什么也没查。
 */
const SELF = fileURLToPath(import.meta.url)

/**
 * 把所有测试文件的**代码**拼成一大段，只用来做文本查找。
 *
 * 整行的注释先扔掉：注释里提一句"这张牌以后要测"不算测过，
 * 这条检查要是被注释满足了，它就只剩个形式。
 * 行尾注释留着无所谓——那一行本来就有代码。
 */
function testSources(): string {
  const chunks: string[] = []
  for (const dir of TEST_DIRS) {
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.test.ts')) continue
      // parentPath 会不会带结尾的斜杠，取决于传进 readdirSync 的那个目录带不带
      //（new URL('.', …) 给出的就带），所以削掉再拼，免得下面和 SELF 比时对不上。
      const path = `${entry.parentPath.replace(/\/$/, '')}/${entry.name}`
      if (path === SELF) continue
      const source = readFileSync(path, 'utf8')
      chunks.push(
        source
          .split('\n')
          .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
          .join('\n'),
      )
    }
  }
  return chunks.join('\n')
}

/**
 * id 有没有在源码里作为一个完整的词出现。
 *
 * 前后不许接标识符字符，否则 'gpt-2' 会被 'gpt-2-5' 之类的名字蒙混过去。
 * 引号不作要求：卡表的键在 TS 里合法时是不带引号的（`gemini: [...]`），
 * 那也算点名。
 */
function mentions(source: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\w-])${escaped}([^\\w-]|$)`).test(source)
}

describe('内容覆盖', () => {
  const source = testSources()

  it('每张能上场的 AI 牌都被某条测试点名', () => {
    expect(PLAYABLE_AI_CARD_IDS.filter((id) => !mentions(source, id))).toEqual([])
  })

  it('每张已开放的技能牌都被某条测试点名', () => {
    expect(OPEN_SKILL_CARD_IDS.filter((id) => !mentions(source, id))).toEqual([])
  })

  it('每位已实装的英雄都被某条测试点名', () => {
    const enabled = Object.values(HEROES)
      .filter((hero) => hero.comingSoon !== true)
      .map((hero) => hero.id)
    expect(enabled.filter((id) => !mentions(source, id))).toEqual([])
  })

  it('扫到的确实是测试文件，不是空目录', () => {
    // 目录挪了位置时上面三条会因为"什么都没扫到"而全绿，那是最坏的失败方式。
    expect(source.length).toBeGreaterThan(10_000)
  })

  it('查找本身认得出"没被点名"', () => {
    // 上面三条现在全是绿的，所以这条反过来验一下检查还活着。
    expect(mentions(source, '这张牌根本不存在')).toBe(false)
    // 短 id 不能被更长的名字蒙混过去：'chatgpt-5-6-sol' 里那截 'gpt-5-6-sol' 不算点名。
    expect(mentions("expect(CARDS['chatgpt-5-6-sol']).toBeDefined()", 'gpt-5-6-sol')).toBe(false)
    expect(mentions("expect(CARDS['gpt-4o']).toBeDefined()", 'gpt-4o')).toBe(true)
    // 卡表里合法的标识符当键时不带引号（`gemini: [...]`），那也算点名。
    expect(mentions("  gemini: ['多模融合', '…'],", 'gemini')).toBe(true)
    // 整行注释不算：只在注释里提到的牌等于没测。
    expect(testSources().includes('这张牌以后要测')).toBe(false)
  })
})
