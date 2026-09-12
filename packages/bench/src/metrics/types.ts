/**
 * 指标的数据形状。页面侧产出、Node 侧断言和出报告，两边共用这一份。
 *
 * 字段名直接对应《正式版架构》6.9 的指标表，改名之前先去改文档。
 */

import type { DuelSceneCounters } from '../scene/contract'

/**
 * WebGL 计数器的一次快照。
 *
 * 除 `textureBytes` 外全部是「从计数器安装以来的累计调用次数」，做差就是这一帧的增量。
 * `textureBytes` 是当前常驻量（一个水位，不是速率），做差没意义，见 diffCounters 的说明。
 */
export interface GlCounters {
  /** drawElements / drawArrays 调用次数（不含 instanced）。 */
  drawElements: number
  drawArrays: number
  /** drawElementsInstanced / drawArraysInstanced。 */
  drawInstanced: number
  /** 上面三项之和，就是 6.9 表的「每帧绘制调用数」。 */
  drawCalls: number

  /** bindTexture 的调用次数。 */
  bindTexture: number
  /** 其中真的换了纹理的次数（同一个纹理重复绑不算打断合批）。 */
  textureSwitches: number
  useProgram: number
  programSwitches: number
  /** blendFunc / blendFuncSeparate 调用次数。 */
  blendFunc: number
  /** 其中真的改了混合参数的次数，加上 enable/disable(BLEND) 真的改了开关的次数。 */
  blendSwitches: number
  /** 三种切换之和，就是 6.9 表的「合批被打断次数」。 */
  batchBreaks: number

  /** bindFramebuffer 调用次数。 */
  bindFramebuffer: number
  /** 其中绑到非 null 帧缓冲的次数，就是 6.9 表的「离屏渲染次数」。 */
  offscreenBinds: number

  texImage2D: number
  texSubImage2D: number
  compressedTexImage2D: number
  /** 三者之和，就是 6.9 表的「动画期间纹理上传次数」。 */
  textureUploads: number
  /** 常驻纹理内存（字节），deleteTexture 时减掉。 */
  textureBytes: number

  compileShader: number
  linkProgram: number

  readPixels: number
  getError: number
  getParameter: number
  /** 三者之和，就是 6.9 表的「同步阻塞调用」。 */
  syncCalls: number
}

/**
 * 逐帧记录里场景那部分的增量。
 *
 * 刻意把契约里的 `activeMs` 排掉：它是墙钟时间（帧循环真正跑了多少毫秒），
 * 同一段剧本每次跑都不一样。放进来的话它会顺着 summarize 漏进
 * 「同一台机器跑两遍必须完全一致」那条断言，把一条硬断言变成随机失败。
 * 它只服务开发页现场算帧率，bench 这边不需要（手动时钟下它本来也恒为 0）。
 */
export type SceneDelta = Omit<DuelSceneCounters, 'activeMs'>

/** 一帧的记录。`gl` 和 `scene` 都是这一帧的增量，`textureBytes` 除外（见 GlCounters）。 */
export interface FrameRecord {
  /** 在本段剧本里的帧序号，从 0 开始。 */
  index: number
  /** 'action' 是剧本动作期间，'idle' 是动作跑完之后的空转帧。 */
  phase: 'action' | 'idle'
  gl: GlCounters
  scene: SceneDelta
  /** 这一帧里 requestAnimationFrame 被调用的次数。手动时钟下应当恒为 0。 */
  rafRequests: number
}

/** 一段剧本跑完之后的汇总。所有字段都是确定性指标，同一台机器跑两遍必须完全一致。 */
export interface SegmentSummary {
  segment: string
  frames: number
  idleFrames: number

  /** 动作期间的每帧峰值。 */
  maxDrawCalls: number
  maxBatchBreaks: number
  /**
   * 打断的构成：纹理、着色器、混合模式各自的每帧峰值。
   * 上限只判 maxBatchBreaks，这三个是给「超了先查是谁在打断」用的（纪律 3.9 那句话）。
   * 三者的峰值不一定出现在同一帧，所以它们加起来可以大于 maxBatchBreaks。
   */
  maxTextureSwitches: number
  maxProgramSwitches: number
  maxBlendSwitches: number
  maxOffscreenBinds: number
  /** 动作期间的累计值。表里写「动画期间为 0」的几行都看这个。 */
  textureUploads: number
  shaderCompiles: number
  programLinks: number
  syncCalls: number
  textCreated: number
  /** 常驻纹理内存的峰值和结束时的水位。 */
  peakTextureBytes: number
  endTextureBytes: number
  /** 空闲阶段的增量：这两个不为 0 就说明帧循环没停（纪律 3.6）。 */
  idleRenders: number
  idleFrameRequests: number
  idleRafRequests: number
  /** 动作期间的渲染次数，用来看剧本本身跑没跑起来。 */
  renders: number
}

/** 过度绘制的测量结果，对应 6.9 表「过度绘制倍数」。 */
export interface OverdrawResult {
  /** 每像素平均绘制次数。 */
  average: number
  /** 单像素最大绘制次数，用来找是谁在叠。 */
  max: number
  /**
   * 真正读回的像素数，出问题时用来确认量对不对。
   * 这一趟调试渲染是降分辨率跑的（见 page/overdraw.ts 的 OVERDRAW_SCALE），
   * 所以它比视口的像素数小一大截，不是视口宽 × 高。
   */
  sampled: number
  /** 参与这次调试渲染的可见节点数。全 0 时先看它是不是 0——那说明根本没抓到场景。 */
  nodes: number
  /**
   * 外观换不掉的可见节点数（Graphics、Text 这类，见 page/overdraw.ts）。
   * 它们只被涂上 tint，画出去的还是原来那些深浅不一的像素，加进去的不是整数 1，
   * 所以这个数一旦不是 0，这次的 average 就偏小、不能拿来判上限。
   */
  unswapped: number
}

/** 一次完整测量的产物，就是 window.__bench.metrics() 的返回值。 */
export interface BenchMetrics {
  profile: string
  segment: string
  tier: string
  width: number
  height: number
  resolution: number
  seed: number
  summary: SegmentSummary
  frames: FrameRecord[]
}
