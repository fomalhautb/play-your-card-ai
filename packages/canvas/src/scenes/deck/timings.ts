/**
 * 构筑页那一套卡牌动画的时长和幅度，全部抄自黑客松版 `screens/DeckScreen.tsx`。
 *
 * 和 `director/timings.ts` 同一个位置、同一个写法（一处定义、各处 import），只是那一份是
 * 对局演出的节拍表、归编排层排，而这一页没有编排层——它的动画都是「玩家做了什么，
 * 当场演一段」，所以常量摆在场景旁边。每一条都标了抄的是哪一行，改之前先回去核对。
 *
 * 单位是**秒**（GSAP 的 duration 就吃秒），只有那两条计时器是毫秒，名字里带 `_MS`。
 * 跟手那三条（DRAG_SCALE / 姿态 / 跟随）不在这里：它们和对局的拖拽是同一套手感，
 * 正本在 `interaction/dragRules.ts`，两页共用。
 */

/** 新加的那一份牌从松手位置飞进格子（`INSERT_DUR`）。 */
export const INSERT_DUR = 0.4
/** 飞行用的缓动。落点由远及近收住，像牌被放进去而不是弹进去。 */
export const INSERT_EASE = 'power3.out'

/**
 * 拖拽途中让位 / 收位那一下（`GAP_SHIFT_DUR`）。
 * 比落牌那一程快一档：手还在拖，这一下只是「松手会落这儿」的提示，慢了会觉得界面跟不上手。
 */
export const GAP_SHIFT_DUR = 0.22

/** 从牌组送回卡池那一程（`RETURN_FLIGHT_DUR`）。和加入的飞行同一档：一来一回是同一段路。 */
export const RETURN_FLIGHT_DUR = 0.4
/**
 * 送回的替身在飞行的最后这一段里淡掉（占全程的比例，`RETURN_FADE_PORTION`）。
 * 落点那张牌此刻可能根本不在视野里（卡池滚在别处），不淡就是凭空消失。
 */
export const RETURN_FADE_PORTION = 0.35
/** 拖拽取消、把卡送回原位那一程（`RETURN_DUR`）。只有取消才走它。 */
export const RETURN_DUR = 0.28
/**
 * 飞行跑完再多等这一会儿才把卡交还回收池（`DROP_BACK_DELAY`）。
 * 正好卡在补间末帧交还会看到一次跳动，这 0.06 秒是留给收尾的余量。
 */
export const DROP_BACK_DELAY = 0.06

/** 加不进去时摇头的五个关键帧（度）和总时长（`refuseAdd`）。 */
export const REFUSE_SHAKE_DEG = [-3, 2.4, -1.6, 0.8, 0] as const
export const REFUSE_SHAKE_DUR = 0.35
/** 卡顶那句「为什么加不进去」：淡入、停留（毫秒）、淡出，以及它底边离卡顶多远。 */
export const ADD_TIP_IN = 0.18
export const ADD_TIP_HOLD_MS = 1200
export const ADD_TIP_OUT = 0.25
export const ADD_TIP_GAP = 10

/** 放大查看时右边那张背面大卡（伴随层）淡入淡出多久（`ZOOM_SIDE_FADE`）。 */
export const ZOOM_SIDE_FADE = 0.25

/** 点问号章翻面（`HELP_FLIP_DUR`）。和对局手牌那一份保持一致。 */
export const HELP_FLIP_DUR = 0.4

/**
 * 三处卡跟着指针倾斜的最大角度（度）。
 *
 * 卡越小同样的角度看着越夸张，所以格子里那张再收一档；放大的那张和格子同一档
 *（`POOL_TILT_DEG` / `MINI_TILT_DEG` / `ZOOM_TILT_DEG`）。
 */
export const POOL_TILT_DEG = 6
export const MINI_TILT_DEG = 5
export const ZOOM_TILT_DEG = 5
