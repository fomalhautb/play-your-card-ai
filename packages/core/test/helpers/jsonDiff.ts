/**
 * 找两份 JSON 数据的**第一处**差异，说成一句人能读的话。
 *
 * 回放测试用它代替 `expect(a).toEqual(b)`：golden 里一局有几百条事件，
 * 整份对象一起打出来根本看不出改的是哪一个字段，而回放对不上时要回答的正是
 * 「哪一步、哪条事件、哪个字段变了」。
 */

/** 值在报错信息里怎么显示：字符串带引号，对象压成一行，太长的截断。 */
function show(value: unknown): string {
  const text = JSON.stringify(value) ?? 'undefined'
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

/**
 * 相同返回 null，不同返回第一处差异的描述（如 `[3].correct: 期望 true，实际 false`）。
 * 深度优先、按下标和键序往下走，所以"第一处"就是事件流里最早出问题的那个字段。
 */
export function firstDifference(expected: unknown, actual: unknown, path = ''): string | null {
  if (Object.is(expected, actual)) return null
  const at = path === '' ? '整体' : path

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return `${at}: 期望 ${show(expected)}，实际 ${show(actual)}`
    }
    const shared = Math.min(expected.length, actual.length)
    for (let i = 0; i < shared; i++) {
      const diff = firstDifference(expected[i], actual[i], `${path}[${i}]`)
      if (diff !== null) return diff
    }
    if (expected.length !== actual.length) {
      return `${at}: 期望 ${expected.length} 项，实际 ${actual.length} 项（多出/少掉的第一项是 ${show(
        expected.length > actual.length ? expected[shared] : actual[shared],
      )}）`
    }
    return null
  }

  const bothObjects =
    typeof expected === 'object' &&
    expected !== null &&
    typeof actual === 'object' &&
    actual !== null
  if (bothObjects) {
    const left = expected as Record<string, unknown>
    const right = actual as Record<string, unknown>
    // 键取并集：少一个字段和多一个字段都要报出来（引擎里的可选字段就是这么丢的）。
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])]
    for (const key of keys) {
      const diff = firstDifference(left[key], right[key], path === '' ? key : `${path}.${key}`)
      if (diff !== null) return diff
    }
    return null
  }

  return `${at}: 期望 ${show(expected)}，实际 ${show(actual)}`
}
