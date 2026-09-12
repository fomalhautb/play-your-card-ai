/**
 * 终局结算：对局结束（或中断）之后盖满全屏的那一层。
 *
 * **这是临时版**。正式的终局结算是需求单里的面板 H + 弹窗 E，铺的是三张底板之一
 *（`/battle/final-{victory,defeat,draw}-bg.webp`，已经登记在 preload 的 `BATTLE_IMAGES`
 * 清单里，但后台预加载还没接上——那是第 31 条加载页那一步的事），归第 31 条。
 * 这一版只把「谁赢了、比分多少、下一步去哪」摆清楚，好让第 21 条的
 * 「单机能打完整局」有个收尾。
 *
 * 只负责画，不判定胜负：标题和比分由调用方算好传进来（同旧版的 ui/MatchResult.tsx）。
 * 「开卡包」这颗钮同理：这一层不知道抽没抽到卡，传了 `onOpenPack` 才摆。
 */

import { Button } from '@ai-duel/ui'
import './matchResult.css'

export type MatchOutcome = 'victory' | 'defeat' | 'draw' | 'aborted'

export interface MatchResultProps {
  outcome: MatchOutcome
  /** 大标题。中断局传的是中断原因。 */
  title: string
  /** 最终比分。对局中断时没有比分可言，传 null 就整行不渲染。 */
  score: { mine: number; theirs: number } | null
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

export function MatchResult({
  outcome,
  title,
  score,
  onPlayAgain,
  onHome,
  onOpenPack,
}: MatchResultProps) {
  return (
    <div className="match-result" data-outcome={outcome}>
      <div className="match-result__panel">
        <p className="match-result__title">{title}</p>
        {score === null ? null : (
          <p className="match-result__score">
            最终比分 <strong>{`${score.mine} : ${score.theirs}`}</strong>
          </p>
        )}
        <div className="match-result__actions">
          {onOpenPack === undefined ? null : <Button onClick={onOpenPack}>开卡包</Button>}
          <Button onClick={onPlayAgain}>再来一局</Button>
          <Button onClick={onHome}>回首页</Button>
        </div>
      </div>
    </div>
  )
}
