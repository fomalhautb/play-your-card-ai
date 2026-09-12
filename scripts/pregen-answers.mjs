#!/usr/bin/env node
// 离线预生成脚本：用 OpenRouter 跑「题目 × 模型 × 变体」的全组合，把 AI 的答题结果存成 JSON。
// 游戏运行时直接读这份 JSON 播放，不再联网调模型，所以对战过程没有网络延迟和额度消耗。
//
// 用法：
//   node scripts/pregen-answers.mjs                       跑全部 8 题 × 16 模型 × 3 变体 = 384 个组合
//   node scripts/pregen-answers.mjs --smoke               只跑 1 个组合，用来验证 API 链路是否通
//   node scripts/pregen-answers.mjs --variants a,b        只跑指定变体（逗号分隔 id，拼错直接报错退出）
//   node scripts/pregen-answers.mjs --models a,b          只跑指定模型（同上；补跑某个模型的失败格子用）
//   node scripts/pregen-answers.mjs --questions a,b       只跑指定题目（同上；配合 --models 精确补跑单个格子）
//   node scripts/pregen-answers.mjs --out banana.json     输出文件名（固定写到 scripts/out/ 下）
//
// 三张数据表（模型 / 题目 / 变体）在同目录的 pregen-data.mjs 里，
// build-core-answers.mjs 也从那儿读同一份，免得注入词改了两处说法对不上。

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MODELS, QUESTIONS, VARIANTS } from './pregen-data.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(SCRIPT_DIR, '..')
const OUT_DIR = join(SCRIPT_DIR, 'out')

const API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MAX_ATTEMPTS = 3 // 单个组合最多尝试 3 次
// 推理模型出思维链很慢，豆包给到 16000 配额后更慢，所以给足 5 分钟。
// 这是离线预生成脚本，等久一点无所谓，超时重跑才是真浪费。
const REQUEST_TIMEOUT_MS = 300_000
const CONCURRENCY = 8
const REASONING_MAX_CHARS = 800 // 思维链只留开头，避免 JSON 撑得太大

// ---------------------------------------------------------------- API key

// 先看环境变量，没有再退回读 worktree 根目录的 .env。
// 无论走哪条路，key 都只往 Authorization 头里塞，绝不进日志或结果 JSON。
async function loadApiKey() {
  const fromEnv = process.env.OPENROUTER_API_KEY?.trim()
  if (fromEnv) return fromEnv

  const envPath = join(REPO_ROOT, '.env')
  let raw
  try {
    raw = await readFile(envPath, 'utf8')
  } catch {
    throw new Error(`未找到 OPENROUTER_API_KEY：环境变量为空，且读不到 ${envPath}`)
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    if (key !== 'OPENROUTER_API_KEY') continue
    // 去掉可能存在的成对引号
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
    if (value) return value
  }

  throw new Error(`${envPath} 里没有非空的 OPENROUTER_API_KEY`)
}

// ---------------------------------------------------------------- 调用

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 粗略估长度、把正文截到大约 limit 个 token。现在所有模型都走这条路（见上面 MODELS 的说明）。
 *
 * 这里不引分词器，只用一条启发式近似 DeepSeek 的分词粒度：非 ASCII 字符（汉字、中文标点、
 * 中文里常用的弯引号）按每字 1 token 算，ASCII（英文字母、数字、半角标点、空白）按每 4 个字符
 * 1 token 算。真实分词当然不长这样——中文常见词会被合并成一个 token，所以这个估法偏保守，
 * 实际留下的内容通常比 30 token 略短。对「答案要短」这个目的来说，宁可短一点，不值得为了估准
 * 去背一份词表。
 *
 * 返回 truncated 是为了在结果里留痕：事后截断和模型自己说完，读 JSON 时得能分清。
 */
function truncateToTokens(text, limit) {
  let cost = 0
  for (let i = 0; i < text.length; i += 1) {
    cost += text.charCodeAt(i) > 0x7f ? 1 : 0.25
    if (cost > limit) {
      return { text: text.slice(0, i).trimEnd(), truncated: true }
    }
  }
  return { text, truncated: false }
}

/**
 * 调一次 OpenRouter，失败按指数退避重试。
 * 非 2xx、网络错误、超时、以及「返回了但 content 是空的」都算失败，
 * 因为空 content 对预生成来说和请求失败没区别，游戏里没法播。
 */
async function callModel({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  reasoning,
  maxTokens,
  truncateAnswerTokens,
}) {
  let lastError

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now()
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: maxTokens,
          stream: false,
          // 只有配了 reasoning 的模型才带这个字段：给不支持的模型传会被上游拒绝。
          ...(reasoning ? { reasoning } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (!response.ok) {
        // 响应体常带具体原因（模型不存在、余额不足等），截断后带进错误信息方便排查。
        const body = await response.text().catch(() => '')
        throw new Error(
          `HTTP ${response.status} ${response.statusText} ${body.slice(0, 500)}`.trim(),
        )
      }

      const data = await response.json()
      // OpenRouter 有时用 200 包一个 error 对象返回上游错误，不是每次都给非 2xx。
      if (data?.error) {
        throw new Error(`API error: ${JSON.stringify(data.error).slice(0, 500)}`)
      }

      const choice = data?.choices?.[0]
      const message = choice?.message
      const raw = typeof message?.content === 'string' ? message.content.trim() : ''
      // 配了 truncateAnswerTokens 的模型在这里事后截；没配的话就原样返回。
      const { text: answer, truncated } = truncateAnswerTokens
        ? truncateToTokens(raw, truncateAnswerTokens)
        : { text: raw, truncated: false }
      // 空 content 照旧算失败重试：max_tokens 压得太狠时配额可能全被思维链吃掉，
      // 截完只剩空串和请求失败一样没东西可播。检查放在截断之后，两种空法都能兜住。
      if (!answer) {
        throw new Error(`返回内容为空：${JSON.stringify(data).slice(0, 500)}`)
      }

      // 推理模型（DeepSeek R1 等）把思维链放在 message.reasoning，普通模型没有这个字段。
      const reasoningRaw = typeof message?.reasoning === 'string' ? message.reasoning.trim() : ''

      return {
        answer,
        // 只有真截了才带这个字段，免得给每条结果都塞一个 false。
        ...(truncated ? { truncated: true } : {}),
        // finish_reason 区分「自己说完」（stop）和「被 API 截断」（length），
        // 读结果时不用靠数字数猜答案为什么断在半句。
        finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
        reasoning: reasoningRaw ? reasoningRaw.slice(0, REASONING_MAX_CHARS) : undefined,
        latencyMs: Date.now() - startedAt,
        usage: data?.usage,
      }
    } catch (error) {
      lastError = error
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000 * 2 ** (attempt - 1)) // 1s, 2s
      }
    }
  }

  throw lastError
}

// ---------------------------------------------------------------- 并发池

// 最多同时跑 limit 个任务；每个任务结束后立刻补下一个进来。
async function runPool(tasks, limit) {
  const results = new Array(tasks.length)
  let cursor = 0

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor
      cursor += 1
      results[index] = await tasks[index]()
    }
  })

  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------- 主流程

// 取 `--name 值` 或 `--name=值`，没传返回 undefined。
function readFlag(name) {
  const argv = process.argv
  const prefix = `--${name}`
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === prefix) return argv[i + 1]
    if (argv[i].startsWith(`${prefix}=`)) return argv[i].slice(prefix.length + 1)
  }
  return undefined
}

// --variants / --models / --questions 是同一件事「只跑列出来的那几个」，共用这一个筛子。
// 拼错 id 直接抛错退出并列出可选值，不然只会安静地少跑一批，等发现结果不全时额度已经花掉了。
function selectByIds(flagName, all, label) {
  const flag = readFlag(flagName)
  if (flag === undefined) return all

  const wanted = flag
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (wanted.length === 0) {
    throw new Error(`--${flagName} 后面要跟逗号分隔的${label} id`)
  }
  const known = all.map((item) => item.id)
  const unknown = wanted.filter((id) => !known.includes(id))
  if (unknown.length > 0) {
    throw new Error(`未知的${label} id：${unknown.join('、')}；可选：${known.join('、')}`)
  }
  // 按原数组顺序返回，跑的顺序和输出顺序不受命令行里的书写顺序影响。
  return all.filter((item) => wanted.includes(item.id))
}

// --out 指定输出文件名，始终落在 scripts/out/ 下；带路径分隔符时报错而不是悄悄改写。
function resolveOutName(smoke) {
  const flag = readFlag('out')?.trim()
  if (!flag) return smoke ? 'pregen-smoke.json' : 'pregen-answers.json'
  if (flag.includes('/') || flag.includes('\\')) {
    throw new Error(`--out 只接受文件名，不要带路径：${flag}`)
  }
  return flag
}

async function main() {
  const smoke = process.argv.includes('--smoke')
  // 先解析参数再读 key：参数拼错时立刻报错，不用等到读完 key。
  const variants = selectByIds('variants', VARIANTS, '变体')
  const models = selectByIds('models', MODELS, '模型')
  const questions = selectByIds('questions', QUESTIONS, '题目')
  const outName = resolveOutName(smoke)
  const apiKey = await loadApiKey()

  // smoke 只跑一个组合验证链路：洗车题 × ChatGPT 5.6 Sol × 复读机。
  // 挑这个组合是为了一次同时验证两条链路：香蕉变体的 prompt 拼装，和 reasoning 参数是否被接受。
  const combos = []
  for (const question of questions) {
    for (const model of models) {
      for (const variant of variants) {
        if (
          smoke &&
          !(
            question.id === 'q-carwash' &&
            model.id === 'chatgpt-5-6-sol' &&
            variant.id === 'banana-bribe'
          )
        ) {
          continue
        }
        combos.push({ question, model, variant })
      }
    }
  }

  const total = combos.length
  console.log(`开始预生成：${total} 个组合，并发 ${CONCURRENCY}${smoke ? '（smoke 模式）' : ''}`)

  let done = 0
  const tasks = combos.map(({ question, model, variant }) => async () => {
    const label = `${question.id} × ${model.name} × ${variant.id}`
    const base = { questionId: question.id, modelId: model.id, variant: variant.id }
    const startedAt = Date.now()

    try {
      const { answer, truncated, finishReason, reasoning, latencyMs, usage } = await callModel({
        apiKey,
        model: model.openrouter,
        systemPrompt: variant.buildSystem(question),
        userPrompt: variant.buildUser(question),
        reasoning: model.reasoning,
        maxTokens: model.maxTokens,
        truncateAnswerTokens: model.truncateAnswerTokens,
      })
      done += 1
      const mark = truncated ? ' 事后截断' : finishReason === 'length' ? ' API 截断' : ''
      console.log(`[${done}/${total}] ${label} — ok ${(latencyMs / 1000).toFixed(1)}s${mark}`)
      return {
        ...base,
        answer,
        ...(truncated ? { truncated: true } : {}),
        ...(finishReason ? { finishReason } : {}),
        ...(reasoning ? { reasoning } : {}),
        latencyMs,
        usage,
      }
    } catch (error) {
      const latencyMs = Date.now() - startedAt
      done += 1
      const reason = error instanceof Error ? error.message : String(error)
      console.log(
        `[${done}/${total}] ${label} — FAILED ${(latencyMs / 1000).toFixed(1)}s: ${reason}`,
      )
      return { ...base, answer: '', latencyMs, error: reason }
    }
  })

  const results = await runPool(tasks, CONCURRENCY)

  const payload = {
    generatedAt: new Date().toISOString(),
    // models / questions / variants 都只列本次实际跑到的那些（被 --models / --questions / --variants 筛过，
    // smoke 只剩一个），补跑单个格子时输出文件才不会声称自己覆盖了全部模型和题目。
    models,
    questions,
    // buildSystem / buildUser 是函数，序列化会丢，所以变体只导出 id 和名字。
    variants: VARIANTS.filter((v) => combos.some((c) => c.variant.id === v.id)).map(
      ({ id, name }) => ({ id, name }),
    ),
    results,
  }

  await mkdir(OUT_DIR, { recursive: true })
  const outPath = join(OUT_DIR, outName)
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  const failed = results.filter((r) => r.error).length
  console.log(`\n完成：成功 ${results.length - failed} / 失败 ${failed}`)
  console.log(`已写入 ${outPath}`)

  // 有失败也要留下 JSON（成功的部分可以直接用），但用非零退出码让调用方知道没跑全。
  if (failed > 0) process.exitCode = 1
}

// 只有被当命令行脚本直接跑时才发请求。被 import 时（别的脚本要拿上面那三份常量）
// 什么都不做，否则一 import 就会去调 OpenRouter 烧额度。
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  main().catch((error) => {
    console.error(`脚本异常退出：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
