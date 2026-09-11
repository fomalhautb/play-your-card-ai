/**
 * 关于本作（`/info`）。首页菜单里「关于」那一项进来。
 *
 * 内容只回答两件事：**这游戏怎么玩**、**这东西是谁做的**。
 * 旧版这一页只有后半段（团队名单和黑客松出处，见黑客松版的 screens/InfoScreen.tsx），
 * 玩法说明散在首页和对局里；正式版的首页整个画在画布上，没有地方写字，
 * 所以玩法那一段搬到这里来。
 *
 * ## 和旧版的两处出入
 *
 * 1. **不再按背景图里那些金框的实测比例摆文字**。旧版整页压在一张 16:9 的背景图上，
 *    每一块文字的位置都是照着图里金框、星饰的像素比例定的（换图就得重新量）。
 *    正式版改成一块普通的、能滚的正文栏（`ui` 的 `Page`），背景图只当底纹铺着——
 *    文字多一段少一段都不会顶到框外面，手机上也不用另做一套。
 * 2. **等图**这件事照旧：整页压在那张背景图上，它没到位的话文字会先浮在一片空底上，
 *    所以先过一遍加载页（旧版同一条理由，只是那边的加载页是临时的）。
 */

import { Notice, Page, SealButton } from '@ai-duel/ui'
import { useLocation } from 'wouter'
import { usePlatform } from '../app/platform'
import { toggleMuted, useMuted } from '../audio/mute'
import { INFO_IMAGES } from '../preload/manifests'
import { useAssets } from '../preload/useAssets'
import { LoadingScreen } from './LoadingScreen'
import './infoScreen.css'

/** 团队名单，不写分工——四个人的活儿是混着干的（抄旧版的注释）。 */
const TEAM = ['石在', '司马冰清', '刘利剑', '叶丁元']

/** 玩法说明。一条一句话，多了没人看。 */
const RULES = [
  '每一轮先出牌：把手里的 AI 牌放到自己这半边战场上，费用不够就放不下。',
  '出完牌亮题，场上每张 AI 牌各答一道，答对的给自己这边记一分。',
  '技能牌不上场，打出去当场结算；英雄技能一局只能发一次。',
  '先拿到足够分数的一方赢下整局。',
]

export function InfoScreen() {
  const platform = usePlatform()
  const [, navigate] = useLocation()
  const muted = useMuted(platform)
  const assets = useAssets(platform, INFO_IMAGES)

  if (!assets.ready) return <LoadingScreen progress={assets.progress} />

  return (
    <div className="info">
      {/*
        背景图铺在页面底下当底纹。放在 `Page` 外面而不是当它的 children：
        `Page` 的正文是要滚的，图跟着滚就成了一张会动的背景。
      */}
      <img className="info__bg" src={INFO_IMAGES[0]} alt="" aria-hidden="true" draggable={false} />
      <Page
        title="关于本作"
        onBack={() => navigate('/')}
        actions={
          <SealButton
            icon={muted ? 'muted' : 'unmuted'}
            label={muted ? '打开声音' : '关闭声音'}
            pressed={muted}
            onClick={() => toggleMuted(platform)}
          />
        }
      >
        <h2 className="info__heading">怎么玩</h2>
        <ol className="info__rules">
          {RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>

        <h2 className="info__heading">开发团队</h2>
        <p className="info__line">出牌吧！AI！ 由下面四个人做出来：</p>
        <p className="info__names">{TEAM.join(' · ')}</p>
        <p className="info__line">SheNicest 2026 年 8 月黑客松 · 五天之内完成。</p>

        <Notice tone="info">感谢你的游玩与支持。</Notice>
      </Page>
    </div>
  )
}
