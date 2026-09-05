/**
 * 剧本用哪几张图集。单独一个文件，是因为 Node 侧也要读它：
 * 跑批前要检查图集在不在（src/node/ensureAtlas.ts），而那边不能 import 到 Pixi。
 * 放在 textures.ts 里的话，一个纯路径常量会把整个 Pixi 拖进 Node 进程。
 */

export interface AtlasOptions {
  /** 卡面图集的清单（Pixi 的 spritesheet json），相对页面根。 */
  faces: string
  /** 牌背图集的清单。牌背和卡面是分开打的两组，见 assets/atlas.config.mjs。 */
  backs: string
  /** 牌背在图集里的帧名。 */
  backFrame: string
}

/**
 * 真实场景的图集。三组图集是分开打的（models / skills / backs），对局只装 models 和 backs，
 * 技能牌那组不装——纪律 3.4 要求纹理按场景装卸。牌背取带花饰的那张，和开发页一致。
 *
 * 地址是相对页面根的绝对路径，也就是 public/ 下的同名文件（见 vite.config.ts 的 publicDir）。
 */
export const DEFAULT_ATLAS: AtlasOptions = {
  faces: '/atlas/models-0.webp.json',
  backs: '/atlas/backs.webp.json',
  backFrame: 'card-back-v4-relaxed-ornament',
}
