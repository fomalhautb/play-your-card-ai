/**
 * 把旧版的「增益倍数」换算成 platform 认的 0~1 音量。
 *
 * 旧版几段录音的响度没做归一化，人声偏轻，所以它绕开 audio 元素直接用 Web Audio 的
 * GainNode 把点击音放大 2 倍、四段人声放大 3 倍（见黑客松版的 ui/soundEffects.ts）。
 * platform 的 `SoundSpec.volume` 上限就是 1（见 platform 的 audio.ts），放大这条路走不通。
 *
 * 折中办法：整套声音一起按最大那个倍数缩下来。相对关系和旧版一模一样——人声仍然是
 * 点击音的 1.5 倍、是背景音乐的 3.3 倍——只是绝对音量整体降到旧版的三分之一，
 * 玩家把设备音量调大一档就补回来了。反过来（把超过 1 的全夹成 1）会把这套配比压平，
 * 人声就永远压不过背景音乐。
 *
 * 真正的解法是在构建期把音频统一响度（platform 的 audio.ts 里写的就是这个计划）。
 * 那一步做完之后，把下面这个基准改成 1、各处的倍数改成 1 附近的值，这个文件就可以删掉。
 */

/** 旧版用过的最大增益（四段「催一催」人声的 3 倍）。 */
const OLD_MAX_GAIN = 3

/**
 * @param gain 旧版的增益倍数（1 = 原音量）
 * @returns 0~1 的音量，保持各段之间的相对响度
 */
export function volumeOf(gain: number): number {
  return gain / OLD_MAX_GAIN
}
