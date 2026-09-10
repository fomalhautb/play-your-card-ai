/**
 * 英雄主动技能那颗「发动」钮的交互测试（《正式版架构》6.6 第 2 条）。
 *
 * 第 19 条做交互测试时这颗钮还不存在（它是第 21 条补的侧栏英雄位的一部分），
 * 所以那一批把英雄技能这条路整个跳过了。这个文件补上。
 *
 * 它和技能牌走的是**同一条选目标的路**（见 input.ts 的文件头），区别只有两处：
 * 没有一张要从手上飞出去的牌，以及目标在哪一侧由英雄决定。所以这里只测那两处不同，
 * 「点候选才算数、点空白取消」那类共同行为在 duelTargeting.test.ts 里已经覆盖过。
 *
 * 「这一局用过了没有」不在这一层：它决定的是**钮还在不在**，由 applyView 读
 * `heroSkillUsed` 决定（见 applyView.ts 的 syncHeroes）。真浏览器里那一条在
 * bench 的 tests/interaction.spec.ts。
 */

import { describe, expect, it } from 'vitest'
import { createDuelInput, type DuelInput } from '../src/scenes/duel/input'
import {
  asSprite,
  asTile,
  createInputProbe,
  fakeTile,
  fakeView,
  type InputProbe,
  openLocks,
} from './helpers/fakeDuelInput'

/**
 * 陈丹琦：升**己方**一个单位。
 * 场上摆两个，只有 `ai-old` 升得动（`ai` 没有下一代），正好把「候选名单不是整排」也带出来。
 */
function upgradeCase(): { probe: InputProbe; input: DuelInput } {
  const probe = createInputProbe(
    fakeView({
      hand: [['h1', 'ai']],
      board: [
        ['u1', 'ai-old'],
        ['u2', 'ai'],
      ],
      hero: 'danqi-chen',
    }),
  )
  return { probe, input: createDuelInput(probe.ctx) }
}

/** 梅拉妮·珀金斯：降**对方**一个单位。用来确认目标在哪一侧真的跟着英雄换。 */
function downgradeCase(): { probe: InputProbe; input: DuelInput } {
  const probe = createInputProbe(
    fakeView({
      hand: [['h1', 'ai']],
      board: [['u1', 'ai-old']],
      foeBoard: [['e1', 'ai']],
      hero: 'melanie-perkins',
    }),
  )
  return { probe, input: createDuelInput(probe.ctx) }
}

describe('英雄技能：按钮按下之后', () => {
  it('亮出合法目标，点中一格发 USE_HERO_SKILL', () => {
    const { probe, input } = upgradeCase()
    const tile = fakeTile('u1')
    input.bindTile(asTile(tile))

    expect(input.beginHeroSkill()).toBe(true)
    expect(probe.calls).toContain('board.highlightTargets(u1)')
    // 进选目标态只报一次 UserAction，指令要等点中格子才发。
    expect(probe.actions).toEqual([{ kind: 'targeting-begin' }])
    expect(probe.commands).toEqual([])

    probe.tapTile(tile)
    expect(probe.commands).toEqual([{ type: 'USE_HERO_SKILL', player: 0, targetInstanceId: 'u1' }])
  })

  it('先报 UserAction 再发指令，顺序和出牌那条一致', () => {
    const { probe, input } = upgradeCase()
    const tile = fakeTile('u1')
    input.bindTile(asTile(tile))
    input.beginHeroSkill()
    probe.tapTile(tile)
    expect(probe.actions).toEqual([
      { kind: 'targeting-begin' },
      { kind: 'use-hero-skill', targetInstanceId: 'u1' },
    ])
  })

  it('点不在名单里的格子：不发指令，这一下按取消算', () => {
    const { probe, input } = upgradeCase()
    // u2 是 `ai`，没有下一代，升不动，所以不在候选里。
    const tile = fakeTile('u2')
    input.bindTile(asTile(tile))
    input.beginHeroSkill()
    probe.tapTile(tile)
    expect(probe.commands).toEqual([])
    /*
     * 点中候选的那一下会在格子那儿收场，冒泡到舞台时 targeting 已经是 null；
     * 没点中的才落到舞台那条兜底上，一律算取消（见 input.ts 的 onStageTap）。
     * 所以「点非候选」和「点空白」是同一个结局，玩家不会卡在一片暗色里。
     */
    expect(probe.actions).toEqual([{ kind: 'targeting-begin' }, { kind: 'targeting-cancel' }])
  })

  it('点空白处取消，战场上的高亮跟着收掉', () => {
    const { probe, input } = upgradeCase()
    input.beginHeroSkill()
    probe.tapEmpty()
    expect(probe.calls).toContain('board.clearTargets')
    expect(probe.actions).toEqual([{ kind: 'targeting-begin' }, { kind: 'targeting-cancel' }])
    expect(probe.commands).toEqual([])
  })

  it('降级那位英雄亮的是对面那一排', () => {
    const { probe, input } = downgradeCase()
    expect(input.beginHeroSkill()).toBe(true)
    // e1 是对方的 `ai`：往下降能降回 `ai-old`，所以它才是候选；我方的 u1 一格都不该亮。
    expect(probe.calls).toContain('board.highlightTargets(e1)')
  })
})

describe('英雄技能：什么时候不受理', () => {
  it('正锁着的时候按不动', () => {
    const { probe, input } = upgradeCase()
    input.refresh(openLocks({ actionsLocked: true }), false)
    expect(input.beginHeroSkill()).toBe(false)
    expect(probe.actions).toEqual([])
  })

  it('一个合法目标都没有时按不动', () => {
    const probe = createInputProbe(
      // 场上只有升不动的那张，候选名单是空的。
      fakeView({ hand: [['h1', 'ai']], board: [['u1', 'ai']], hero: 'danqi-chen' }),
    )
    const input = createDuelInput(probe.ctx)
    expect(input.beginHeroSkill()).toBe(false)
  })

  it('没选英雄、或者英雄没有主动技能时按不动', () => {
    const noHero = createInputProbe(fakeView({ hand: [['h1', 'ai']], board: [['u1', 'ai-old']] }))
    expect(createDuelInput(noHero.ctx).beginHeroSkill()).toBe(false)

    const passive = createInputProbe(
      // 李飞飞是被动英雄，`heroSkillDirectionOf` 给 null。
      fakeView({ hand: [['h1', 'ai']], board: [['u1', 'ai-old']], hero: 'fei-fei-li' }),
    )
    expect(createDuelInput(passive.ctx).beginHeroSkill()).toBe(false)
  })

  it('已经在给一张技能牌选目标时，这一下不受理', () => {
    const probe = createInputProbe(
      fakeView({
        hand: [
          ['h1', 'hit-foe'],
          ['h2', 'ai'],
        ],
        board: [['u1', 'ai-old']],
        foeBoard: [['e1', 'ai']],
        hero: 'danqi-chen',
      }),
    )
    const input = createDuelInput(probe.ctx)
    // 先把技能牌拖进落区进选目标态（坐标同 duelTargeting.test.ts 那两点）。
    const card = probe.card('h1')
    input.pressAt(asSprite(card), 700, 760)
    input.moveTo(700, 400)
    input.releaseAt(700, 400)
    expect(probe.calls).toContain('targeting.begin(打对面)')

    expect(input.beginHeroSkill()).toBe(false)
  })
})

describe('英雄技能钮的灰态', () => {
  it('有目标又没锁着时是亮的', () => {
    const { probe, input } = upgradeCase()
    input.refresh(openLocks(), false)
    expect(probe.heroSkillDisabled).toBe(false)
  })

  it('actionsLocked 时灰着', () => {
    const { probe, input } = upgradeCase()
    input.refresh(openLocks({ actionsLocked: true }), false)
    expect(probe.heroSkillDisabled).toBe(true)
  })

  it('演出锁（有 cue 正拿着锁）时也灰着', () => {
    const { probe, input } = upgradeCase()
    input.refresh(openLocks(), true)
    expect(probe.heroSkillDisabled).toBe(true)
  })

  it('一个合法目标都没有时灰着——这一条是它比「结束出牌」多出来的那把锁', () => {
    const probe = createInputProbe(
      fakeView({ hand: [['h1', 'ai']], board: [['u1', 'ai']], hero: 'danqi-chen' }),
    )
    const input = createDuelInput(probe.ctx)
    input.refresh(openLocks(), false)
    expect(probe.heroSkillDisabled).toBe(true)
    expect(probe.endPlayDisabled).toBe(false)
  })
})
