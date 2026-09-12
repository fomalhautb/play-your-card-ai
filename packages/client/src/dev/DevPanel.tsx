/**
 * dev 测试面板：只在测试房里挂，用来随手摆出想看的局面。
 *
 * 面板发的全是 `DEBUG_*` 指令（走 `localDriver.debug`，不走 `send`——那条口子只收
 * 四条玩家指令，见 match/driver.ts），而 `DEBUG_*` 走的是和正常出牌一模一样的
 * `execute` 路径，所以摆出来的局面和真打出来的没有区别。
 *
 * 它自己 `useMatch(driver)` 拿快照：局面订阅可以有任意多个，
 * 只有事件订阅是单例（那一个名额归 `DuelStage` 的编排层）。
 *
 * 「对方手上有什么」读的是 `peek()` 那份未裁剪的局面：裁剪视图里对手的手牌连实例 id
 * 都没有，替他出牌无从下手。单机时「对方」就是同一个人，这里没有作弊可言。
 */

import { CARD_POOL, CARDS } from '@ai-duel/content'
import type { CardId, GamePhase, PlayerId } from '@ai-duel/core'
import { effectivePlayCost, getCard, other } from '@ai-duel/core'
import { useState } from 'react'
import type { LocalDriver } from '../match/localDriver'
import { useMatch } from '../match/useMatch'
import './devPanel.css'

const PHASE_LABELS: Record<GamePhase, string> = {
  play: '出牌',
  quiz: '答题',
  settle: '结算',
  finished: '已结束',
}

/** 下拉里的这一项表示「不指定卡牌」，也就是照常从牌堆顶抽一张。 */
const FROM_DECK = ''

export function DevPanel({ driver }: { driver: LocalDriver }) {
  const view = useMatch(driver)
  const [open, setOpen] = useState(false)
  /** 「加 1 张」要造哪张卡；留空就是从牌堆抽。 */
  const [cardId, setCardId] = useState<CardId | typeof FROM_DECK>(FROM_DECK)

  const state = driver.peek()
  const mySeat = view.seat ?? 0
  const rows: { label: string; seat: PlayerId }[] = [
    { label: '己方', seat: mySeat },
    { label: '对方', seat: other(mySeat) },
  ]

  /** 替对手打出第一张打得起的 AI 牌。技能牌不打——那要选目标，面板上没有地方点。 */
  const playForFoe = (): void => {
    const foe = other(mySeat)
    const player = state.players[foe]
    const playable = player.hand.find((one) => {
      const card = getCard(state.catalog, one.cardId)
      return card.kind === 'ai' && effectivePlayCost(player, card) <= player.tokens
    })
    if (playable === undefined) return
    // 用 DEBUG_PLAY_CARD 而不是 PLAY_CARD：不管现在轮到谁都能打，摆局面时省得先换手。
    driver.debug({ type: 'DEBUG_PLAY_CARD', player: foe, instanceId: playable.instanceId })
  }

  /**
   * 替双方确认本轮。
   *
   * 回合结算要两边都确认才推进，而测试房对面座位上没有人：只点自己那一下就永远停在
   * 「等待对方确认」。一颗钮发两条是为了让「过一轮」变成一次点击——
   * 端到端用例正是靠它把一整局走完的。
   */
  const confirmBoth = (): void => {
    driver.send({ type: 'CONFIRM_ROUND', player: mySeat })
    driver.send({ type: 'CONFIRM_ROUND', player: other(mySeat) })
  }

  return (
    <div className="dev-panel">
      <button type="button" onClick={() => setOpen((now) => !now)}>
        {open ? '收起面板' : '测试面板'}
      </button>

      {open ? (
        <div className="dev-panel__body">
          {/*
            一眼看清引擎现在停在哪：出牌卡住还是在等答题自动交卷，光看画面分不出来。
            手牌张数也报出来——端到端用例靠它断言「那一下拖拽真的把牌打出去了」。
          */}
          <p data-testid="dev-status">
            第 {state.round}/{state.totalRounds} 轮 · {PHASE_LABELS[state.phase]} · 行动方{' '}
            {state.players[state.activePlayer].name} · 我方手牌{' '}
            <span data-testid="dev-hand-count">{state.players[mySeat].hand.length}</span>
          </p>

          <div className="dev-panel__row">
            <span className="dev-panel__label">造牌</span>
            <select value={cardId} onChange={(event) => setCardId(event.target.value)}>
              <option value={FROM_DECK}>牌堆顶</option>
              {CARD_POOL.map((id) => (
                <option key={id} value={id}>
                  {CARDS[id]?.name ?? id}
                </option>
              ))}
            </select>
          </div>

          {rows.map((row) => (
            <div className="dev-panel__row" key={row.seat}>
              <span className="dev-panel__label">{row.label}</span>
              <button
                type="button"
                onClick={() =>
                  driver.debug({
                    type: 'DEBUG_ADD_CARD',
                    player: row.seat,
                    // 不传 cardId 才是「从牌堆抽」，所以留空时这个字段必须整个不出现。
                    ...(cardId === FROM_DECK ? {} : { cardId }),
                  })
                }
              >
                加 1 张
              </button>
              <button
                type="button"
                onClick={() => driver.debug({ type: 'DEBUG_REMOVE_CARD', player: row.seat })}
              >
                去 1 张
              </button>
            </div>
          ))}

          <div className="dev-panel__row">
            <span className="dev-panel__label">推进</span>
            {/* 对方不会自己点「结束出牌」，卡住时靠这颗钮把出牌权交出去。 */}
            <button
              type="button"
              onClick={() => driver.send({ type: 'END_PLAY', player: state.activePlayer })}
            >
              结束出牌
            </button>
            <button type="button" onClick={playForFoe}>
              代对手出牌
            </button>
            {/* 只想看答题和计分时省掉连点两次「结束出牌」。 */}
            <button type="button" onClick={() => driver.debug({ type: 'DEBUG_SKIP_TO_QUIZ' })}>
              跳到答题
            </button>
            <button type="button" disabled={state.phase !== 'settle'} onClick={confirmBoth}>
              确认本轮
            </button>
          </div>

          <p>进答题阶段后结果会自动交卷，不用手动点。</p>
        </div>
      ) : null}
    </div>
  )
}
