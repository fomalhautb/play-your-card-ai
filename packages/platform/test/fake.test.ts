/**
 * 假实现的行为。跑在 node 环境（见 vitest.config.ts）：这一整个文件不碰浏览器 API，
 * 漏了一处会当场报 window is not defined。
 */

import { describe, expect, it } from 'vitest'
import { createFakePlatform } from '../src/index'

describe('假音频', () => {
  it('记下每一次播放的参数', () => {
    const { audio } = createFakePlatform()
    audio.play({ src: '/music/match.m4a', loop: true, volume: 0.9 })
    expect(audio.calls).toEqual([
      { kind: 'play', src: '/music/match.m4a', volume: 0.9, loop: true, channel: null },
    ])
    expect(audio.playing()).toEqual(['/music/match.m4a'])
  })

  it('同一个声道上新的把旧的掐掉', () => {
    const { audio } = createFakePlatform()
    audio.play({ src: '/music/question-ai.m4a' }, { channel: 'voice' })
    audio.play({ src: '/music/skill-jiejie.m4a' }, { channel: 'voice' })
    // 同一个声道上连放两段，只该剩后放的那段在响。
    expect(audio.playing()).toEqual(['/music/skill-jiejie.m4a'])
    expect(audio.calls.map((call) => call.kind)).toEqual(['play', 'stop', 'play'])
  })

  it('不给声道就自由并发', () => {
    const { audio } = createFakePlatform()
    audio.play({ src: '/music/mouse-click-sound.m4a' })
    audio.play({ src: '/music/mouse-click-sound.m4a' })
    expect(audio.playing()).toHaveLength(2)
  })

  it('循环音转完一圈报一次 onEnd', () => {
    const { audio } = createFakePlatform()
    let laps = 0
    audio.play({ src: '/music/beginning.m4a', loop: true }).onEnd(() => {
      laps += 1
    })
    audio.finish('/music/beginning.m4a')
    expect(laps).toBe(1)
  })

  it('静音状态变了才通知，退订之后不再通知', () => {
    const { audio } = createFakePlatform()
    const seen: boolean[] = []
    const off = audio.onMutedChange((muted) => seen.push(muted))
    audio.setMuted(true)
    audio.setMuted(true)
    off()
    audio.setMuted(false)
    expect(seen).toEqual([true])
    expect(audio.isMuted()).toBe(false)
  })
})

describe('假触感', () => {
  it('记下三种反馈，impact 不给参数时是中等', () => {
    const { haptics } = createFakePlatform()
    haptics.impact()
    haptics.impact('heavy')
    haptics.selection()
    haptics.notification('error')
    expect(haptics.calls).toEqual([
      { kind: 'impact', style: 'medium' },
      { kind: 'impact', style: 'heavy' },
      { kind: 'selection' },
      { kind: 'notification', notification: 'error' },
    ])
  })

  it('设备不支持时是空操作', () => {
    const { haptics } = createFakePlatform()
    haptics.setSupported(false)
    haptics.impact()
    expect(haptics.isSupported()).toBe(false)
    expect(haptics.calls).toEqual([])
  })
})

describe('假全屏', () => {
  it('做不到全屏的设备上返回 false，也不该报出状态变化', () => {
    const { fullscreen } = createFakePlatform()
    fullscreen.setSupported(false)
    const seen: boolean[] = []
    fullscreen.onChange((active) => seen.push(active))

    return fullscreen.enterLandscape().then((ok) => {
      expect(ok).toBe(false)
      expect(fullscreen.isActive()).toBe(false)
      expect(seen).toEqual([])
      // 按钮按下去这件事仍然记着：界面的分支对不对，看的是它有没有走到这一步。
      expect(fullscreen.enterCount()).toBe(1)
    })
  })

  it('玩家自己按浏览器的全屏入口也算，退出时报一次', () => {
    const { fullscreen } = createFakePlatform()
    const seen: boolean[] = []
    fullscreen.onChange((active) => seen.push(active))
    fullscreen.setActive(true)
    fullscreen.setActive(true)
    fullscreen.setActive(false)
    expect(seen).toEqual([true, false])
  })
})

describe('假图片加载', () => {
  it('自动结算时 load 在下一个微任务成功，并进缓存', async () => {
    const { images } = createFakePlatform()
    expect(images.isSettled('/cards/a.webp')).toBe(false)
    const image = await images.load('/cards/a.webp')
    expect(image.displayUrl).toBe('/cards/a.webp')
    expect(images.isSettled('/cards/a.webp')).toBe(true)
    expect(images.get('/cards/a.webp')).toBe(image)
  })

  it('释放之后缓存和「有结果了」一起忘掉', async () => {
    const { images } = createFakePlatform()
    await images.load('/cards/a.webp')
    images.release(['/cards/a.webp'])
    expect(images.get('/cards/a.webp')).toBeNull()
    expect(images.isSettled('/cards/a.webp')).toBe(false)
    expect(images.released).toEqual(['/cards/a.webp'])
  })

  it('手动模式下能摆出「这张一直不到货」', async () => {
    const { images } = createFakePlatform()
    images.setAutoComplete(false)
    const pending = images.load('/cards/slow.webp')
    expect(images.pending()).toEqual(['/cards/slow.webp'])
    images.fail('/cards/slow.webp')
    await expect(pending).rejects.toThrow('图片加载失败')
    // 失败的也算有结果：闸门不该为同一张取不到的图反复卡满超时。
    expect(images.isSettled('/cards/slow.webp')).toBe(true)
  })
})
