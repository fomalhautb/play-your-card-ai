/**
 * 文字纹理缓存，对应《正式版架构》3.5「文字只创建一次并缓存」。
 *
 * 做法是把每段文字**烤成一张纹理**，场景里挂的是精灵不是 Text 对象。这样有三个好处：
 * 一是同一段文字（比如好几张牌都是 3 费）只量一次、只画一次；
 * 二是场景图里根本不存在能改内容的 Text，"一帧里改了文字"这种错误写不出来；
 * 三是全是精灵，合批不会被文字对象打断（3.9）。
 *
 * 烤的时候会走一次离屏渲染，所以只在**建场景时**烤，动画期间一次都不烤——
 * 6.9 的「动画期间文字对象重建 = 0」和「离屏渲染次数」两条都靠这个时机保证。
 * created 这个计数就是给那条断言用的：剧本跑起来之后它不许再涨。
 */

import { type Renderer, Text, type TextStyle, type Texture } from 'pixi.js'

/**
 * 画布上所有文字共用的字体栈。
 *
 * EB Garamond 管拉丁字母和数字，Noto Serif SC 管中文，两者都从 Google Fonts 拿；
 * 后面三个本地宋体是兜底，断网或字体没加载成功时至少还是衬线体，
 * 不会掉回黑体把古典调子毁掉。来源：黑客松版 styles.css 的 :root font-family。
 *
 * 放在这里而不是 `@ai-duel/design`：正式版简化第 5 步把字体那组令牌删了（理由见那个包的
 * README），而建 TextStyle 的地方都要经过这个缓存，字体栈跟着它走最不容易走岔。
 * 字体阶段一用系统衬线体，第 34 条一致性检查之前不自托管子集化（《正式版架构》4.1），
 * 所以目录页基线图上的字形跟着机器走，基线必须按平台分目录。
 */
export const FONT_STACK = "'EB Garamond', 'Noto Serif SC', 'Songti SC', STSong, SimSun, serif"

/** 一段烤好的文字：纹理，加上重画它所需要的原料。 */
interface BakedText {
  texture: Texture
  content: string
  style: TextStyle
}

export class TextTextureCache {
  private readonly renderer: Renderer
  private readonly cache = new Map<string, BakedText>()
  private created = 0

  constructor(renderer: Renderer) {
    this.renderer = renderer
  }

  /**
   * 取一张文字纹理，没有就当场烤一张。
   *
   * key 要能唯一标识"这段文字长什么样"：内容一样但字号或颜色不同的两处必须给不同的 key，
   * 否则第二处会拿到第一处的样子。调用方一般拼成 `样式名|内容`。
   */
  get(key: string, content: string, style: TextStyle): Texture {
    const cached = this.cache.get(key)
    if (cached !== undefined) return cached.texture

    // Text 只是个"拿来烤"的中间对象，烤完就销毁，绝不进场景图。
    const text = new Text({ text: content, style })
    const texture = this.renderer.generateTexture({
      target: text,
      // 分辨率跟着渲染倍率走：文字比图形更吃采样，低一档就糊，高一档纯属浪费显存。
      resolution: this.renderer.resolution,
      antialias: true,
    })
    /*
     * 不带参数：Pixi 的 `Text.destroy(true)` 会连**样式对象一起销毁**（把它的 _fill 置空），
     * 而样式是调用方传进来的、多半还要给下一段文字用——第二段起就没有填充色了，
     * 烤出来是一块跟着上一次残留状态走的颜色。
     * 组件目录页的预烤纹理那一条（fx/bakedTextures.stories.ts）三行标签共用一个样式，
     * 正是在那里露的馅：第一行正常，后两行几乎是黑的。
     * 样式该由谁建谁收，这里只借用。
     */
    text.destroy()
    this.cache.set(key, { texture, content, style })
    this.created += 1
    return texture
  }

  /**
   * 全部重画一遍（4.3：WebGL 上下文丢失之后）。
   *
   * 渲染到纹理的东西上下文一丢就是空的，Pixi 只会自动重传"有原始数据"的纹理。
   * 重画写回的是**同一批 Texture 对象**，场景里挂着它们的精灵一个都不用改。
   * 这一步会重新建 Text 对象、textCreated 因此会涨——上下文恢复不属于"动画期间"，
   * 6.9 那条断言量的是剧本跑起来之后的增量，不受影响。
   */
  restore(): void {
    for (const baked of this.cache.values()) {
      const text = new Text({ text: baked.content, style: baked.style })
      this.renderer.render({ container: text, target: baked.texture, clear: true })
      // 同 get()：不带参数，别把调用方的样式对象一起销毁掉。
      text.destroy()
      this.created += 1
    }
  }

  /** 烤过多少张。剧本跑起来之后这个数不许再涨（6.9 的「动画期间文字对象重建」）。 */
  get textCreated(): number {
    return this.created
  }

  /** 场景销毁：烤出来的纹理是我们自己建的，得自己还回去。 */
  destroy(): void {
    for (const baked of this.cache.values()) baked.texture.destroy(true)
    this.cache.clear()
  }
}
