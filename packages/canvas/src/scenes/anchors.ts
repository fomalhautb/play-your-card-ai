/**
 * 「屏幕上那样东西现在占哪一块」——各个场景回答新手教程的唯一方式（迁移第 32 条）。
 *
 * 旧版的引导层靠 `document.querySelector('[data-tutorial-anchor=…]')` 找元素再量它的
 * `getBoundingClientRect()`。新版这几页整页画在画布上，DOM 里一个元素都没有，
 * 所以改成**问场景要矩形**：教程只说得出语义名字（「结束出牌那颗钮」「我方战场」），
 * 名字换算成哪一块是场景自己的事。
 *
 * 好处和旧版一样：界面改版、换一档版式，只要那几个名字还答得上来，步骤表一行都不用动。
 */

/** 一块地方，**画布的 CSS 像素坐标**（左上角为原点，和指针事件同一套）。 */
export interface AnchorRect {
  x: number
  y: number
  width: number
  height: number
}
