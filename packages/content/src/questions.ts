/**
 * 题库。
 *
 * 题库长度直接决定一局最多打几轮（totalRounds = 题目数），因为题目在一局里不重复。
 * 但现在一局不一定打满：先到 3 分就结束（见 core 的 WIN_TARGET），
 * 题库只是"最多能打几轮"和加赛的上限。
 *
 * **题面存成 JSON 而不是 TS，是为了让离线预生成脚本也能读同一份**：
 * 对局里 AI 的回答是照这些题面跑出来的（见 script.ts），题面和脚本里的对不上，
 * 玩家看到的题就和 AI 实际被问到的那道不是一道。
 * scripts/pregen-data.mjs 现在直接 import data/questions.json，
 * 于是"两边逐字对齐"从一条要靠人守的规矩变成了同一份文件（《正式版架构》6.4）。
 * id 是查预生成答案表的键，改 id 等于让那张表整行作废，改完要重跑脚本。
 *
 * 每道题的 keywords 是出牌阶段唯一公开的情报（题面要等双方出完牌才揭晓），
 * 所以写的是**考点方向**而不是题面缩写：玩家要靠它判断该派哪张 AI 上场。
 *
 * answer 和 explanation 分成两栏是排版要求：结算界面把 answer 当大字标题、
 * explanation 当它下面那行小字，所以 answer 一律写成短语，理由全部放进 explanation。
 *
 * 「洗车」那道是用户点名要原文保留的梗题，改词会失去梗，别顺手润色。
 */

import type { Question } from '@ai-duel/core'
import questionsJson from './data/questions.json'
import { questionPoolSchema } from './schema/question'

/**
 * 模块加载时就校验一遍：题库坏了要在启动那一刻炸，而不是打到某一轮才发现少个字段。
 * parse 顺带把 JSON 拷贝了一份，外面改这份数组也污染不到模块里那份原始 JSON。
 */
export const QUESTION_POOL: Question[] = questionPoolSchema.parse(questionsJson)
