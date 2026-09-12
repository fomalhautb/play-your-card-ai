/**
 * 侧栏那张英雄牌：把一张原画摆成「一张卡」的样子。
 *
 * 不是 `CardSprite`：英雄原画本身就是画好的整张卡面，名字和英文名都印在图里，
 * 再给它套一层铭牌和费用圆章是错的——英雄没有费用（理由见 duelContract 的 `CardTextures.heroes`）。
 */

import { Container, Sprite, type Texture } from 'pixi.js'
import { CARD_HEIGHT, CARD_WIDTH } from '../../layout/fanMath'

/**
 * 建一张英雄牌，按卡面基准尺寸（150×225）摆好，原点在底边中点。
 *
 * 原点跟着 `CardSprite` 的坐标约定走，玩家面板才能不管里面装的是哪一种东西
 *（它只写 position 和 scale，见 PlayerPanel 的 layout）。
 * 外面再包一层 Container 是因为面板会写 `scale`，而尺寸是靠精灵自己的 scale 撑出来的，
 * 两者写在同一个对象上会互相覆盖。
 *
 * 没这位英雄的原画就返回 null（调用方可能只装了一部分），那时英雄位空着。
 */
export function makeHeroArt(texture: Texture | undefined): Container | null {
  if (texture === undefined) return null
  const sprite = new Sprite(texture)
  sprite.anchor.set(0.5, 1)
  sprite.width = CARD_WIDTH
  sprite.height = CARD_HEIGHT
  const holder = new Container()
  holder.addChild(sprite)
  return holder
}
