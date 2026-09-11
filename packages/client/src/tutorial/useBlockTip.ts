/**
 * 「刚才那一下不行」的一句话：说完自己消失。
 *
 * 教程的三段（组牌、选英雄、对战）共用：被锁住的操作点上去**必须有话说**，
 * 否则玩家只会觉得界面坏了。
 *
 * 和引导层那句常驻提示是两回事：那一句说的是「现在该做什么」，一直挂着；
 * 这一句说的是「刚才那一下不行」，说完就消失，两者同时出现也不该互相顶替
 *（所以它是 `TutorialOverlay` 上另一个 prop，见 ui 的 TutorialOverlay.tsx）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** 一句提示显示多久。够读完一句短话，又短到玩家不会以为它是常驻的。 */
const TIP_MS = 2200

export interface BlockTip {
  /** 当前要显示的那句话；null = 不显示。 */
  tip: string | null
  /** 弹一句话。同一句话连点也会重新计时。 */
  notify(message: string): void
}

export function useBlockTip(): BlockTip {
  const [tip, setTip] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 卸载时把还挂着的定时器收掉，免得它落在已经卸载的组件上。
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    [],
  )

  const notify = useCallback((message: string) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    setTip(message)
    timerRef.current = setTimeout(() => {
      setTip(null)
      timerRef.current = null
    }, TIP_MS)
  }, [])

  return { tip, notify }
}
