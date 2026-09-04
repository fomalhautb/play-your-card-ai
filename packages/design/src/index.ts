/**
 * 设计令牌：颜色、字号、间距、圆角、动效时长，外加卡牌和版式的公共尺寸。
 *
 * 全项目只在这里定义一次，`canvas` 的 Pixi 组件和 `ui` 的 React 组件共用同一份数值，
 * 组件里禁止写死颜色和时长（见《正式版架构》7.1 第 4 条）。
 * 允许依赖：无。这是最底层的包，谁都可以依赖它，它不依赖任何人。
 *
 * 值的来源是 tokens/*.json，产物由 sd.config.mjs 生成，别改 src/generated 下的文件。
 * 尺寸和时长在 TS 这边是纯数字（px 和秒），带单位的写法请读 src/generated/tokens.css。
 * 怎么改、收了什么、明确不收什么，见 README.md。
 */

export { type Tokens, tokens } from './generated/tokens'
