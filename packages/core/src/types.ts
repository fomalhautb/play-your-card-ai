/**
 * 规则引擎的全部数据形状。按领域分成了几份，这一份只负责汇总出去。
 *
 * - cards.ts     卡牌、英雄、内容目录的**定义**（一局之内不变的那部分）
 * - question.ts  题目和答题结果
 * - state.ts     一局的状态：`GameState` 和它里面的每一层
 * - commands.ts  玩家发给引擎的指令
 * - events.ts    引擎产出的事件流，以及统一返回 `ExecuteResult`
 *
 * 裁剪视图那几个类型（`PlayerView`、`QuestionView` 等）**不在这儿**：
 * 它们和唯一产出它们的代码一起放在 view.ts，隐藏信息的完整口径也在那份文件头上。
 *
 * 共同的约束：上面每一份里的类型都必须是纯数据（可 JSON 序列化）。
 * 引擎靠 JSON 深拷贝推进状态，联机时房主也要把状态/事件原样发出去，
 * 一旦混进函数、Map、Date 之类的东西这两条路都会断。
 */

export * from './cards'
export * from './commands'
export * from './events'
export * from './question'
export * from './state'
