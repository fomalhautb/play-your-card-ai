/**
 * 设计令牌的生成脚本：读 tokens/*.json（W3C DTCG 格式），产出 src/generated/tokens.ts。
 *
 * 两个入口都在这个文件里：
 *   node sd.config.mjs            重新生成产物（pnpm build）
 *   node sd.config.mjs --check    只在内存里生成一遍，和仓库里的产物比对（pnpm check，CI 用）
 * 合在一起是为了让「生成」和「校验」不可能走岔：两边共用同一份配置对象。
 *
 * 产物是提交进仓库的。改了 tokens/*.json 就得跑一次 build 并把产物一起提交，
 * 否则 check 会红。理由见 README。
 *
 * 正式版简化第 5 步之后只剩 TS 一个平台：令牌瘦到尺寸和时长两组，消费方只有画布那边的
 * Pixi 代码（要的是纯数字），React 那边一条 `var(--…)` 都不剩，CSS 产物没有调用方了。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import StyleDictionary from 'style-dictionary'

const here = dirname(fileURLToPath(import.meta.url))

/** 生成文件顶部的说明。 */
const HEADER_LINES = [
  '本文件由 sd.config.mjs 自动生成，不要手改。',
  '改令牌请改 packages/design/tokens/*.json，然后跑 `pnpm --filter @ai-duel/design build` 并把产物一起提交。',
]

/*
 * 尺寸一律是纯数字：Pixi 只认数字。单位记在令牌名和 $description 里（全是 px）。
 */
StyleDictionary.registerTransform({
  name: 'dimension/number',
  type: 'value',
  filter: (token) => token.$type === 'dimension',
  transform: (token) => Number.parseFloat(token.$value),
})

/*
 * TS 那边的时长一律是秒：GSAP 的 duration 就是秒，旧代码里的常量也是秒。
 * 源里写 ms 也能用，这里换算过来。
 */
StyleDictionary.registerTransform({
  name: 'duration/seconds',
  type: 'value',
  filter: (token) => token.$type === 'duration',
  transform: (token) => {
    const raw = token.$value
    const amount = Number.parseFloat(raw)
    return raw.trim().endsWith('ms') ? amount / 1000 : amount
  },
})

/*
 * 自定义 format：产出一个带类型、可嵌套访问的 .ts。
 *
 * 为什么不用内置的：内置那几个格式没有一个同时满足「嵌套」「有类型」「单个 .ts 文件」。
 *   javascript/module、javascript/nested  嵌套，但是 CommonJS 而且把整个令牌对象
 *                                         （$type、filePath、original…）原样吐出来，不是值；
 *   javascript/es6                        只有值，但是扁平的一堆 const，没有嵌套；
 *   typescript/es6-declarations           只产 .d.ts，得配一个单独的 .js，还是扁平的。
 * 所以这里自己走一遍 allTokens 把值拼成嵌套字面量，末尾加 `as const` 让类型精确到字面量。
 */
/*
 * 标记叶子节点用的 key。用 Symbol 而不是普通字符串，是因为树的每一层键名都来自令牌路径：
 * 万一哪天有个令牌叫 leaf，普通字符串会让它的父分组看起来像叶子。
 * Object.entries 也不返回 symbol 键，打印时不用另外跳过它。
 */
const LEAF = Symbol('leaf')

StyleDictionary.registerFormat({
  name: 'ts/nested-const',
  format: ({ dictionary }) => {
    const root = {}
    for (const token of dictionary.allTokens) {
      let node = root
      for (const segment of token.path.slice(0, -1)) {
        node[segment] ??= {}
        node = node[segment]
      }
      node[token.path.at(-1)] = { [LEAF]: true, value: token.$value, doc: token.$description }
    }
    const header = HEADER_LINES.map((line) => ` * ${line}`).join('\n')
    return [
      '/**',
      header,
      ' */',
      '',
      `export const tokens = ${printNode(root, 0)} as const`,
      '',
      '/** 全部设计令牌的类型，值精确到字面量。 */',
      'export type Tokens = typeof tokens',
      '',
    ].join('\n')
  },
})

/** 把上面拼出来的树打印成 TS 对象字面量。叶子带一行 JSDoc，编辑器悬停时能看到出处。 */
function printNode(node, depth) {
  const pad = '  '.repeat(depth + 1)
  const lines = ['{']
  for (const [key, child] of Object.entries(node)) {
    if (child[LEAF]) {
      if (child.doc) lines.push(`${pad}/** ${child.doc} */`)
      lines.push(`${pad}${key}: ${JSON.stringify(child.value)},`)
    } else {
      lines.push(`${pad}${key}: ${printNode(child, depth + 1)},`)
    }
  }
  lines.push(`${'  '.repeat(depth)}}`)
  return lines.join('\n')
}

const config = {
  source: [join(here, 'tokens/*.json')],
  platforms: {
    ts: {
      // 只留值变换，不要 transformGroup 'js'：它带的 size/rem 会把 150px 换算成 rem。
      transforms: ['dimension/number', 'duration/seconds'],
      buildPath: `${join(here, 'src/generated')}/`,
      files: [{ destination: 'tokens.ts', format: 'ts/nested-const' }],
    },
  },
  // 生成脚本平时不需要看每个平台的进度，只在出错时说话。
  log: { verbosity: 'silent' },
}

const sd = new StyleDictionary(config)
const checking = process.argv.includes('--check')

if (checking) {
  const stale = []
  for (const platform of Object.keys(config.platforms)) {
    // formatPlatform 返回的 destination 已经拼过 buildPath，直接就是要写的路径。
    for (const { destination, output } of await sd.formatPlatform(platform)) {
      const committed = await readFile(destination, 'utf8').catch(() => null)
      if (committed !== output) stale.push(destination)
    }
  }
  if (stale.length > 0) {
    console.error(
      `设计令牌的产物和 tokens/*.json 对不上：\n  ${stale.join('\n  ')}\n` +
        '跑 `pnpm --filter @ai-duel/design build` 并提交产物。',
    )
    process.exit(1)
  }
  console.log('设计令牌产物与源一致。')
} else {
  for (const platform of Object.keys(config.platforms)) {
    for (const { destination, output } of await sd.formatPlatform(platform)) {
      // 目录本来是提交进仓库的，这一行只是给「有人手滑删掉了 src/generated」兜底。
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, output)
    }
  }
  console.log('设计令牌产物已生成：src/generated/tokens.ts')
}
