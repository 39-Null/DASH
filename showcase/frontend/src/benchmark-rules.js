// 性能测试判定规则（纯函数，无浏览器依赖，便于单独核对与回归）。
//
// 为什么要分「吞吐 / 工作量 / 长尾」三层：
// requestAnimationFrame 的间隔由显示刷新率量化。40 Hz 屏幕上间隔只能是 25 ms 的整数倍；
// 一个 28 ms 的帧在 33.3 ms 预算内，却会错过 25 ms 的 vsync，表现为 50 ms 间隔。
// 因此帧间隔只能作为调度诊断，不能单独作为「算力不足」的判据。
// 真实反映状态的是每帧流水线工作量（感知 + 表情映射 + rig + 渲染）。

export const TARGET_FPS = 30;
export const FRAME_BUDGET_MS = 1000 / TARGET_FPS;
export const LONG_TAIL_FACTOR = 1.2;
export const LONG_TAIL_BUDGET_MS = FRAME_BUDGET_MS * LONG_TAIL_FACTOR;
export const WORK_OVER_BUDGET_WARN_RATIO = 0.1;

function round1(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 10) / 10;
}

// 输入：平均 FPS、平均/P95 工作量、工作量超预算占比、帧间隔 P95、刷新率
// 输出：{ pass, level: "pass"|"warn"|"fail", checks, warnings, notes }
export function evaluateVerdict({
  fpsAvg,
  meanWorkMs,
  p95WorkMs,
  workOverBudgetRatio,
  frameP95Ms,
  refreshHz,
}) {
  const checks = [
    {
      id: "fps",
      name: `平均帧率 ≥ ${TARGET_FPS}`,
      value: round1(fpsAvg),
      unit: "FPS",
      threshold: TARGET_FPS,
      pass: fpsAvg != null && fpsAvg >= TARGET_FPS,
    },
    {
      id: "mean-work",
      name: `平均工作量 ≤ ${round1(FRAME_BUDGET_MS)} ms`,
      value: round1(meanWorkMs),
      unit: "ms",
      threshold: round1(FRAME_BUDGET_MS),
      pass: meanWorkMs != null && meanWorkMs <= FRAME_BUDGET_MS,
    },
    {
      id: "p95-work",
      name: `P95 工作量 ≤ ${round1(LONG_TAIL_BUDGET_MS)} ms（1.2× 预算）`,
      value: round1(p95WorkMs),
      unit: "ms",
      threshold: round1(LONG_TAIL_BUDGET_MS),
      pass: p95WorkMs != null && p95WorkMs <= LONG_TAIL_BUDGET_MS,
    },
  ];

  const hardPass = checks.every((c) => c.pass);
  const warnings = [];
  if (hardPass && p95WorkMs != null && p95WorkMs > FRAME_BUDGET_MS) {
    warnings.push(
      `P95 工作量 ${round1(p95WorkMs)} ms 高于 ${round1(FRAME_BUDGET_MS)} ms 严格预算，但仍在 1.2× 长尾容忍内。`
    );
  }
  if (hardPass && workOverBudgetRatio != null && workOverBudgetRatio > WORK_OVER_BUDGET_WARN_RATIO) {
    warnings.push(
      `工作量超预算帧占比 ${Math.round(workOverBudgetRatio * 100)}%，高于 ${Math.round(
        WORK_OVER_BUDGET_WARN_RATIO * 100
      )}% 告警线。`
    );
  }

  const notes = [];
  if (refreshHz && refreshHz < 50) {
    notes.push(
      `显示刷新率估计 ${Math.round(refreshHz)} Hz（周期约 ${round1(
        1000 / refreshHz
      )} ms）；rAF 间隔按刷新周期量化，帧间隔超 ${round1(
        FRAME_BUDGET_MS
      )} ms 不等同于工作量超预算。`
    );
  }
  if (frameP95Ms != null && p95WorkMs != null && frameP95Ms > FRAME_BUDGET_MS && p95WorkMs <= FRAME_BUDGET_MS) {
    notes.push(
      `帧间隔 P95 ${round1(frameP95Ms)} ms，但工作量 P95 ${round1(
        p95WorkMs
      )} ms 在预算内，说明长间隔来自 vsync 等待或调度，不是算力不足。`
    );
  }

  const level = hardPass ? (warnings.length ? "warn" : "pass") : "fail";
  return { pass: level !== "fail", level, checks, warnings, notes };
}

export function verdictLabel(level) {
  if (level === "pass") return "PASS · 通过";
  if (level === "warn") return "PASS · 通过（有告警）";
  return "FAIL · 未通过";
}
