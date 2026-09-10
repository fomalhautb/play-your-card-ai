# @ai-duel/bench

《正式版架构》6.9 的性能剧本。它是测量工具，不是游戏的一部分，不进任何平台的构建产物。

6.9 把性能拆成两类：**确定性指标**机器无关、用硬上限断言；**时间指标**机器相关、只出数不设门禁。
两类都建立在同一个前提上——一段确定性的剧本。没有它，所有数字都是噪声。

## 怎么跑

```bash
pnpm --filter @ai-duel/bench test             # Node 侧纯逻辑的单元测试，不开浏览器
pnpm --filter @ai-duel/bench bench            # 确定性指标 + 稳态堆分配 + 泄漏（无头）
pnpm --filter @ai-duel/bench interaction      # 交互回归：真指针拖拽出牌、点选目标（无头）
pnpm --filter @ai-duel/bench keyframes        # 剧本关键帧的截图回归（无头）
pnpm --filter @ai-duel/bench keyframes:update # 重新生成本平台的关键帧基线
pnpm --filter @ai-duel/bench timing           # 时间指标（有头、开 GPU、录 trace）
pnpm --filter @ai-duel/bench dev              # 只把测量页面跑起来，手动在控制台调 window.__bench
```

四组 Playwright 用例哪一组进哪一档 CI：`interaction` 和 `keyframes` 进**快档**（都是几分钟、
每个 PR 都该跑），`bench`（确定性指标）进**慢档**并按「视口 × 剧本」拆成一格一格的并行 job，
`timing` 两档都不进，只在本机跑（见下面「时间指标怎么和 main 比」）。

这四组都由 Playwright 拉起 Vite（`playwright.config.ts` 的 `webServer`），不用先手动开服务器。
卡面图集不在位时也由 Playwright 的 `globalSetup` 自己跑一遍 `pnpm assets:build`（见 `src/node/ensureAtlas.ts`）。
第一次跑要先 `pnpm exec playwright install chromium`。

跑批默认**不复用**已经在跑的 Vite。端口是写死的（`vite.config.ts` 的 `strictPort`），
另一个 git 工作树里开着同端口的 bench 服务器时，复用等于静悄悄测了那份代码，
改了什么都「看不出变化」。自己开着 `dev` 想省一次启动就显式打开：
`BENCH_REUSE_SERVER=1 pnpm --filter @ai-duel/bench bench`。

`dev` 起的页面默认也是真实场景，`?scene=stub` 切到桩场景。

`timing` 还需要本机有 [uv](https://docs.astral.sh/uv/)（`brew install uv`）：帧数据用 Perfetto 的
trace_processor 提取，脚本是 `scripts/frames.py`，由 `uv run --with perfetto python` 跑，不用预装 Python 依赖。
没有 uv 时这一组整组跳过，不会失败。

### 跑一遍要多久

确定性那组现在是十条用例：两档视口 × 四段剧本共八格，加桩场景和泄漏各一条。
这台 M2（8 核，其中 4 个性能核）上整批并行跑约 17 分钟，单条（并行时）大致是：

| 剧本 | 桌面档 | 手机档 |
|---|---|---|
| `deal` | 3.1 分钟 | 1.0 分钟 |
| `play10` | 12.9 分钟 | 4.0 分钟 |
| `flip` | 1.9 分钟 | 1.0 分钟 |
| `settle` | 7.1 分钟 | 2.3 分钟 |

桩场景 43 秒；泄漏 5.1 分钟（它要连开二十二轮场景）。

慢的是 SwiftShader 软件光栅：桌面档 1920×1080 按 1.5 倍渲染就是 2880×1620，
软件光栅在这个分辨率上是填充率绑定的，而每条用例要把同一段剧本跑三轮——
逐帧记录一轮、关掉记录做堆采样一轮、再重跑一轮验两遍完全一致。
要再快只能少跑一轮或者降分辨率，那是改口径，不是调参数。

十条用例之间没有耦合（每条各开各的页面和渲染进程），所以按用例粒度并行：
worker 数取核数的三分之一——SwiftShader 的光栅化自己是多线程的，一个页面就占掉约三个核，
再往上加只是让 worker 互相抢核。CI 上写死 2。要串行排查问题就加 `--workers=1`。
`timing` 那组照旧串行单 worker：它有头、量的是帧时间，两个浏览器同时抢 GPU，数字立刻变噪声。

并行省下来的没有想象中多，因为总时间被最慢的一条用例卡住：`desktop/play10` 单独跑 6.8 分钟，
并行时被抢核拖到 12.9 分钟，它跑多久整组就至少跑多久。单条超时因此按**并行时**的最慢一条
给到 15 分钟——按单独跑的 6.8 分钟去估会当场超时。

这也是 CI 慢档把它们按「视口 × 剧本」拆成一格一格并行 job 的原因（`.github/workflows/slow.yml`）：
一格一台跑机，谁也不抢谁的核，墙钟时间就是最慢那一格自己的时间。

并行带来的一个连锁改动：每条用例算出的那一行不能自己写进 `results/`。
每个 worker 是独立进程，各写各的只会互相覆盖，报告里只剩一个 worker 那几行。
现在用例把自己那行挂成附件，由跑在主进程的 reporter 收齐了再写（`src/node/deterministicReporter.ts`）。

## 剧本关键帧的截图回归（6.6）

`tests/keyframes.spec.ts` 把四段剧本各停在一个固定帧号上截一张图，和 `baselines/{平台}/` 逐像素比，
差异比例的口径和目录页一致（`maxDiffPixelRatio` 0.001）。

和目录页那条的分工：目录页拍的是**静止**的版式（组件、整局停在发牌完成 / 出牌中 / 结算层打开），
这一条拍的是**演出途中**——牌飞到一半、展示层刚立起来、结算层正在逐行盖章。
那几拍上出岔子（落点算错、层没开、字没出来）在静止帧上一个都看不出来。

几个决定：

- **画面从 Pixi 的 `extract` 抓，不走 `page.screenshot()`**（`src/page/grabFrame.ts`）。
  WebGL 画布默认不保留绘制缓冲，截屏可能拿到空白；而 `extract` 是重新渲染一遍到离屏纹理再读回，
  和浏览器合成器的时机无关。它还**同步**，可以直接卡在剧本的两帧之间抓，不用把剧本停下来再恢复。
- **基线按逻辑像素的一半存**（`SHOT_SCALE`）。这条要拦的是「这一刻画面对不对」，
  逐像素级的字形回归由目录页负责；半倍之后桌面档一张从八百多 KB 降到两百 KB。
  差异比例的口径不受影响——0.001 是比例，分母跟着一起缩。
- **抓齐最后一张就收工**，不把剧本跑完。`play10` 一遍是一千五百多帧，而关键帧都排在前一两百帧里。
- **一段只停一帧**。第一版每段停两帧，晚的那一帧排在 f200～f420；而一条用例的开销由
  最后那个停帧决定（抓齐就收工），所以晚的那一帧把渲染量翻了三到五倍。
  本机看着还行，两核跑机上整组连 10 分钟都跑不完（八条一条都没完）。
  砍掉之后留下的四帧仍然都是「正在演」的时刻；演出后半程那几拍暂时没人看着，
  要补回来得先让这一组变快。
- 帧号写在 spec 的 `PLANS` 里。改了 `director/timings.ts` 的时长，那些帧号可能落到别的一拍上，
  基线要跟着重拍——这正是它该拦下来的那种改动。
- **CI 快档里按剧本段拆成四个并行 job**（`.github/workflows/ci.yml`）。桌面档一条在两核跑机上
  要三四分钟，八条挤一台机器十三四分钟，一格一台才装得进快档的 10 分钟。
  每条用例挂了 `@剧本段` 标签，那是工作流的接口，改名字会让那一格静悄悄地少跑。

### 基线怎么刷新

基线按平台分目录（`baselines/darwin`、`baselines/linux`），因为字体光栅化在 macOS 和 Linux 上
对不齐，一份基线两边一定比不过。两份都要提交进仓库，CI 比的是 `linux` 那份。

- **darwin**：本机 `pnpm --filter @ai-duel/bench keyframes:update`，看过 diff 再提交。
- **linux**：手动触发 `.github/workflows/bench-baselines.yml`：

  ```bash
  gh workflow run bench-baselines.yml
  gh run download <run id> -n keyframes-baselines-linux -D packages/bench/baselines/linux
  ```

  下载下来覆盖到 `packages/bench/baselines/linux/`，看过图再提交。
  快档那一步**不会**帮你生成——有基线的时候它只比对，红了只给你一份 `keyframes-diff`。

**第一份 linux 基线是个例外，`gh workflow run` 那条这时候还用不了。**
GitHub 按**默认分支上的那一份**工作流文件注册 `workflow_dispatch`，
所以 `bench-baselines.yml` 只有在自己已经合进 main 之后才手动触发得了；
在那之前跑这条命令只会得到一句「工作流不存在」。
这段时间里 linux 基线从**快档 `keyframes` job 第一次运行**传出来的 artifact 里取——
仓库里还没有 `baselines/linux/` 时那一步走的是「只生成不比对」，正好把整份基线生成出来
传上去（见 `.github/workflows/ci.yml`）。快档那个 job 按剧本段拆成了四格，
每格各传一份 artifact（同名 artifact 一次运行里只允许一个），所以要四份都取下来：

```bash
gh run download <快档那次的 run id> -p "keyframes-baselines-linux-*" -D /tmp/kf
cp /tmp/kf/*/*.png packages/bench/baselines/linux/
```

基线一提交，那四格下次就自动改走真比对了。

## 交互回归（6.6 第 2 条）

`tests/interaction.spec.ts` 不量任何指标，它借这里现成的骨架（页面、图集、手动时钟、
`window.__bench`）做**真指针**的回归：拖一张牌进落区、拖到区外、技能牌选目标、点空白取消、
点「结束出牌」按钮，外加触屏的拖拽和轻点各一条。
断言的是场景发出的指令（`window.__bench.commands()`）。

纯逻辑那一半在 canvas 的 `test/duelInput.test.ts` / `test/duelTargeting.test.ts`（vitest，
组件是替身）。两边分工：那边保证「判定对」，这边保证「点得到」——第一版跑起来就抓到两处
只有真浏览器才暴露得出来的问题（选目标层吃掉了候选的点击、命中点落在卡牌命中区的边线上）。

「按屏幕哪个坐标点得到某张卡」由 `src/page/hitPoints.ts` 回答：从场景树上按 label 找到目标
（卡是 `card:<实例 id>`、格子是 `tile:<实例 id>`、「结束出牌」是 `button:end-play`），
再用 Pixi 自己的命中测试验一遍那个**整数**坐标真的会命中它。
手牌扇形里的卡互相压着一大半，自己算包围盒中心多半会落在邻座那张上。

这一组跑得快（本机整组 2.0 分钟），所以进 CI 快档，和 `check`、`catalog` 并列。

## 时间指标怎么和 main 比

时间指标（帧时间 p50/p95/p99、卡顿帧、主线程脚本时间、GPU 每帧耗时）**两档 CI 都不进**：
它要真 GPU 才有意义，而 GitHub 的 Linux 跑机是软件渲染。6.9 本来也说了绝对值不作门禁，
它要回答的是「这一版比上一版慢了没有」，所以跑法就是**在同一台机器上和 main 各跑一遍再比**：

```bash
git switch main && pnpm --filter @ai-duel/bench timing
cp packages/bench/results/timing.md /tmp/timing-main.md   # results/ 不进仓库，下一次跑会原地覆盖
git switch -     && pnpm --filter @ai-duel/bench timing
diff /tmp/timing-main.md packages/bench/results/timing.md
```

比的时候守住这几条，不然两次的数没法比：

- **同一台机器、中途别做别的事**。这一组有头跑、真的用 GPU，切个视频窗口过去数字就变了。
- **两遍的 CPU 节流倍数要一样**（默认 4 倍；改了要两遍都改，见 `BENCH_CPU_THROTTLE`）。
- **只比同一格**（视口 × 剧本），看 p95 和卡顿帧数；绝对值只在这台机器上说得通，
  跨机器的数不能互相比，也不要往文档里抄。
- 每格已经跑五遍取中位数，但 p99 仍然抖得厉害，别拿它单独下结论。

一整遍现在是两档视口 × 四段剧本共八格（`settle` 那段也在里面，它最长），本机跑要十几分钟。

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
tests/         Playwright 用例（deterministic / keyframes / interaction / timing 四个 project）
scripts/       frames.py：从 Chrome trace 里取帧
```

被测场景通过 `src/scene/contract.ts` 的契约接进来，契约的真身在 `@ai-duel/canvas`，
这个文件只是重新导出，好让 bench 里的模块都不直接 import canvas。

默认跑的是 canvas 包的**真实对局场景**（`createDuelScene`，外面套一层 `scene/duelSession.ts`
把「开局发牌」这类剧本动作翻译成引擎指令），纹理从 `public/atlas/` 的卡面图集加载。
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
| 过度绘制倍数 | 全场景换 1×1 白纹理（网格连自带的着色器一起摘掉）、tint `0x010101`、叠加混合，渲进一张长宽各缩到四分之一的 RenderTexture 再读回，红通道均值 | `page/overdraw.ts` |
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
- **过度绘制那趟调试渲染是降分辨率跑的**：长宽各缩到四分之一，像素数只剩十六分之一
  （`page/overdraw.ts` 的 `OVERDRAW_SCALE`，缩放走 `render` 的 `transform`）。
  读回来的是每像素平均绘制次数，一个空间平均值，覆盖面积和总面积一起缩，比值几乎不变
  （六段剧本实测最多差 0.004）。省的是那次同步读回：桌面档一次 8 MB 降到 0.5 MB，
  无头 SwiftShader 上 20 ms 降到 2 ms。四分之一是下限，再小的话命中特效那道 46×14
  的边缘追光只剩一两个像素，会被整块丢掉。
  它省的**不是**跑批的大头：一条用例二十来次采样一共零点几秒，跑批的时间在场景自己的
  逐帧绘制上（桌面 play10 前后跑三轮、共四千多帧、每帧 2880×1620）。CPU profile 会把
  时间算到 `extract.pixels` 那一行，那是假象——绘制是异步排队的，一直攒到这次读回才刷完。
- **最危险的结果是「假绿」。** 计数器没接管到上下文、剧本一帧都没渲染、根本没空转，
  这三种情况下每一条上限都会顺利通过。所以每段剧本额外断言 `contextSeen()` 为真、
  渲染次数大于 0、空转帧数大于 0。

## 剧本

`src/scenarios/` 里现在有四段，每段可以单独跑：

| 名字 | 文件 | 内容 |
|---|---|---|
| `deal` | duel.ts | 开局：抛硬币过场收尾，双方各五张手牌飞进扇形 |
| `play10` | duel.ts | 连续出牌十次：我方五张飞向战场，对方五张走强制展示 |
| `flip` | duel.ts | 放大查看三张：卡飞到屏幕中央翻正，看完各自飞回原格 |
| `settle` | settle.ts | 一轮结算：揭题、逐卡打字机作答、逐行盖章、比分、双方确认退场 |

`settle` 是四段里最长的一段（每张卡都要逐字打完再盖章），所以它场上只摆两个单位——
一条用例要把整段跑三遍，摆四个时在 M2 上就要十几分钟，CI 那台两核跑机装不下。

6.9 还列了牌组编辑滚动和开包，那两段要等对应场景写出来。
加法是：新开一个文件、按 `Scenario` 写好，在 `scenarios/index.ts` 的 `SCENARIOS` 上登记一行。
慢档的矩阵（`.github/workflows/slow.yml`）也要跟着加一格，并给用例挂上 `@视口-剧本` 标签。

每段的 `setup` 不计入指标——它只是把场景摆到被测动作开始前的样子。
驱动写法是固定的：发起动作 → 一帧一帧 `step(16.667)` 到动作的 Promise 兑现 → 再推到 `isIdle()`。
剧本结束后再空转 30 帧，检查帧循环真的停了。

视口两档，在 `src/node/profiles.ts`：桌面 1920×1080 倍率 1.5 档位 `high`，手机 390×844 倍率 1.5 档位 `low`。

## 阈值在哪改

全在 `src/thresholds.ts`，每条都标了它对应《正式版架构》第 3 节的哪条纪律。
6.9 表里原来写「按验证结果定」的那几行已经用真实场景的验证结果填实了（迁移第 3 条，
口径是实测峰值留约 1.5 倍余量再取整），数字和架构文档 6.9 那节对得上，改这里要同时改那边。
`todo` 字段记的是「这条上限身上还欠着账」，跑批结束时会连同欠的是什么一起列在报告里。
两种情况：一是新加的指标先拿占位值糊上；二是这个数被某个界面顶上去了、等某件事做完要压回来
（现在合批那两条就是后者——被结算层的文字顶上去的，等文字用上共享图集再压回来）。

别为了让某条过而放宽这里：这些上限就是纪律本身，放宽等于把纪律删了。场景改完超了，要改的是场景。

## 结果文件

写在 `results/`（已 gitignore，每台机器各跑各的）：

- `deterministic.json` / `deterministic.md`：每个视口每段剧本一行，附超限条目，
  以及「还欠着账的上限」——挂了 `todo` 的那几条（占位值，或者被某个界面顶上去、等着压回来的）。
- `timing.json` / `timing.md`：帧时间 p50/p95/p99、卡顿帧、管线延迟 p95、主线程脚本时间、GPU 每帧耗时。

JSON 的形状就是 `src/node/report.ts` 里的 `DeterministicReport` 和 `TimingReport`，
以后接 github-action-benchmark 做趋势和回归门禁（6.12）直接喂它。

确定性那两个文件由 Playwright 主进程的 reporter 写（`src/node/deterministicReporter.ts`），
时间指标那两个由用例自己写——两组的并发不一样，原因见上面「跑一遍要多久」。

## 已知的局限

- **每条 Playwright 用例都得各开一个浏览器进程**（`tests/freshBrowser.ts`）。
  ubuntu 跑机上（无头 `chrome-headless-shell` + SwiftShader）同一个浏览器里的**第二次**
  `browser.newContext()` 会一直卡住不返回，而 Playwright 默认是一个 worker 一个浏览器、
  每条用例在里面新建一个上下文——于是每个 worker 的第一条过、第二条卡死。
  macOS 上复现不出来。代价是每条多一次浏览器启动（跑机上一两秒），
  换掉的是「卡两分钟再重启 worker」。`timing` 那组没接，理由见那个文件。

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
- **过度绘制只处理能临时改掉外观的对象**（tint、混合模式、精灵和网格的纹理）。
  网格还要顺带把自带的着色器摘成 null：卡面反光那一层的着色器不采样纹理，自己算一个
  最大 0.4 的渐变 alpha，乘上 tint 的 1/255 之后写进 RGBA8 四舍五入就是 0，
  整层会被静默漏掉。摘掉着色器它就当一个普通贴图四边形画，每个像素正好加 1，
  这也才符合「填充率」的定义——四边形盖住多少像素，和着色器输出什么颜色无关。
  Filter 一律摘掉不算：3.1 本来就不许挂，真挂了「离屏渲染次数」那条会先报出来。
  剩下那些外观换不掉的节点（Graphics、Text 之类）计进结果的 `unswapped`，
  它们加进去的不是整数 1，所以真实场景断言这个数必须是 0
  （`tests/deterministic.spec.ts`）；桩场景每张牌带一个 Text 标签，不是 0 属于预期。
  真实场景现在覆盖得全：场景图里只有 Container、Sprite 和 Mesh——卡牌各层是网格
  （要真透视，见 canvas 的 components/CardSprite.ts），烟尘、追光是预烤纹理的精灵。
- **文字纹理的大小和机器有关**。字体光栅化在不同系统上略有差别，所以「常驻纹理内存」这条在跨机器比较时
  会有几百 KB 的浮动。预算留了足够余量，但两台机器的这一项不必强求完全相同。
- **抓 Pixi 场景靠的是包 `WebGLRenderer.prototype.render`**（`page/renderProbe.ts`），
  前提是 bench 和 canvas 解析到同一份 pixi.js。版本对不上时 `overdraw()` 会明说「没抓到场景」而不是给假数字。
