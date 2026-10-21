// 判定规则回归：node --test showcase/frontend/tests/benchmark-rules.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateVerdict,
  verdictLabel,
  FRAME_BUDGET_MS,
  LONG_TAIL_BUDGET_MS,
} from "../src/benchmark-rules.js";

const base = {
  fpsAvg: 33.9,
  meanWorkMs: 28.3,
  p95WorkMs: 34.7,
  workOverBudgetRatio: 0.08,
  frameP95Ms: 41.4,
  refreshHz: 40,
};

test("40 Hz 屏幕上的真实结果：通过但有长尾告警", () => {
  const v = evaluateVerdict(base);
  assert.equal(v.pass, true);
  assert.equal(v.level, "warn");
  assert.equal(verdictLabel(v.level), "PASS · 通过（有告警）");
  assert.ok(v.warnings.some((w) => w.includes("严格预算")));
  assert.ok(v.notes.some((n) => n.includes("40 Hz")));
  assert.ok(v.notes.some((n) => n.includes("vsync") || n.includes("刷新周期")));
});

test("平均与 P95 工作量都在严格预算内：干净通过", () => {
  const v = evaluateVerdict({
    ...base,
    fpsAvg: 35,
    meanWorkMs: 24,
    p95WorkMs: 30,
    workOverBudgetRatio: 0.02,
    frameP95Ms: 25,
    refreshHz: 60,
  });
  assert.equal(v.level, "pass");
  assert.equal(v.warnings.length, 0);
});

test("平均帧率不足直接失败", () => {
  const v = evaluateVerdict({ ...base, fpsAvg: 25 });
  assert.equal(v.level, "fail");
  assert.equal(v.pass, false);
});

test("平均工作量超预算直接失败", () => {
  const v = evaluateVerdict({ ...base, meanWorkMs: FRAME_BUDGET_MS + 1, p95WorkMs: 35 });
  assert.equal(v.level, "fail");
});

test("P95 工作量超过长尾容忍直接失败", () => {
  const v = evaluateVerdict({ ...base, p95WorkMs: LONG_TAIL_BUDGET_MS + 1 });
  assert.equal(v.level, "fail");
});

test("工作量超预算占比过高时降级为告警", () => {
  const v = evaluateVerdict({ ...base, workOverBudgetRatio: 0.15, p95WorkMs: 32 });
  assert.equal(v.level, "warn");
  assert.ok(v.warnings.some((w) => w.includes("15%")));
});
