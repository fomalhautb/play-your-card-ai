/**
 * 组件目录页条目：设计令牌一览（7.1 第 3、4 条）。
 *
 * `ui` 现在还没有组件（第一批要到迁移第 31 条才开始补），但目录页不能是空的：
 * 令牌是这两套组件库共用的地基，先把它摆出来——加变体时对着这一页挑颜色和间距，
 * 比翻 tokens.json 快，也比在组件里写死数值不容易走岔。
 *
 * 页面本身**不是组件**，只是一条 story：它整个写在这个文件里，不进 `src/index.ts`。
 * 真正的 `ui` 组件按需求单（docs/design/组件需求单.md）逐个补，不从这里长出来。
 *
 * 数值全部从 `@ai-duel/design` 读，一个都不抄——抄一份就等于多一处会走岔的副本。
 *
 * 状态矩阵：这是一张说明页，没有普通/悬停/按下/禁用/加载五态，全部不适用。
 */

import { tokens } from '@ai-duel/design'
import type { CSSProperties, ReactNode } from 'react'

/** 令牌树摊平之后的一项：`color.paper.base` 这样的路径，加上叶子上的值。 */
interface Leaf {
  path: string
  value: string | number
}

/**
 * 把嵌套的令牌对象摊成一串「路径 → 值」。
 *
 * 令牌树的深度不固定（`color.plaque.navy.hover.fill` 有五层，`space.lg` 只有两层），
 * 所以按层级手写表格必然漏。摊平之后各个小节只要按路径前缀挑自己那一段。
 */
function flatten(node: unknown, prefix: string): Leaf[] {
  if (typeof node === 'string' || typeof node === 'number') return [{ path: prefix, value: node }]
  if (node === null || typeof node !== 'object') return []
  return Object.entries(node).flatMap(([key, child]) =>
    flatten(child, prefix === '' ? key : `${prefix}.${key}`),
  )
}

const ALL = flatten(tokens, '')
const under = (prefix: string) => ALL.filter((leaf) => leaf.path.startsWith(`${prefix}.`))
/** 颜色叶子：值是 `#rrggbb` 的那些。字体栈也是字符串，靠这一条筛掉。 */
const COLORS = under('color').filter(
  (leaf) => typeof leaf.value === 'string' && leaf.value.startsWith('#'),
)

/**
 * 一行摆几格。**写死，不许换成 `auto-fill`**：`auto-fill` 的列数是拿容器宽度算出来的，
 * 而这一页在截图回归的 1280 视口下正好卡在临界点上——去掉左右内边距刚好剩 1216，
 * 而 7 列（7×160 + 6×16）也正好是 1216，容器窄一个像素就掉成 6 列、整页高度差三百多。
 * 列数写死之后版式和容器宽度再无关系，宽度上任何一点浮动都不会换一种排法。
 */
const GRID_COLUMNS = 7

const page: CSSProperties = {
  padding: tokens.space.xxl * 2,
  fontFamily: tokens.font.family.serif,
  color: tokens.color.page.foreground,
  background: tokens.color.page.background,
  /*
   * 行高写死，不用默认的 `normal`：`normal` 的行盒高度取自当前字体的 ascent/descent，
   * 而这一页的字体栈最后落到各平台自带的兜底衬线体上（Google Fonts 没有联网加载，
   * 见 client/dev/storybook/README.md 的「已知局限」），行盒高度于是跟着机器走。
   * 写成倍数之后行盒高度只由字号决定，整页高度就只是「多少条令牌 × 多大字号」的结果。
   */
  lineHeight: 1.4,
  /*
   * 故意不写 `minHeight: '100vh'` 这类跟着视口走的尺寸：这一页比任何视口都高，写了不起作用，
   * 却给元素的高度多开了一个和内容无关的来源——截图时 Playwright 会临时把视口撑到整页那么高
   * 再拍，视口一变这个下限就跟着变。第 28 条在 linux 上就撞上过「量到的高度比画出来的多 45
   * 像素」，Playwright 多拍了一轮才稳住。高度只由内容决定，这类反复就不会有。
   */
  boxSizing: 'border-box',
}

const monoPath: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: tokens.font.size.sm,
  opacity: 0.75,
  wordBreak: 'break-all',
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: tokens.space.xxl * 3 }}>
      <h2 style={{ fontSize: tokens.font.size.xl * 1.6, margin: 0, fontWeight: 600 }}>{title}</h2>
      <p style={{ margin: `${tokens.space.xs}px 0 ${tokens.space.xxl}px`, opacity: 0.7 }}>{note}</p>
      {children}
    </section>
  )
}

/** 一格色板：色块加路径加色值。 */
function Swatch({ leaf }: { leaf: Leaf }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
      <div
        style={{
          height: 52,
          borderRadius: tokens.radius.md,
          background: String(leaf.value),
          // 深色底上的深色块需要一条边才看得出边界。
          border: `1px solid ${tokens.color.paper.lineDark}`,
        }}
      />
      <span style={monoPath}>{leaf.path}</span>
      <span style={{ fontSize: tokens.font.size.sm }}>{leaf.value}</span>
    </div>
  )
}

function Palette() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${GRID_COLUMNS}, 160px)`,
        gap: tokens.space.xxl,
      }}
    >
      {COLORS.map((leaf) => (
        <Swatch key={leaf.path} leaf={leaf} />
      ))}
    </div>
  )
}

/** 字号阶梯：每一档按自己的字号排一行样例。 */
function FontSizes() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg }}>
      {under('font.size').map((leaf) => (
        <div
          key={leaf.path}
          style={{ display: 'flex', alignItems: 'baseline', gap: tokens.space.lg }}
        >
          <span style={{ ...monoPath, width: 180, flexShrink: 0 }}>{leaf.path}</span>
          <span style={{ width: 60, flexShrink: 0, fontSize: tokens.font.size.sm }}>
            {leaf.value}px
          </span>
          <span style={{ fontSize: Number(leaf.value) }}>出牌吧，AI！Play your card</span>
        </div>
      ))}
    </div>
  )
}

/** 间距阶梯：每一档画一条那么宽的条。 */
function Spaces() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg }}>
      {under('space').map((leaf) => (
        <div
          key={leaf.path}
          style={{ display: 'flex', alignItems: 'center', gap: tokens.space.lg }}
        >
          <span style={{ ...monoPath, width: 180, flexShrink: 0 }}>{leaf.path}</span>
          <span style={{ width: 60, flexShrink: 0, fontSize: tokens.font.size.sm }}>
            {leaf.value}px
          </span>
          <div
            style={{
              width: Number(leaf.value),
              height: 20,
              background: tokens.color.theme.blue,
            }}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * 圆角阶梯：每一档画一个用那个圆角的方块。
 *
 * 排成写死列数的网格而不是让它自己换行：`flex-wrap` 一行放得下几个同样是按容器宽度算的，
 * 和上面色板一个道理（见 `GRID_COLUMNS`）。
 */
function Radii() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${GRID_COLUMNS}, 140px)`,
        gap: tokens.space.xxl,
      }}
    >
      {under('radius').map((leaf) => (
        <div
          key={leaf.path}
          style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs, width: 140 }}
        >
          <div
            style={{
              width: 120,
              height: 64,
              borderRadius: Number(leaf.value),
              background: tokens.color.paper.base,
            }}
          />
          <span style={monoPath}>{leaf.path}</span>
          <span style={{ fontSize: tokens.font.size.sm }}>{leaf.value}px</span>
        </div>
      ))}
    </div>
  )
}

/**
 * 动效时长：每一档画一条按比例长的横条。
 *
 * 不做真的动画：目录页要能被截图回归拍（6.8），画面上有东西在动就没法比。
 * 横条长度按最长那一档归一，几档之间的快慢比例看得出来就够了。
 */
function Durations() {
  const items = under('duration')
  const longest = Math.max(...items.map((leaf) => Number(leaf.value)))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg }}>
      {items.map((leaf) => (
        <div
          key={leaf.path}
          style={{ display: 'flex', alignItems: 'center', gap: tokens.space.lg }}
        >
          <span style={{ ...monoPath, width: 220, flexShrink: 0 }}>{leaf.path}</span>
          <span style={{ width: 60, flexShrink: 0, fontSize: tokens.font.size.sm }}>
            {leaf.value}s
          </span>
          <div
            style={{
              width: `${(Number(leaf.value) / longest) * 100}%`,
              maxWidth: 420,
              height: 12,
              borderRadius: tokens.radius.pill,
              background: tokens.color.theme.gold,
            }}
          />
        </div>
      ))}
    </div>
  )
}

function TokensPage() {
  return (
    <div style={page}>
      <h1 style={{ fontSize: tokens.font.size.xl * 2.2, margin: 0, fontWeight: 600 }}>设计令牌</h1>
      <p style={{ margin: `${tokens.space.sm}px 0 ${tokens.space.xxl * 3}px`, opacity: 0.7 }}>
        全部读自 <code>@ai-duel/design</code>。改令牌请改 packages/design/tokens/*.json 再重新生成。
      </p>
      <Section title="色板" note={`${COLORS.length} 个颜色令牌，按令牌路径排。`}>
        <Palette />
      </Section>
      <Section
        title="字号阶梯"
        note="小字号那一档（font.size）。cqi 阶梯和放大系数不在这里排样例。"
      >
        <FontSizes />
      </Section>
      <Section title="间距" note="padding / gap / margin 共用的一套阶梯。">
        <Spaces />
      </Section>
      <Section title="圆角" note="border-radius 阶梯。pill 是「大到必定被裁到半高」的那一档。">
        <Radii />
      </Section>
      <Section title="动效时长" note="单位是秒。条长按最长的一档归一，只表达快慢比例。">
        <Durations />
      </Section>
    </div>
  )
}

export default {
  title: 'UI/DesignTokens',
  component: TokensPage,
  parameters: {
    // 这一页很长，居中留白只会把它挤窄。
    layout: 'fullscreen',
  },
  // 「实时」开关是给画布条目用的（见 client/dev/storybook/preview.tsx），这一页用不上。
  argTypes: { live: { control: false, table: { disable: true } } },
}

export const Overview = {
  name: '一览',
}
