import type { HeroCard, HeroId } from '@ai-duel/core'
import { z } from 'zod'

/**
 * 七位英雄的 id。名单写死在这里和 core 的 HeroId 里各一份，
 * 两边对不上时下面那句 satisfies 会编译报错——加人要两边一起加。
 */
export const heroIdSchema = z.enum([
  'fei-fei-li',
  'danqi-chen',
  'melanie-perkins',
  'mira-murati',
  'ada-lovelace',
  'margaret-hamilton',
  'grace-hopper',
]) satisfies z.ZodType<HeroId>

/** 一位英雄。 */
export const heroCardSchema = z.object({
  kind: z.literal('hero'),
  id: heroIdSchema,
  name: z.string().min(1),
  enName: z.string().min(1),
  text: z.string().min(1),
  skillName: z.string().min(1),
  skillText: z.string().min(1),
  // 只标 true 的字段，含义见 core 的 HeroCard.comingSoon。
  comingSoon: z.boolean().optional(),
  // 只有已实装的几位才写（定位得等技能真打起来才谈得上）。
  roleText: z.string().min(1).optional(),
}) satisfies z.ZodType<HeroCard>

/**
 * 整张英雄表。
 *
 * 键必须和英雄自己的 id 对得上，理由同卡表：选英雄界面遍历这张表，
 * 对局里按 `PlayerState.hero` 查表，两条路径不能给出不同的人。
 * 用 record 而不是 z.object 逐个列 7 位：那样等于把名单抄第三遍。
 */
export const heroTableSchema = z
  .record(heroIdSchema, heroCardSchema)
  .refine((heroes) => Object.entries(heroes).every(([id, hero]) => hero?.id === id), {
    message: '英雄表的键和英雄自己的 id 对不上',
  })
