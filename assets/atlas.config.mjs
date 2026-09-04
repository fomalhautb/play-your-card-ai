/**
 * 卡面图集的打包配置，喂给 PixiJS 官方的 AssetPack。
 * 跑它的是同目录下的 build-atlas.mjs，那边负责准备输入和分发产物。
 *
 * 为什么用 AssetPack 而不是自己写打包脚本：它是 Pixi 官方的资源管线，
 * 出的 spritesheet json 就是 Pixi `Assets` 直接认的格式，将来要加 KTX2 压缩纹理（纪律 3.4）
 * 也是在这里加一条 pipe，不用另起炉灶。
 *
 * 分组的规矩：输入目录名带 `{tps}` 标记的会各自打成一张图集
 * （models、skills、backs 三组）。分开打是为了按场景装卸（3.4）——
 * 对局只要 models 和 backs，牌组编辑才要 skills，不该开局就把四十多张原画全传上显存。
 */

import { compress } from '@assetpack/core/image'
import { texturePacker, texturePackerCompress } from '@assetpack/core/texture-packer'

/**
 * 图集页的边长。
 *
 * 2048 是基线设备（2018 年中端安卓）都保证支持的最大纹理尺寸档位，再大就有机器传不上去。
 * 512×768 的卡面在 2048×2048 上一页排得下 3×2 = 6 张，所以一组十几张会分成几页，
 * Pixi 的 `Assets` 会按 json 里的 related_multi_packs 自己把几页一起加载。
 */
const PAGE_SIZE = 2048

/** 卡面在图集里的尺寸。输入原画是 1024×1536，build-atlas.mjs 先缩到这一档再送进来。 */
export const FRAME_WIDTH = 512
export const FRAME_HEIGHT = 768

/** 图集图片的 webp 质量。90 在卡面这种大面积渐变上看不出压缩痕迹，体积却只有 png 的两三成。 */
const WEBP_QUALITY = 90

/**
 * @param {string} entry 输入目录（build-atlas.mjs 准备好的暂存目录）
 * @param {string} output 产物目录
 */
export function atlasConfig(entry, output) {
  return {
    entry,
    output,
    // 缓存关掉：这个脚本每次都从干净的暂存目录跑，缓存只会让"改了原画却没重打"这种问题更难查。
    cache: false,
    pipes: [
      texturePacker({
        texturePacker: {
          padding: 2,
          // 名字用相对路径去掉扩展名，Pixi 那边就按 `gpt-4o` 这样的贴图名取纹理。
          nameStyle: 'relative',
          removeFileExtension: true,
          // 卡面是不透明的整张图，没有可裁的透明边；关掉裁剪，帧的尺寸才恒等于 512×768。
          allowTrim: false,
          // 允许旋转能多塞几张，但取出来的纹理带旋转标记，调试时看着别扭，收益也就一两张。
          allowRotation: false,
          width: PAGE_SIZE,
          height: PAGE_SIZE,
        },
        resolutionOptions: {
          // 只出一档：原画已经在暂存阶段缩到 512×768 了，多出一档低分辨率现在没人用。
          // 效果分档（3.7）真要降纹理精度时在这里加 `low: 0.5`。
          resolutions: { default: 1 },
          fixedResolution: 'default',
          maximumTextureSize: PAGE_SIZE,
        },
      }),
      /*
       * 图集图片转 webp，只留 webp 一种：两种格式都出等于产物翻倍，而目标平台全都支持 webp。
       * KTX2 以后再说（3.4），那时在这里打开 astc / bc7 / etc 三档。
       *
       * png 写 'skip' 而不是 false，两者差别很大：false 的意思是"不压缩 png"，
       * 而这个 pipe 会把没压缩的原图原样放行，产物里就多出一份没人用的 png（体积还翻三倍）；
       * 'skip' 才是"png 这一路整个不要"。
       */
      compress({ png: 'skip', jpg: 'skip', webp: { quality: WEBP_QUALITY } }),
      // 上一条只换图片格式，图集 json 里写的还是 .png；这条负责把 json 里的引用也改过来。
      texturePackerCompress({ png: false, webp: true }),
    ],
  }
}
