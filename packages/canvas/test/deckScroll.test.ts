/**
 * 两块滚动区那点算术（`scenes/deck/scroll.ts`）。
 *
 * 正式版简化第 4 步之四把桌面档的卡池和牌组栏从翻页换回黑客松那一版的纵向滚动，
 * 「滚到底停住」「甩一下之后滑多久」「滑块画多长」这几条是滚动手感的全部，
 * 也最容易改坏，所以它们在这里逐条钉住——纯数字，不用起浏览器。
 */

import { describe, expect, it } from 'vitest'
import type { GridSpec } from '../src/layout/gridMath'
import {
  contentHeight,
  firstVisibleRow,
  maxScroll,
  rowStep,
  ScrollState,
  scrollInsertIndex,
  thumbSpan,
} from '../src/scenes/deck/scroll'

/** 照桌面档牌组栏那一套：2 列、格 206×309、行间距 10。 */
const GRID: GridSpec = {
  x: 0,
  y: 0,
  columns: 2,
  rows: 10,
  cellWidth: 206,
  cellHeight: 309,
  gapX: 10,
  gapY: 10,
}

describe('内容有多高', () => {
  it('按列数折行算，最后一行不带行间距', () => {
    expect(rowStep(GRID)).toBe(319)
    expect(contentHeight(GRID, 0)).toBe(0)
    expect(contentHeight(GRID, 1)).toBe(309)
    expect(contentHeight(GRID, 2)).toBe(309)
    expect(contentHeight(GRID, 3)).toBe(309 * 2 + 10)
    expect(contentHeight(GRID, 20)).toBe(309 * 10 + 10 * 9)
  })

  it('内容比窗口矮就滚不动', () => {
    expect(maxScroll(600, 300)).toBe(0)
    expect(maxScroll(600, 900)).toBe(300)
  })
})

describe('滚到哪一行', () => {
  it('露了半行也算那一行已经进了窗口', () => {
    expect(firstVisibleRow(0, 319)).toBe(0)
    expect(firstVisibleRow(318, 319)).toBe(0)
    expect(firstVisibleRow(319, 319)).toBe(1)
    expect(firstVisibleRow(700, 319)).toBe(2)
  })

  it('点「＋」落在视野里第一格；视野滚过了牌组末尾就接在末尾', () => {
    expect(scrollInsertIndex(0, GRID, 20)).toBe(0)
    // 滚过一行 = 两格。
    expect(scrollInsertIndex(319, GRID, 20)).toBe(2)
    expect(scrollInsertIndex(700, GRID, 20)).toBe(4)
    // 牌组只有 3 张，视野却滚到了第三行：接在末尾。
    expect(scrollInsertIndex(700, GRID, 3)).toBe(3)
  })
})

describe('滑块', () => {
  it('内容没超出窗口时滑块满格（调用方按它把整条收起来）', () => {
    expect(thumbSpan(600, 600, 400, 0)).toEqual({ y: 0, height: 600 })
  })

  it('长度按窗口占内容的几成算，位置按滚到哪儿算', () => {
    const top = thumbSpan(600, 300, 900, 0)
    expect(top.height).toBeCloseTo(200, 5)
    expect(top.y).toBe(0)
    const bottom = thumbSpan(600, 300, 900, 600)
    expect(bottom.y).toBeCloseTo(400, 5)
  })

  it('内容很长时滑块有最小长度，不会缩成一粒灰尘', () => {
    const span = thumbSpan(600, 100, 100000, 0)
    expect(span.height).toBe(26)
  })
})

describe('跟手和惯性', () => {
  function ready(): ScrollState {
    const state = new ScrollState()
    state.setContent(600, 1800)
    return state
  }

  it('滚动量夹在 0 和上限之间', () => {
    const state = ready()
    expect(state.max).toBe(1200)
    expect(state.scrollBy(-100)).toBe(false)
    expect(state.offset).toBe(0)
    state.scrollBy(500)
    expect(state.offset).toBe(500)
    state.scrollBy(5000)
    expect(state.offset).toBe(1200)
    // 已经到底了，再滚一次什么都不会变。
    expect(state.scrollBy(10)).toBe(false)
  })

  it('内容缩短时滚动量跟着夹回来', () => {
    const state = ready()
    state.scrollBy(1200)
    expect(state.setContent(600, 800)).toBe(true)
    expect(state.offset).toBe(200)
  })

  it('指针往下走内容就跟着往下走（滚动量减）', () => {
    const state = ready()
    state.scrollBy(400)
    state.beginDrag(500, 0)
    state.dragTo(460, 16)
    // 手指往上划 40，内容往上走 40。
    expect(state.offset).toBe(440)
    state.dragTo(560, 32)
    expect(state.offset).toBe(340)
  })

  it('松手之后带着速度滑一段，然后自己停住', () => {
    const state = ready()
    state.beginDrag(600, 0)
    // 16 毫秒划了 32 像素 ≈ 每秒 2000 像素。
    state.dragTo(568, 16)
    state.endDrag()
    expect(state.advance(16)).toBe(true)
    expect(state.offset).toBeGreaterThan(32)
    /*
     * 自己会停，而且停得够快：时间常数 0.325 秒，从每秒 2000 像素衰减到停住判据
     *（每秒 40 像素）约 1.3 秒，也就是八十来帧。两百帧还不停就是哪里在空转。
     */
    let frames = 0
    while (state.advance(16) && frames < 200) frames += 1
    expect(frames).toBeGreaterThan(60)
    expect(frames).toBeLessThan(110)
  })

  it('手还按着的时候帧循环不许停', () => {
    const state = ready()
    expect(state.held).toBe(false)
    state.beginDrag(0, 0)
    expect(state.held).toBe(true)
    expect(state.advance(16)).toBe(true)
    state.endDrag()
    expect(state.held).toBe(false)
  })

  it('两次事件落在同一毫秒时不会算出无穷大的速度', () => {
    const state = ready()
    state.beginDrag(600, 100)
    state.dragTo(500, 100)
    state.endDrag()
    // 速度没被写成 Infinity，所以这一下不会直接甩到底。
    state.advance(16)
    expect(state.offset).toBe(100)
  })

  it('滚不动的那一档（手机）松手不留惯性', () => {
    const state = new ScrollState()
    state.setContent(600, 300)
    state.beginDrag(600, 0)
    state.dragTo(400, 16)
    state.endDrag()
    expect(state.offset).toBe(0)
    expect(state.advance(16)).toBe(false)
  })
})
