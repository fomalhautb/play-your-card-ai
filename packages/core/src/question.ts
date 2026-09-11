/**
 * 题目和答题结果的类型。
 *
 * 题目是这个游戏里隐藏信息的大头：整份题序连答案一起放在 `GameState.questions` 里，
 * 哪一刻该把哪一半给谁看全由 view.ts 决定，这里只定形状、不管遮挡。
 *
 * 和这一组别的类型文件一样必须是纯数据、可 JSON 序列化，理由见 types.ts 的文件头。
 */

import type { InstanceId } from './cards'

/** 题目类别。界面右侧常驻的「下一题：XX」显示的就是它。 */
export type QuestionCategory =
  | 'meme' // 梗题：谐音、断句、望文生义那一类
  | 'bias' // 刻板印象：题面故意不给关键信息，看模型会不会自己补一个
  | 'life' // 生活类：日常场景里的常识和空间想象

export interface Question {
  id: string
  category: QuestionCategory
  text: string
  /**
   * 从题面提炼的几个关键词，出牌阶段就公开（题面本身要等双方出完牌才揭晓）。
   *
   * 它是出牌阶段唯一的情报：玩家只能靠这几个词猜这道题考什么方向、该派哪张 AI 上场。
   * 所以词要指向题目的**考点**（「谐音梗」「性别判断」），不要泄题也不要写成同义复述。
   */
  keywords: string[]
  /**
   * 正确答案。**它是隐藏信息**：整份题库连答案一起放在服务端权威的 `GameState` 里，
   * 但发给某一方之前必须过一遍 view.ts 的 `viewFor` / `filterEvent`，
   * 本轮结算（`ROUND_SCORED`）之后才轮到它公开（《正式版架构》需求第 6 条）。
   *
   * 写成短语而不是整句：结算界面把它当大字标题排版，长句会挤成两三行。
   * 说明的部分放到 explanation 里。
   */
  answer: string
  /**
   * 标准答案下面那行小字，讲清楚"为什么是这个答案"。
   * 和 answer 分开是排版需要：一行大字 + 一行小字，两者不能揉进同一个字段。
   */
  explanation: string
}

/**
 * 题面已经揭晓、本轮还没结算时能看到的那半道题：答案和解析仍然遮着。
 *
 * 字段一个个写出来而不是 `Omit<Question, 'answer' | 'explanation'>`：
 * 以后往 `Question` 上加字段时 Omit 会把新字段自动算进"公开的这一半"，
 * 而"新字段该不该公开"是每次都要重新决定一次的事，不该被类型工具替我们决定。
 */
export interface PublicQuestion {
  id: string
  category: QuestionCategory
  text: string
  keywords: string[]
}

/** 一次答题的结果，由房主/本地 driver 生成后喂进引擎。 */
export interface AnswerResult {
  instanceId: InstanceId
  correct: boolean
  /** 这个 AI 的回答本身，一个短语。结算界面拿它当大字排版，所以别写成整段话。 */
  answer: string
  /** 这个 AI 给出的理由，两行以内的小字，排在 answer 下面。 */
  reasoning: string
}
