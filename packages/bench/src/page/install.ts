/**
 * 计数器的安装点。单独一个文件，只为了「最先执行」这一件事。
 *
 * index.html 用一个单独的、排在 main.ts 之前的 script 标签引入它：
 * 多个 type="module" 脚本按文档顺序求值，所以这一整棵图（不含 Pixi）会先跑完。
 * 不能只靠在 main.ts 里把 import 写在第一行——格式化工具会按字母序重排 import。
 *
 * 为什么非要赶在前面：WebGL 上下文是 renderer.init() 时才创建的，装晚了虽然还能包上原型，
 * 但 Pixi 初始化期间的纹理上传和着色器编译就漏掉了，而那正是这两类计数最密集的时候。
 */

import { installFrameLoopCounter } from '../metrics/frameLoop'
import { installGlCounters } from '../metrics/glCounters'

export const glCounters = installGlCounters()
export const frameLoop = installFrameLoopCounter()
