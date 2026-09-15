/**
 * 选英雄页的节奏常量，一处收齐。数全部出自黑客松版的 `screens/HeroScreen.tsx` 和 `hero.css`，
 * 正式版简化第 4 步之五把那一版的入场和悬停补回来时照抄了一遍。
 *
 * 秒为单位（GSAP 收的就是秒）。对局那边的 `director/timings.ts` 记的是毫秒，
 * 因为那些数要跟 cue 的 `durationMs` 对账；这一页没有编排层，不必绕一圈。
 */

/** 入场整段的缓动。`HeroScreen.tsx` 的 `gsap.timeline({ defaults: { ease: 'power3.out' } })`。 */
export const INTRO_EASE = 'power3.out'

/**
 * 返回、标题、副标题那三格：从上方落下来，错峰 0.08。
 * `rise` 是往上偏移各自高度的百分之多少（旧版的 `yPercent: -30`）。
 */
export const INTRO_CHROME = { duration: 0.5, stagger: 0.08, rise: 0.3 } as const

/**
 * 七张卡：淡入 + 从下方微微升起 + 从 0.96 放到原大，错峰 0.05，整段比上面那三格晚 0.1 起跑。
 * `sink` 是往下偏移卡高的百分之多少（旧版的 `yPercent: 3`）。
 */
export const INTRO_CARD = {
  at: 0.1,
  duration: 0.55,
  stagger: 0.05,
  sink: 0.03,
  scale: 0.96,
} as const

/** 悬停：抬起卡高的 2%、放到 1.035 倍，来回同一个时长（扫动时不会一边快一边慢）。 */
export const HOVER_LIFT_RATIO = 0.02
export const HOVER_SCALE = 1.035
export const HOVER_DUR = 0.25

/**
 * 悬停时卡面跟着指针倾斜的最大角度（度）。
 *
 * 旧版 `HeroScreen.tsx` 的 `CARD_TILT_DEG = 8`，比手牌那一档（6）大一级：
 * 这一页的卡更大、又是正对着看的，6° 几乎看不出来。详情那张大卡同用这一档。
 */
export const HOVER_TILT_DEG = 8

/** 「点击查看技能」那一条提示的淡入淡出。`hero.css` 的 `.hero__card-hint` 的 0.18s 过渡。 */
export const HINT_FADE = 0.18

/**
 * 详情里说明栏和两颗钮的淡入。
 *
 * 旧版这两样是跟着大卡一起被 Flip 带进来的，没有单独的补间；这一版大卡走展示层
 *（`RevealOverlay.enter`），说明和钮是挂在它旁边的另一层，所以自己淡一下——
 * 不淡的话它们会在暗幕还没升起时就整块出现。
 */
export const DETAIL_CHROME_FADE = 0.26
