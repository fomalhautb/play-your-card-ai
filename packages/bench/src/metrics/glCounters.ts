/**
 * WebGL 计数器：包一层 `WebGL2RenderingContext.prototype`，数 6.9 表里的每一项。
 *
 * 必须在 Pixi 创建上下文之前安装——包的是原型，装晚了已经拿到手的上下文照样会走包装，
 * 但期间发生的调用就丢了，而 Pixi 初始化正是纹理上传和着色器编译最集中的时候。
 * 所以调用它的 page/install.ts 由 index.html 用一个单独的、排在 main.ts 之前的 script 标签引入。
 *
 * 「切换」和「调用」分开数：Pixi 会反复把同一张纹理绑到同一个槽上，那不打断合批。
 * 只有绑的东西真的变了才算一次切换，6.9 表的「合批被打断次数」看的是切换。
 */

import { zeroCounters } from './diff'
import { levelBytes, mipmapExtraBytes, sourceSize, storageBytes } from './textureBytes'
import type { GlCounters } from './types'

const TEXTURE_CUBE_MAP = 0x8513
const CUBE_FACE_MIN = 0x8515
const CUBE_FACE_MAX = 0x851a
const BLEND = 0x0be2

/** 立方体贴图六个面各有各的 target，但它们绑的是同一张纹理。 */
const bindingTarget = (target: number) =>
  target >= CUBE_FACE_MIN && target <= CUBE_FACE_MAX ? TEXTURE_CUBE_MAP : target

type AnyGl = WebGL2RenderingContext & Record<string, unknown>

/** 每个上下文自己的状态。判断「有没有真的换」要靠它，不能只看调用次数。 */
interface ContextState {
  activeUnit: number
  bound: Map<string, WebGLTexture | null>
  program: WebGLProgram | null
  blendEnabled: boolean
  blendKey: string
  /** 每张纹理各层占了多少字节，key 是 `${target}:${level}`。删纹理时按它减回去。 */
  levels: WeakMap<WebGLTexture, Map<string, number>>
}

export interface GlCounterHandle {
  snapshot(): GlCounters
  /** 把所有累计值清零。常驻纹理内存不清——它是水位，清了就等于假装纹理都没了。 */
  reset(): void
  uninstall(): void
  /**
   * 有没有真的接管到某个 WebGL 上下文。
   *
   * 为 false 时所有计数都是 0，而 0 会让 6.9 表里每一条上限都「通过」——
   * 那是最危险的一种绿。真实原因通常是渲染根本没走这条路（比如换到了 WebGPU）。
   * 所以跑批时要单独断言它，见 tests/deterministic.spec.ts。
   */
  contextSeen(): boolean
}

/** 已经装过就返回同一个 handle：重复包装会让每次调用被数两遍。 */
let installed: GlCounterHandle | null = null

export function installGlCounters(): GlCounterHandle {
  if (installed) return installed

  const counters = zeroCounters()
  const states = new WeakMap<WebGLRenderingContext, ContextState>()
  const restores: Array<() => void> = []
  let seen = false

  const stateOf = (gl: WebGLRenderingContext): ContextState => {
    let state = states.get(gl)
    if (!state) {
      seen = true
      state = {
        activeUnit: 0,
        bound: new Map(),
        program: null,
        blendEnabled: false,
        blendKey: '',
        levels: new WeakMap(),
      }
      states.set(gl, state)
    }
    return state
  }

  /** 记一层纹理占了多少字节：同一层重复上传按「先减旧的再加新的」算。 */
  const setLevel = (state: ContextState, target: number, level: number, bytes: number) => {
    const texture = state.bound.get(`${state.activeUnit}:${bindingTarget(target)}`)
    if (!texture) return
    let map = state.levels.get(texture)
    if (!map) {
      map = new Map()
      state.levels.set(texture, map)
    }
    const key = `${target}:${level}`
    counters.textureBytes += bytes - (map.get(key) ?? 0)
    map.set(key, bytes)
  }

  const wrap = <T extends object>(
    proto: T,
    name: string,
    make: (original: (...args: never[]) => unknown) => (...args: never[]) => unknown,
  ) => {
    const holder = proto as unknown as Record<string, unknown>
    const original = holder[name]
    if (typeof original !== 'function') return
    holder[name] = make(original as (...args: never[]) => unknown)
    restores.push(() => {
      holder[name] = original
    })
  }

  const install = (proto: WebGL2RenderingContext) => {
    /** 只加一个计数、不看参数的那一类。 */
    const tally = (name: string, ...fields: Array<keyof GlCounters>) => {
      wrap(
        proto,
        name,
        (original) =>
          function (this: AnyGl, ...args: never[]) {
            stateOf(this)
            for (const field of fields) counters[field] += 1
            return original.apply(this, args)
          },
      )
    }

    tally('drawArrays', 'drawArrays', 'drawCalls')
    tally('drawElements', 'drawElements', 'drawCalls')
    tally('drawRangeElements', 'drawElements', 'drawCalls')
    tally('drawArraysInstanced', 'drawInstanced', 'drawCalls')
    tally('drawElementsInstanced', 'drawInstanced', 'drawCalls')
    tally('compileShader', 'compileShader')
    tally('linkProgram', 'linkProgram')
    tally('readPixels', 'readPixels', 'syncCalls')
    tally('getError', 'getError', 'syncCalls')
    tally('getParameter', 'getParameter', 'syncCalls')
    tally('texSubImage2D', 'texSubImage2D', 'textureUploads')
    tally('compressedTexSubImage2D', 'texSubImage2D', 'textureUploads')

    wrap(
      proto,
      'activeTexture',
      (original) =>
        function (this: AnyGl, ...args: never[]) {
          stateOf(this).activeUnit = (args[0] as unknown as number) - 0x84c0
          return original.apply(this, args)
        },
    )

    wrap(
      proto,
      'bindTexture',
      (original) =>
        function (this: AnyGl, ...args: never[]) {
          const state = stateOf(this)
          const target = args[0] as unknown as number
          const texture = args[1] as unknown as WebGLTexture | null
          const key = `${state.activeUnit}:${bindingTarget(target)}`
          counters.bindTexture += 1
          if (state.bound.get(key) !== texture) {
            counters.textureSwitches += 1
            counters.batchBreaks += 1
            state.bound.set(key, texture)
          }
          return original.apply(this, args)
        },
    )

    wrap(
      proto,
      'useProgram',
      (original) =>
        function (this: AnyGl, ...args: never[]) {
          const state = stateOf(this)
          const program = args[0] as unknown as WebGLProgram | null
          counters.useProgram += 1
          if (state.program !== program) {
            counters.programSwitches += 1
            counters.batchBreaks += 1
            state.program = program
          }
          return original.apply(this, args)
        },
    )

    const blend = (name: string) => {
      wrap(
        proto,
        name,
        (original) =>
          function (this: AnyGl, ...args: never[]) {
            const state = stateOf(this)
            const key = `${name}:${(args as unknown as number[]).join(',')}`
            counters.blendFunc += 1
            if (state.blendKey !== key) {
              counters.blendSwitches += 1
              counters.batchBreaks += 1
              state.blendKey = key
            }
            return original.apply(this, args)
          },
      )
    }
    blend('blendFunc')
    blend('blendFuncSeparate')

    const toggle = (name: string, value: boolean) => {
      wrap(
        proto,
        name,
        (original) =>
          function (this: AnyGl, ...args: never[]) {
            const state = stateOf(this)
            if ((args[0] as unknown as number) === BLEND && state.blendEnabled !== value) {
              counters.blendSwitches += 1
              counters.batchBreaks += 1
              state.blendEnabled = value
            }
            return original.apply(this, args)
          },
      )
    }
    toggle('enable', true)
    toggle('disable', false)

    wrap(
      proto,
      'bindFramebuffer',
      (original) =>
        function (this: AnyGl, ...args: never[]) {
          stateOf(this)
          counters.bindFramebuffer += 1
          // 绑到 null 是「回到默认帧缓冲」，也就是离屏画完了回来，不算一次离屏。
          if (args[1] !== null) counters.offscreenBinds += 1
          return original.apply(this, args)
        },
    )

    wrap(
      proto,
      'texImage2D',
      (original) =>
        function (this: AnyGl, ...args: never[]) {
          const state = stateOf(this)
          counters.texImage2D += 1
          counters.textureUploads += 1
          const raw = args as unknown as unknown[]
          const target = raw[0] as number
          const level = raw[1] as number
          const internalFormat = raw[2] as number
          // 两个重载：9 个及以上参数是显式宽高，6 个参数是从 source（图片、canvas）上读。
          if (raw.length >= 9) {
            const bytes = levelBytes(
              raw[3] as number,
              raw[4] as number,
              internalFormat,
              raw[7] as number,
            )
            setLevel(state, target, level, bytes)
          } else {
            const size = sourceSize(raw[5])
            if (size) {
              const bytes = levelBytes(size.width, size.height, internalFormat, raw[4] as number)
              setLevel(state, target, level, bytes)
            }
          }
          return original.apply(this, args)
        },
    )

    wrap(
      proto,
      'compressedTexImage2D',
      (original) =>
        function (this: AnyGl, ...args: never[]) {
          const state = stateOf(this)
          counters.compressedTexImage2D += 1
          counters.textureUploads += 1
          const raw = args as unknown as unknown[]
          // 压缩纹理的字节数不能按宽高算，只能看喂进去的数据有多大。
          // 两个重载：给 ArrayBufferView 的看 byteLength，给 PBO 偏移的第 7 个参数就是 imageSize。
          const data = raw[6]
          const bytes =
            data && typeof data === 'object' && 'byteLength' in data
              ? (data as ArrayBufferView).byteLength
              : typeof raw[7] === 'number'
                ? raw[7]
                : 0
          setLevel(state, raw[0] as number, raw[1] as number, bytes)
          return original.apply(this, args)
        },
    )

    wrap(
      proto,
      'texStorage2D',
      (original) =>
        function (this: AnyGl, ...args: never[]) {
          const state = stateOf(this)
          const raw = args as unknown as number[]
          // texStorage2D 一次把所有层分配掉，算作第 0 层的一次「上传」记进总量。
          counters.texImage2D += 1
          counters.textureUploads += 1
          setLevel(
            state,
            raw[0] as number,
            0,
            storageBytes(raw[1] as number, raw[3] as number, raw[4] as number, raw[2] as number),
          )
          return original.apply(this, args)
        },
    )

    wrap(
      proto,
      'generateMipmap',
      (original) =>
        function (this: AnyGl, ...args: never[]) {
          const state = stateOf(this)
          const target = args[0] as unknown as number
          const texture = state.bound.get(`${state.activeUnit}:${bindingTarget(target)}`)
          const map = texture ? state.levels.get(texture) : undefined
          const zero = map?.get(`${target}:0`) ?? 0
          if (map && zero > 0) {
            const extra = mipmapExtraBytes(zero)
            counters.textureBytes += extra - (map.get(`${target}:mips`) ?? 0)
            map.set(`${target}:mips`, extra)
          }
          return original.apply(this, args)
        },
    )

    wrap(
      proto,
      'deleteTexture',
      (original) =>
        function (this: AnyGl, ...args: never[]) {
          const state = stateOf(this)
          const texture = args[0] as unknown as WebGLTexture | null
          const map = texture ? state.levels.get(texture) : undefined
          if (texture && map) {
            for (const bytes of map.values()) counters.textureBytes -= bytes
            state.levels.delete(texture)
          }
          return original.apply(this, args)
        },
    )
  }

  if (typeof WebGL2RenderingContext !== 'undefined') {
    install(WebGL2RenderingContext.prototype)
  }
  // WebGL1 只包共有的那些方法。纪律 3.8 要求走 WebGL，正常应当是 WebGL2；
  // 真掉到 WebGL1 时至少绘制调用和纹理上传还数得到，contextSeen 也能反映出来。
  if (typeof WebGLRenderingContext !== 'undefined') {
    install(WebGLRenderingContext.prototype as unknown as WebGL2RenderingContext)
  }

  installed = {
    snapshot: () => ({ ...counters }),
    reset: () => {
      const bytes = counters.textureBytes
      Object.assign(counters, zeroCounters())
      counters.textureBytes = bytes
    },
    uninstall: () => {
      for (const restore of restores) restore()
      installed = null
    },
    contextSeen: () => seen,
  }
  return installed
}
