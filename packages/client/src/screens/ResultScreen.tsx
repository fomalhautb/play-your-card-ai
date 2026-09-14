/**
 * 终局结算：整局打完（或中断）之后盖满对局那一屏的那一层。
 *
 * 一层暗幕（`Veil`）托着一块板（`Sheet`），板上写胜负、比分、轮次，下面三条出路。
 *
 * 只负责画，不判定胜负：标题和比分由调用方算好传进来（判定在 `matchOutcome.ts`）。
 * 「开卡包」这颗钮同理——这一层不知道抽没抽到卡，传了 `onOpenPack` 才摆。
 *
 * 正式版简化第 3 步去掉了三张底板原画和胜 / 负 / 平那三档标题字色（都是装饰）。
 * `data-outcome` 留着：端到端用例靠它认结算页、判两端对胜负的说法一致
 *（见 e2e/matchPage.ts 的 `expectSameOutcome`），而标题那行字是中文文案，不适合当判据。
 */

import { Button, Sheet, Veil } from '@ai-duel/ui'
import type { MatchOutcome } from './matchOutcome'
import './resultScreen.css'

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
    // 外面这一层给暗幕一个铺满的定位祖先（`Veil` 是 `position: absolute`）。
    <div className="result" data-outcome={outcome}>
      <Veil>
        <Sheet title={title}>
          {score === null ? null : (
            <p>
              最终比分 <strong>{`${score.mine} : ${score.theirs}`}</strong>
            </p>
          )}
          {rounds === null ? null : <p>{`这一局打了 ${rounds} 轮`}</p>}
          <p>
            {onOpenPack === undefined ? null : <Button onClick={onOpenPack}>开卡包</Button>}
            <Button onClick={onPlayAgain}>再来一局</Button>
            <Button onClick={onHome}>回首页</Button>
          </p>
        </Sheet>
      </Veil>
    </div>
  )
}
