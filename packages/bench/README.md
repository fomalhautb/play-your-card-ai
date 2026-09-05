# @ai-duel/bench

《正式版架构》6.9 的性能剧本。它是测量工具，不是游戏的一部分，不进任何平台的构建产物。

6.9 把性能拆成两类：**确定性指标**机器无关、用硬上限断言；**时间指标**机器相关、只出数不设门禁。
两类都建立在同一个前提上——一段确定性的剧本。没有它，所有数字都是噪声。

## 怎么跑

```bash
pnpm --filter @ai-duel/bench test     # Node 侧纯逻辑的单元测试，不开浏览器
pnpm --filter @ai-duel/bench bench    # 确定性指标 + 稳态堆分配 + 泄漏（无头）
pnpm --filter @ai-duel/bench timing   # 时间指标（有头、开 GPU、录 trace）
pnpm --filter @ai-duel/bench dev      # 只把测量页面跑起来，手动在控制台调 window.__bench
```

`bench` 和 `timing` 都由 Playwright 拉起 Vite（`playwright.config.ts` 的 `webServer`），不用先手动开服务器。
卡面图集不在位时也由 Playwright 的 `globalSetup` 自己跑一遍 `pnpm assets:build`（见 `src/node/ensureAtlas.ts`）。
第一次跑要先 `pnpm exec playwright install chromium`。

`dev` 起的页面默认也是真实场景，`?scene=stub` 切到桩场景。

`timing` 还需要本机有 [uv](https://docs.astral.sh/uv/)（`brew install uv`）：帧数据用 Perfetto 的
trace_processor 提取，脚本是 `scripts/frames.py`，由 `uv run --with perfetto python` 跑，不用预装 Python 依赖。
没有 uv 时这一组整组跳过，不会失败。

## 结构

```
src/
  scene/       契约（contract.ts，从 canvas 重新导出）、图集地址、纹理、桩场景
  scenarios/   剧本：驱动循环 + 对局那三段
  metrics/     WebGL 计数器、rAF 计数器、差分与汇总（纯逻辑）
  page/        跑在浏览器里：装计数器、建场景、量过度绘制，产出 window.__bench
  node/        跑在 Node 里：判阈值、解析 trace、出报告（纯逻辑）
  thresholds.ts  6.9 表的全部上限，只在这里改
test/          vitest 单元测试（pnpm test 只跑这里）
tests/         Playwright 用例（deterministic / timing 两个 project）
scripts/       frames.py：从 Chrome trace 里取帧
```

被测场景通过 `src/scene/contract.ts` 的契约接进来，契约的真身在 `@ai-duel/canvas`，
这个文件只是重新导出，好让 bench 里的模块都不直接 import canvas。

默认跑的是 canvas 包的**真实对局场景**（`createDuelPrototype`），纹理从 `public/atlas/` 的卡面图集加载。
另有一个**桩场景**（`stubScene.ts`，几十个 Pixi 精灵、程序生成的纯色卡面）：它是测量骨架自测的固定物，
真实场景一改所有数字都会跟着变，那时候分不清是场景退步了还是计数器坏了，桩场景是唯一不跟着变的对照组。
切换方式两条，都不用改代码：页面 URL 加 `?scene=stub`，或者 `init()` 时传 `scene: 'stub'`
（`tests/deterministic.spec.ts` 里留了一条桩场景的冒烟用例，主力用例跑的是真实场景）。

## 每个指标怎么来的

计数器的做法是包一层 `WebGL2RenderingContext.prototype`（`src/metrics/glCounters.ts`），
在 Pixi 创建上下文**之前**装好（`src/page/install.ts`，由 index.html 用单独一个 script 标签先引入）。
每帧在 `scene.step()` 前后各取一次快照，做差得到这一帧干了什么（`src/page/benchApi.ts` 的 `record`）。

| 6.9 表里的指标 | 怎么测 | 代码位置 |
|---|---|---|
| 每帧绘制调用数 | 数 `drawArrays` / `drawElements` / 两个 instanced 变体 | `metrics/glCounters.ts` `tally(...)` |
| 合批被打断次数 | 数纹理绑定、着色器切换、混合模式切换里**真的换了**的那些 | `glCounters.ts` `bindTexture` / `useProgram` / `blend` / `toggle` |
| 离屏渲染次数 | 数 `bindFramebuffer` 里绑到非 null 的那些 | `glCounters.ts` `bindFramebuffer` |
| 过度绘制倍数 | 全场景换 1×1 白纹理、tint `0x010101`、叠加混合，渲进 RenderTexture 再读回，红通道均值 | `page/overdraw.ts` |
| 动画期间纹理上传次数 | 数 `texImage2D` / `texSubImage2D` / `compressedTexImage2D` | `glCounters.ts` |
| 常驻纹理内存 | 按格式和宽高累加已上传的每一层，`deleteTexture` 时减掉 | `metrics/textureBytes.ts` + `glCounters.ts` `setLevel` |
| 运行期着色器编译 | 数 `compileShader` / `linkProgram` | `glCounters.ts` |
| 同步阻塞调用 | 数 `readPixels` / `getError` / `getParameter` | `glCounters.ts` |
| 动画期间文字对象重建 | 场景自己数，走契约的 `counters().textCreated` | `scene/contract.ts` |
| 稳态每帧堆分配 | CDP `HeapProfiler.startSampling` 采样，除以动作帧数 | `tests/harness.ts` `createHeapSampler` |
| 空闲时帧循环 | 剧本跑完再空转若干帧，看 `renders`、`frameRequests`、rAF 三个计数还涨不涨 | `metrics/frameLoop.ts` + `metrics/diff.ts` `summarize` |
| 泄漏 | 连跑十轮后 `HeapProfiler.collectGarbage`，比堆和常驻纹理内存 | `tests/deterministic.spec.ts` |
| 帧时间 p50/p95/p99、卡顿帧 | Chrome trace 里的 `PipelineReporter`，取上屏时刻的相邻间隔 | `scripts/frames.py` + `node/trace.ts` |
| 主线程脚本时间 | trace 里 `CrRendererMain` 上的 JS 切片，合并重叠区间后求和 | `scripts/frames.py` `merge_total_ms` |
| GPU 每帧耗时 | `EXT_disjoint_timer_query_webgl2` 包住每次 `render` | `page/renderProbe.ts` |

几个容易看走眼的地方：

- **「调用」和「切换」是两回事。** Pixi 会反复把同一张纹理绑到同一个槽上，那不打断合批。
  6.9 表的「合批被打断次数」看的是切换，两个数都记着，报告里用切换。
- **常驻纹理内存是水位不是速率。** `diffCounters` 对它取的是快照值而不是差值，
  否则「这一帧没新传纹理」会让它显示成 0，那条预算就永远通过。
- **过度绘制为什么要换成白纹理。** 它量的是填充率，透明像素照样过片元着色器。
  按原图算等于把圆角、镂空的地方当没画。另外 tint 和 alpha 在 Pixi 里是逐层相乘的，
  所以只有真正会画东西的节点（`ViewContainer`）涂 1/255，中间的容器要恢复成不染色。
- **剧本结束后才采一次过度绘制是不够的**：命中特效和全屏发光在中途才叠起来。
  所以动作期间每隔若干帧采一次，`overdraw()` 返回其中最大的那次。
- **最危险的结果是「假绿」。** 计数器没接管到上下文、剧本一帧都没渲染、根本没空转，
  这三种情况下每一条上限都会顺利通过。所以每段剧本额外断言 `contextSeen()` 为真、
  渲染次数大于 0、空转帧数大于 0。

## 剧本

`src/scenarios/duel.ts` 里现在有三段，每段可以单独跑：

| 名字 | 内容 |
|---|---|
| `deal` | 开局发 8 张 |
| `play10` | 连续出牌十次，中间穿插 hover |
| `flip` | 翻面三张，其中一张翻回去 |

6.9 还列了一轮结算、牌组编辑滚动、开包，那几段要等对应场景写出来。
加法是：新开一个文件、按 `Scenario` 写好，在 `scenarios/index.ts` 的 `SCENARIOS` 上登记一行。

每段的 `setup` 不计入指标——它只是把场景摆到被测动作开始前的样子。
驱动写法是固定的：发起动作 → 一帧一帧 `step(16.667)` 到动作的 Promise 兑现 → 再推到 `isIdle()`。
剧本结束后再空转 30 帧，检查帧循环真的停了。

视口两档，在 `src/node/profiles.ts`：桌面 1920×1080 倍率 1.5 档位 `high`，手机 390×844 倍率 1.5 档位 `low`。

## 阈值在哪改

全在 `src/thresholds.ts`，每条都标了它对应《正式版架构》第 3 节的哪条纪律。
6.9 表里原来写「按验证结果定」的那几行已经用真实场景的验证结果填实了（迁移第 3 条，
口径是实测峰值留约 1.5 倍余量再取整），数字和架构文档 6.9 那节对得上，改这里要同时改那边。
`todo` 字段留给以后新加的指标当占位标记，跑批结束时还带着 `todo` 的会单独列在报告里。

别为了让某条过而放宽这里：这些上限就是纪律本身，放宽等于把纪律删了。场景改完超了，要改的是场景。

## 结果文件

写在 `results/`（已 gitignore，每台机器各跑各的）：

- `deterministic.json` / `deterministic.md`：每个视口每段剧本一行，附超限条目和还没填实的占位上限。
- `timing.json` / `timing.md`：帧时间 p50/p95/p99、卡顿帧、管线延迟 p95、主线程脚本时间、GPU 每帧耗时。

JSON 的形状就是 `src/node/report.ts` 里的 `DeterministicReport` 和 `TimingReport`，
以后接 github-action-benchmark 做趋势和回归门禁（6.12）直接喂它。

## 已知的局限

- **无头 Chromium 走 SwiftShader 软件渲染**，所以确定性那一组只测确定性指标，时间快慢在那里没有意义。
  这是有意选的：软件渲染跨机器一致，而 6.9 要求「同一段剧本在任何机器上的确定性指标一模一样」。
- **时间指标默认在 4 倍 CPU 节流下测**（6.9 要求四到六倍，近似 2018 年中端安卓）。
  它不节流 GPU，所以只约束 JS 一侧。要不节流地跑一遍：`BENCH_CPU_THROTTLE=1 pnpm --filter @ai-duel/bench timing`。
- **帧时间取的是上屏间隔，不是管线延迟**。`PipelineReporter` 自己的时长是一帧从 BeginFrame 到上屏的延迟，
  两三帧会同时在管线里，所以那个数远大于 16.7ms 也属正常；它作为 `pipelineP95` 单独一列。
  没有内容更新的那些 BeginFrame（`STATE_NO_UPDATE_DESIRED`）不算帧——它们恰恰是「帧循环停了」的证据。
- **换 Chrome 版本可能让帧事件对不上**。`frames.py` 有一串候选源，用了哪个会写进结果的 `source` 字段，
  各候选各有多少行写进 `diagnostics`。第一遍会带 `--explain` 把 trace 里切片最多的 track 打到终端。
  换了 `source` 的两次结果不能直接比。
- **trace_processor 第一次跑要联网**：它会去 Google 的存储桶下一个 `trace_processor_shell` 可执行文件，之后有缓存。
- **`EXT_disjoint_timer_query_webgl2` 不一定有**。没有就在报告里写「不可用」加原因，不算失败。
- **泄漏那条的 JS 堆基线取在空跑十几轮之后**。每轮都新建又销毁一个 WebGL 上下文和一整套 Pixi 系统，
  头十几轮各种池子和缓存要涨到高水位，之后还剩每轮约 25 KB 的残留（Pixi / 浏览器侧，不是场景的）。
  常驻纹理内存那条不受影响，它一直精确回到 0。
- **过度绘制只处理能临时改掉外观的对象**（tint、混合模式、精灵纹理）。
  用了自定义 Shader、Mesh 或 Filter 的对象换不掉，会按原样画进去，数字偏小。
  真实场景现在覆盖得全：场景图里只有 Container 和 Sprite，边框、圆章、烟尘、文字全是预烤纹理的精灵，
  一个 Graphics、Mesh、Filter 都没有（3.1 不许挂 Filter）。哪天场景里加了这三种东西，这条要重新确认。
- **文字纹理的大小和机器有关**。字体光栅化在不同系统上略有差别，所以「常驻纹理内存」这条在跨机器比较时
  会有几百 KB 的浮动。预算留了足够余量，但两台机器的这一项不必强求完全相同。
- **抓 Pixi 场景靠的是包 `WebGLRenderer.prototype.render`**（`page/renderProbe.ts`），
  前提是 bench 和 canvas 解析到同一份 pixi.js。版本对不上时 `overdraw()` 会明说「没抓到场景」而不是给假数字。
