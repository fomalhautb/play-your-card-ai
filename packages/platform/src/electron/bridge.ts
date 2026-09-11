/**
 * Electron 壳挂在 `window` 上的那座桥。
 *
 * 渲染进程里没有 Node、也没有 `ipcRenderer`（`contextIsolation` 开着、`sandbox` 开着，
 * 见 apps/steam/src/main.ts），所有壳专有的能力都只能经这一个对象过来。
 *
 * **这份接口是抄的**：真正把它挂上去的是 `apps/steam/src/preload.ts`，那边有一份一模一样的
 * 形状声明。两份必须对得上，改一处要一起改。抄一份而不是共用一份的理由和
 * client 那边的 `AUTH_BASE` 一样：跨包只走包入口（架构 7.2 第 2 条），
 * 而 `apps/steam` 是壳、`packages/platform` 是库，壳可以依赖库，库不能反过来依赖壳。
 *
 * 桥上的东西都得能过 `contextBridge`：只有基本类型、纯数据对象和函数过得去。
 * 所以「现在是不是全屏」是一个**函数**而不是一个字段——contextBridge 传过来的字段是
 * 挂上去那一刻的快照，之后主进程再怎么改，渲染进程这边看到的还是老值。
 */

export interface ShellSteamBridge {
  /** Steam 客户端在不在、SDK 初始化成功没有。开窗口之前就定下来了，之后不变。 */
  readonly available: boolean
  /** Steam 昵称，只给人看。拿不到时 null。 */
  readonly personaName: string | null
  /** 现取一张会话票据（十六进制）。失败时 reject。 */
  authTicket(): Promise<string>
}

export interface ShellFullscreenBridge {
  /** 现在是不是全屏。preload 里存着主进程推过来的最新值，所以这一问是同步的。 */
  isActive(): boolean
  /** 进 / 退全屏，返回操作之后的实际状态。 */
  set(active: boolean): Promise<boolean>
  /** 订阅全屏状态变化，返回退订函数。玩家按 F11 或者点窗口按钮时也会走到这儿。 */
  onChange(listener: (active: boolean) => void): () => void
}

export interface ShellBridge {
  /**
   * 哪一种壳。现在只有 `'electron'` 一种。
   *
   * 留这个字段是为了让「有没有桥」和「是哪一座桥」分开：第 36 条的 Capacitor 壳
   * 如果也挂一个同名对象，光看 `window.aiDuelShell` 在不在就分不出来了。
   */
  readonly kind: 'electron'
  readonly steam: ShellSteamBridge
  readonly fullscreen: ShellFullscreenBridge
}

/** 桥挂在 `window` 上的名字。preload 那边用的是同一个字面量。 */
const BRIDGE_KEY = 'aiDuelShell'

/**
 * 取这座桥，不在 Electron 壳里跑时返回 null。
 *
 * 为什么要允许「不在」：同一份渲染进程代码也会被端到端用例、Storybook、以及直接在浏览器里
 * 打开构建产物的人跑到。那时候没有 preload，桥自然不在——这一层返回 null，
 * 上面那层（`createElectronPlatform`）就退回网页实现，而不是一进门就炸。
 */
export function readShellBridge(): ShellBridge | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as unknown as Record<string, unknown>)[BRIDGE_KEY]
  if (candidate === null || typeof candidate !== 'object') return null
  // 只认 kind 对得上的那一种。别的壳将来挂同名对象时，这里会老老实实地说「不是我要的桥」。
  return (candidate as ShellBridge).kind === 'electron' ? (candidate as ShellBridge) : null
}
