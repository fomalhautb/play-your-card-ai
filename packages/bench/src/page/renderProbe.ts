/**
 * 包一层 Pixi 的 `render`，用来拿到「谁在渲染、渲染的是哪棵树」，顺便给每帧计 GPU 时间。
 *
 * 为什么要这么绕：过度绘制那条指标要遍历场景的 stage，GPU 计时要卡在渲染前后，
 * 但契约（contract.ts）里没有 stage 也没有 renderer——真实场景不该为了被测量而多开接口。
 * 包 `WebGLRenderer.prototype.render` 就什么都不用它配合：只要它是用 Pixi 渲染的，就抓得到。
 *
 * 前提是 bench 和 canvas 解析到同一份 pixi.js。pnpm 里同版本会指向 store 里同一个目录，
 * Vite 打包时是同一个模块实例，所以补在原型上的这一层两边都生效。
 * 版本对不上时 stage() 会一直是 null，overdraw() 会明说「没抓到场景」而不是给一个假数字。
 */

import { Container, type Renderer, WebGLRenderer } from 'pixi.js'

/** GPU 计时最多留多少个查询在飞。查询对象是显存资源，不封顶会一直涨。 */
const MAX_PENDING_QUERIES = 8
/** 最多留多少个采样。一段剧本几百帧，取中位数用不了更多。 */
const MAX_SAMPLES = 1200

export interface RenderProbe {
  renderer(): Renderer | null
  stage(): Container | null
  /** 打开逐帧 GPU 计时。扩展不存在返回 false，调用方据此写「不可用」而不是失败。 */
  enableGpuTiming(gl: WebGL2RenderingContext): boolean
  /** 已经取回结果的那些帧的 GPU 耗时，毫秒。 */
  gpuSamplesMs(): number[]
  gpuReason(): string | undefined
}

let installed: RenderProbe | null = null

export function installRenderProbe(): RenderProbe {
  if (installed) return installed

  let lastRenderer: Renderer | null = null
  let lastStage: Container | null = null

  let gl: WebGL2RenderingContext | null = null
  let ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null
  let reason: string | undefined = '未开启'
  let active: WebGLQuery | null = null
  const pending: WebGLQuery[] = []
  const samples: number[] = []

  const beginQuery = () => {
    if (!gl || !ext || active || pending.length >= MAX_PENDING_QUERIES) return
    const query = gl.createQuery()
    if (!query) return
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
    active = query
  }

  const endQuery = () => {
    if (!gl || !ext || !active) return
    gl.endQuery(ext.TIME_ELAPSED_EXT)
    pending.push(active)
    active = null
  }

  const drain = () => {
    if (!gl || !ext) return
    // GPU_DISJOINT 为真说明期间发生了上下文切换之类的事，这一批计时全部作废——
    // 规范就是这么要求的，留着会得到离谱的大数。
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const query = pending[i]
      if (!query) continue
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue
      if (!disjoint && samples.length < MAX_SAMPLES) {
        samples.push((gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6)
      }
      gl.deleteQuery(query)
      pending.splice(i, 1)
    }
  }

  // render 有多个重载，按重载签名去包会对不上类型，所以降成「任意参数」再补回去。
  type RenderFn = (this: WebGLRenderer, ...args: unknown[]) => void
  const holder = WebGLRenderer.prototype as unknown as { render: RenderFn }
  const original = holder.render
  holder.render = function patched(this: WebGLRenderer, ...args: unknown[]) {
    const first = args[0]
    lastRenderer = this
    lastStage =
      first instanceof Container
        ? first
        : ((first as { container?: Container } | undefined)?.container ?? null)
    beginQuery()
    try {
      return original.apply(this, args)
    } finally {
      endQuery()
    }
  }

  installed = {
    renderer: () => lastRenderer,
    stage: () => lastStage,
    enableGpuTiming: (context) => {
      // 顺手清掉上一轮的采样：一次跑批要跑好几段剧本，样本混在一起每一行的数字都没意义了。
      samples.length = 0
      pending.length = 0
      active = null
      const found = context.getExtension('EXT_disjoint_timer_query_webgl2') as {
        TIME_ELAPSED_EXT: number
        GPU_DISJOINT_EXT: number
      } | null
      if (!found) {
        gl = null
        ext = null
        reason = '浏览器没有暴露 EXT_disjoint_timer_query_webgl2'
        return false
      }
      gl = context
      ext = found
      reason = undefined
      return true
    },
    gpuSamplesMs: () => {
      drain()
      return [...samples]
    },
    gpuReason: () => reason,
  }
  return installed
}
