/**
 * 终局结算：整局打完（或中断）之后盖满对局那一屏的那一层。
 *
 * 替掉第 21 条那个临时版 `MatchResult.tsx`。正式版就是需求单里的**弹窗 E + 面板 H**：
 * 一层暗幕（`Veil`）托着一块羊皮纸（`Sheet`），底板三张原画按胜 / 负 / 平换。
 *
 * 只负责画，不判定胜负：标题和比分由调用方算好传进来（判定在 `matchOutcome.ts`）。
 * 「开卡包」这颗钮同理——这一层不知道抽没抽到卡，传了 `onOpenPack` 才摆。
 *
 * ## 轮次摘要
 *
 * 比分下面多一行「打了 N 轮」。旧版没有这一行，加它是因为正式版的板子比临时那块大得多
 *（775×517 对 420 宽），只放胜负和比分会空得发虚；而「这一局有多长」是玩家真会想知道的
 * 唯一一条额外信息——更细的（每轮各赢了谁）属于战报，那还没有。
 *
 * ## 底图的地址写在这里，不写在 `ui` 里
 *
 * `ui` 不认识素材路径（见 Sheet.tsx 的文件头）。三张底板已经登记在 `preload/manifests.ts`
 * 的 `BATTLE_IMAGES` 里，后台队列会提前下好，所以这一层铺上去时图基本都在缓存里。
 */

import { Button, Sheet, Veil } from '@ai-duel/ui'
import type { MatchOutcome } from './matchOutcome'
import './resultScreen.css'

/**
 * 三种结果各配一张底板。中断局（`aborted`）**没有**自己的底板——
 * 它不是一种结果，是「这一局没打完」，所以退回 `Sheet` 的纯纸面那一档。
 */
const ART: Record<MatchOutcome, string | undefined> = {
  victory: '/battle/final-victory-bg.webp',
  defeat: '/battle/final-defeat-bg.webp',
  draw: '/battle/final-draw-bg.webp',
  aborted: undefined,
}

/** 板子的语气。中断局按「没有输赢可言」走，标题是普通墨色。 */
const TONE = {
  victory: 'victory',
  defeat: 'defeat',
  draw: 'draw',
  aborted: 'plain',
} as const

export interface ResultScreenProps {
  outcome: MatchOutcome
  /** 大标题。中断局传的是中断原因。 */
  title: string
  /** 最终比分。对局中断时没有比分可言，传 null 就整行不渲染。 */
  score: { mine: number; theirs: number } | null
  /** 打了几轮。同样是中断局没有，传 null 就不渲染。 */
  rounds: number | null
  onPlayAgain(): void
  onHome(): void
  /**
   * 这一局抽到了新卡，按了就去开包（迁移第 29 条）。没抽到就不传，那颗钮整个不渲染。
   *
   * 抽卡本身在 `recordWin` 里已经发生过了（卡已经进收藏），所以这颗钮只是「去看一眼」，
   * 不点也不会少一张牌——这也是它可以被跳过的原因。
   */
  onOpenPack?(): void
}

export function ResultScreen({
  outcome,
  title,
  score,
  rounds,
  onPlayAgain,
  onHome,
  onOpenPack,
}: ResultScreenProps) {
  return (
    /*
     * 外面这一层只做两件事：给暗幕一个铺满的定位祖先（`Veil` 是 `position: absolute`），
     * 以及把「这一局怎么收场的」写成一个属性——端到端用例靠它认结算页，
     * 而板子上那三档语气（`data-tone`）里中断局和平局是同一档，分不出来。
     */
    <div className="result" data-outcome={outcome}>
      <Veil>
        <Sheet title={title} tone={TONE[outcome]} background={ART[outcome]}>
          {score === null ? null : (
            <p className="result__score">
              最终比分 <strong>{`${score.mine} : ${score.theirs}`}</strong>
            </p>
          )}
          {rounds === null ? null : <p className="result__rounds">{`这一局打了 ${rounds} 轮`}</p>}
          <div className="result__actions">
            {onOpenPack === undefined ? null : <Button onClick={onOpenPack}>开卡包</Button>}
            <Button onClick={onPlayAgain}>再来一局</Button>
            <Button onClick={onHome}>回首页</Button>
          </div>
        </Sheet>
      </Veil>
    </div>
  )
}
