/**
 * 平台能力的 Context：整个应用共用**同一份** `Platform`。
 *
 * 为什么要从外面传进来而不是在这里 `createWebPlatform()`：壳决定用哪一套实现
 *（网页、Electron、Capacitor 三个壳将来各有各的，见 platform 包的文件头），
 * 而装配层只知道「有这么一份能力」。测试和端到端也靠这一层换成假实现。
 *
 * 一份而不是每处各建一份：音频的静音开关、图片缓存、存储都是**有状态**的，
 * 建两份就会出现「这半边界面静音了、那半边还在响」。
 */

import type { Platform } from '@ai-duel/platform'
import { createContext, type ReactNode, useContext } from 'react'

const PlatformContext = createContext<Platform | null>(null)

export function PlatformProvider({
  platform,
  children,
}: {
  platform: Platform
  children: ReactNode
}) {
  return <PlatformContext value={platform}>{children}</PlatformContext>
}

export function usePlatform(): Platform {
  const platform = useContext(PlatformContext)
  if (platform === null) throw new Error('usePlatform 必须在 PlatformProvider 里用')
  return platform
}
