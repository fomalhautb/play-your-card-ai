/**
 * 组件目录页条目：图标 B（控件线稿）和图标 C（星芒与菱形）（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓ · 悬停 — · 按下 — · 禁用 — · 加载 —
 *   图标本身不是控件，五态全部不适用：它永远长在一颗按钮里（`SealButton`、`Page` 的返回），
 *   状态归那颗按钮，在 `UI/SealButton` 那几条里。
 *
 * 条目按「哪一档尺寸」分两条，不是一个图标一条：这一组的看点是**整套放在一起像不像一家人**，
 * 拆成九条反而看不出线宽和留白有没有对齐。
 *
 * 一整排图标横着摆是**写死的一行**（不换行）：目录页的版式不许跟着容器宽度走
 *（见 client/dev/storybook/README.md 的确定性第 5 条）。
 *
 * title 和导出名用英文的理由见同一份 README 的「基线图的文件名」。
 */

import { Icon, type IconName } from './Icon'

const NAMES: IconName[] = [
  'back',
  'unmuted',
  'muted',
  'fullscreen',
  'share',
  'rotate',
  'help',
  'star',
  'diamond',
]

/** 一排图标。颜色从令牌读（首页那档米色字），别在 story 里写死（7.1 第 4 条）。 */
function Row({ size }: { size: number }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 20,
        alignItems: 'center',
        padding: 16,
        color: 'var(--color-home-ink)',
      }}
    >
      {NAMES.map((name) => (
        <Icon key={name} name={name} size={size} />
      ))}
    </div>
  )
}

export default {
  title: 'UI/Icon',
  component: Icon,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
}

/** 默认那一档：24px，取景框的原始尺寸，描边粗细在这一档最准。 */
export const Default = {
  name: '默认尺寸',
  render: () => <Row size={24} />,
}

/** 小一档：页眉返回钮和圆章里的剪影就是这个尺寸，看线条会不会糊。 */
export const Small = {
  name: '小尺寸',
  render: () => <Row size={17} />,
}
