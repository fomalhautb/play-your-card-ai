"""从 Chrome trace 里取帧数据和主线程脚本时间。

《正式版架构》6.9 要求帧时间从 trace 里取、用 Perfetto 的 trace_processor 提取，
不在页面里自己计时——页面里 performance.now 量到的只是 JS 那一段，
合成、光栅、上屏都不在里面，那个数好看但不代表用户看到的帧率。

用法（本机有 uv，不用先装依赖）：
    uv run --with perfetto python scripts/frames.py <trace.json> --out <frames.json>

输出的 JSON 由 src/node/trace.ts 的 parseFramesReport 解析，字段名两边要一致。

注意：trace_processor 第一次跑会去 Google 的存储桶下一个 trace_processor_shell 可执行文件，
所以这一步需要联网。下过之后有缓存。
"""

from __future__ import annotations

import argparse
import json
import sys

from perfetto.trace_processor import TraceProcessor

# DevTools timeline 里代表「在跑 JS」的切片名。
# GC 不算脚本时间，所以 MajorGC / MinorGC 不在这里。
JS_SLICE_NAMES = (
    "FunctionCall",
    "EvaluateScript",
    "RunMicrotasks",
    "TimerFire",
    "FireAnimationFrame",
    "v8.run",
    "v8.callFunction",
    "V8.Execute",
)

# 帧数据的候选来源，按可信度从高到低。第一个取到足够多行的就用它。
#
# PipelineReporter 是 Chrome 合成器为每一帧发的异步事件，从 BeginFrame 一直盖到上屏，
# 是最贴近「用户看到的一帧」的东西。
#
# 两个坑：
#   - 它落在一个同名的 track 上，但那条 track 上还挂着 BeginImplFrameToSendBeginMainFrame、
#     Commit 这些子阶段切片。按 track 取会把子阶段也当成帧，帧数直接翻好几倍，
#     间隔的中位数会变成零点零几毫秒。所以必须同时限定 name 和 depth = 0。
#   - 没有内容更新的那些 BeginFrame 也会发一条 PipelineReporter，状态是 STATE_NO_UPDATE_DESIRED、
#     时长为 0。它们恰恰是「空闲时帧循环停了」的证据，但不是「用户看到的一帧」，
#     算进帧间隔会把数字拉得很好看。所以优先只取 STATE_PRESENTED_ALL。
#
# 状态参数的键名两种都试：JSON trace 里是 args.frame_reporter.state，
# proto trace 里是 chrome_frame_reporter.state。
FRAME_SOURCES = (
    (
        "presented:args.frame_reporter",
        """
        select s.ts as ts, s.dur as dur
        from slice s
        where s.name = 'PipelineReporter' and s.depth = 0
          and extract_arg(s.arg_set_id, 'args.frame_reporter.state') = 'STATE_PRESENTED_ALL'
        order by s.ts
        """,
    ),
    (
        "presented:chrome_frame_reporter",
        """
        select s.ts as ts, s.dur as dur
        from slice s
        where s.name = 'PipelineReporter' and s.depth = 0
          and extract_arg(s.arg_set_id, 'chrome_frame_reporter.state') = 'STATE_PRESENTED_ALL'
        order by s.ts
        """,
    ),
    (
        "slice:PipelineReporter",
        """
        select s.ts as ts, s.dur as dur
        from slice s
        where s.name = 'PipelineReporter' and s.depth = 0 and s.dur > 0
        order by s.ts
        """,
    ),
    (
        "slice:DrawAndSwap",
        """
        select s.ts as ts, s.dur as dur
        from slice s
        where s.name in ('Graphics.Pipeline.DrawAndSwap', 'DrawFrame') and s.dur > 0
        order by s.ts
        """,
    ),
)

# 一个源至少要有这么多帧才算数。最短的一段剧本（发牌）只有十几帧上屏，门槛不能定高。
MIN_FRAMES = 5

MAIN_THREAD_SQL = """
select s.ts as ts, s.dur as dur
from slice s
join thread_track tt on s.track_id = tt.id
join thread th on tt.utid = th.utid
where th.name = 'CrRendererMain' and s.dur > 0 and s.name in ({names})
order by s.ts
"""

NS_PER_MS = 1e6


def rows(tp: TraceProcessor, sql: str) -> list[tuple[int, int]]:
    """跑一条查询，拿回 (ts, dur) 列表。查询本身出错时当成「这个源没有数据」。"""
    try:
        return [(int(r.ts), int(r.dur)) for r in tp.query(sql)]
    except Exception as error:  # noqa: BLE001 - 候选源查不到就换下一个，不该中断整个流程
        print(f"查询失败，跳过这个源：{error}", file=sys.stderr)
        return []


def merge_total_ms(intervals: list[tuple[int, int]]) -> float:
    """合并重叠区间再求总长。

    FunctionCall 里面还可以套 FunctionCall，直接把 dur 加起来会把嵌套的部分算好几遍，
    量出来的「主线程脚本时间」能超过整段 trace 的长度。
    """
    if not intervals:
        return 0.0
    ordered = sorted(intervals)
    total = 0
    start, end = ordered[0][0], ordered[0][0] + ordered[0][1]
    for ts, dur in ordered[1:]:
        if ts > end:
            total += end - start
            start, end = ts, ts + dur
        else:
            end = max(end, ts + dur)
    total += end - start
    return total / NS_PER_MS


def pick_frames(tp: TraceProcessor) -> tuple[str, list[tuple[int, int]], dict[str, int]]:
    """挑一个能用的帧来源，并把每个候选各有多少行一起带出去。

    诊断字段是留给「换了 Chrome 版本、数字忽然变样」时用的：
    先看是不是换了来源，再看新来源的行数对不对。
    """
    diagnostics: dict[str, int] = {}
    chosen: tuple[str, list[tuple[int, int]]] | None = None
    for name, sql in FRAME_SOURCES:
        found = rows(tp, sql)
        diagnostics[name] = len(found)
        if chosen is None and len(found) >= MIN_FRAMES:
            chosen = (name, found)
    if chosen is None:
        return "none", [], diagnostics
    return chosen[0], chosen[1], diagnostics


def main() -> int:
    parser = argparse.ArgumentParser(description="从 Chrome trace 里取帧数据")
    parser.add_argument("trace", help="Chrome trace 文件（JSON 或 proto）")
    parser.add_argument("--out", required=True, help="把结果写到这个 JSON 文件")
    parser.add_argument(
        "--explain",
        action="store_true",
        help="顺便把 trace 里切片最多的 track 打出来，换 Chrome 版本、帧事件对不上时用",
    )
    args = parser.parse_args()

    tp = TraceProcessor(trace=args.trace)
    try:
        source, frames, diagnostics = pick_frames(tp)
        # 上屏时刻就是这一帧管线的终点。相邻两次上屏的间隔才是「帧时间」，
        # 而 PipelineReporter 自己的时长是管线延迟——两帧可以同时在管线里，所以延迟远大于间隔。
        presented_ts = sorted(ts + dur for ts, dur in frames)
        intervals = [
            (b - a) / NS_PER_MS for a, b in zip(presented_ts, presented_ts[1:], strict=False)
        ]
        pipeline = [dur / NS_PER_MS for _, dur in frames]

        names = ", ".join(f"'{name}'" for name in JS_SLICE_NAMES)
        main_thread = merge_total_ms(rows(tp, MAIN_THREAD_SQL.format(names=names)))
        diagnostics["frames"] = len(frames)

        if args.explain:
            print("切片最多的 track：", file=sys.stderr)
            sql = (
                "select t.name as name, count(*) as n from slice s "
                "join track t on s.track_id = t.id group by 1 order by 2 desc limit 25"
            )
            for row in tp.query(sql):
                print(f"  {row.name}: {row.n}", file=sys.stderr)

        report = {
            "source": source,
            "frameIntervalsMs": intervals,
            "pipelineMs": pipeline,
            "mainThreadScriptMs": main_thread,
            "diagnostics": diagnostics,
        }
        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump(report, handle)
        print(f"帧数据源 {source}，{len(frames)} 帧 → {args.out}", file=sys.stderr)
    finally:
        tp.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
