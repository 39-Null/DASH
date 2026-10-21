// P0-1 映射模块回归：node --test tools/vrm_face/facemap.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProfile,
  describeProfile,
  normalizeCategories,
  FaceMapper,
} from "./facemap.mjs";

// 来自 sample-a.vrm 的实际 expression 名称（three-vrm 3.5.3 导入后）。
const SAMPLE_A_EXPRESSIONS = [
  "neutral", "aa", "ih", "ou", "ee", "oh",
  "blink", "blinkLeft", "blinkRight",
  "angry", "relaxed", "happy", "sad", "Surprised", "Extra",
];

function approx(actual, expected, eps = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${expected}, got ${actual}`
  );
}

function mapper(options = {}) {
  const profile = buildProfile({
    expressions: SAMPLE_A_EXPRESSIONS,
    lookAtType: "bone",
    format: "VRM0",
  });
  return new FaceMapper(profile, {
    calibrationFrames: 0,
    smoothing: false,
    ...options,
  });
}

test("normalizeCategories 支持数组、Map、普通对象", () => {
  const fromArray = normalizeCategories([
    { categoryName: "jawOpen", score: 0.7 },
    { categoryName: "eyeBlinkLeft", score: 0.2 },
  ]);
  assert.equal(fromArray.jawOpen, 0.7);
  assert.equal(fromArray.eyeBlinkLeft, 0.2);

  const fromMap = normalizeCategories(new Map([["jawOpen", 0.4]]));
  assert.equal(fromMap.jawOpen, 0.4);

  const fromObject = normalizeCategories({ jawOpen: 0.3 });
  assert.equal(fromObject.jawOpen, 0.3);

  assert.deepEqual(normalizeCategories(null), {});
});

test("profile 解析 VRM 0.x 的实际名称", () => {
  const profile = buildProfile({
    expressions: SAMPLE_A_EXPRESSIONS,
    lookAtType: "bone",
    format: "VRM0",
  });
  const d = describeProfile(profile);
  assert.equal(d.aliases.happy, "happy");
  assert.equal(d.aliases.sad, "sad");
  assert.equal(d.aliases.surprised, "Surprised");
  assert.equal(d.aliases.relaxed, "relaxed");
  assert.equal(d.hasSplitBlink, true);
  assert.equal(d.lookAtType, "bone");
  assert.equal(d.expressionCount, SAMPLE_A_EXPRESSIONS.length);
});

test("同时兼容 VRM 1.0 的 happy/sad/surprised 名称", () => {
  const profile = buildProfile({
    expressions: ["aa", "ih", "ou", "ee", "oh", "blink", "happy", "sad", "surprised"],
    lookAtType: "expression",
    format: "VRM1",
  });
  assert.equal(profile.aliases.happy, "happy");
  assert.equal(profile.aliases.sad, "sad");
  assert.equal(profile.aliases.surprised, "surprised");
  assert.equal(profile.hasSplitBlink, false);
});

test("不再输出 joy/sorrow/surprise 这些失效名称", () => {
  const out = mapper().update({
    mouthSmileLeft: 1,
    mouthSmileRight: 1,
    mouthFrownLeft: 1,
    mouthFrownRight: 1,
    browInnerUp: 1,
    eyeWideLeft: 1,
    eyeWideRight: 1,
    jawOpen: 0.5,
  });
  assert.equal(out.expressions.joy, undefined);
  assert.equal(out.expressions.sorrow, undefined);
  assert.equal(out.expressions.surprise, undefined);
  assert.ok(out.expressions.happy > 0);
  assert.ok(out.expressions.sad > 0);
  assert.ok(out.expressions.Surprised > 0);
});

test("单纯微笑不应把 ih/ee 等口型带起来", () => {
  const out = mapper().update({
    mouthSmileLeft: 1,
    mouthSmileRight: 1,
    cheekSquintLeft: 1,
    cheekSquintRight: 1,
  });
  assert.ok(out.expressions.happy > 0);
  assert.equal(out.expressions.aa, 0);
  assert.equal(out.expressions.ih, 0);
  assert.equal(out.expressions.ee, 0);
  assert.equal(out.expressions.ou, 0);
  assert.equal(out.expressions.oh, 0);
});

test("惊讶输入不把 sad 拉高，悲伤输入不把 Surprised 拉高", () => {
  const surprise = mapper().update({
    browInnerUp: 1,
    browOuterUpLeft: 0.8,
    browOuterUpRight: 0.8,
    eyeWideLeft: 1,
    eyeWideRight: 1,
    jawOpen: 0.6,
  });
  assert.ok(surprise.expressions.Surprised > 0.5);
  assert.ok((surprise.expressions.sad ?? 0) < 0.05);

  const sad = mapper().update({
    mouthFrownLeft: 1,
    mouthFrownRight: 1,
    browInnerUp: 0.8,
    mouthLowerDownLeft: 0.6,
    mouthLowerDownRight: 0.6,
  });
  assert.ok(sad.expressions.sad > 0.5);
  assert.ok((sad.expressions.Surprised ?? 0) < 0.15);
});

test("分眼眨眼：blinkLeft/blinkRight 生效，blink 清零", () => {
  const out = mapper().update({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.2 });
  assert.equal(out.expressions.blinkLeft, 0.9);
  assert.equal(out.expressions.blinkRight, 0.2);
  assert.equal(out.expressions.blink, 0);
});

test("镜像模式下交换左右眼眨眼", () => {
  const out = mapper().update(
    { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.2 },
    { mirror: true }
  );
  assert.equal(out.expressions.blinkLeft, 0.2);
  assert.equal(out.expressions.blinkRight, 0.9);
});

test("只有 blink 时回退到 max(eyeBlinkLeft, eyeBlinkRight)", () => {
  const profile = buildProfile({
    expressions: ["aa", "blink"],
    lookAtType: "none",
  });
  const m = new FaceMapper(profile, { calibrationFrames: 0, smoothing: false });
  const out = m.update({ eyeBlinkLeft: 0.4, eyeBlinkRight: 0.7 });
  assert.equal(out.expressions.blink, 0.7);
});

test("骨骼视线：左右上下转为 yaw/pitch，镜像翻转 yaw", () => {
  const out = mapper().update({
    eyeLookOutLeft: 1,
    eyeLookInRight: 1,
    eyeLookUpLeft: 1,
    eyeLookUpRight: 1,
  });
  assert.equal(out.lookAt.mode, "bone");
  approx(out.lookAt.yaw, 30);
  approx(out.lookAt.pitch, 20);

  const mirrored = mapper().update(
    {
      eyeLookOutLeft: 1,
      eyeLookInRight: 1,
      eyeLookUpLeft: 1,
      eyeLookUpRight: 1,
    },
    { mirror: true }
  );
  approx(mirrored.lookAt.yaw, -30);
  approx(mirrored.lookAt.pitch, 20);
});

test("没有骨骼 lookAt 时回退到 look* expression", () => {
  const profile = buildProfile({
    expressions: ["lookUp", "lookDown", "lookLeft", "lookRight"],
    lookAtType: "expression",
  });
  const m = new FaceMapper(profile, { calibrationFrames: 0, smoothing: false });
  const out = m.update({
    eyeLookOutLeft: 1,
    eyeLookInRight: 1,
  });
  assert.equal(out.lookAt, null);
  assert.equal(out.expressions.lookLeft, 1);
  assert.equal(out.expressions.lookRight, 0);
});

test("自动中性校准：基线归零，1 仍映射到 1", () => {
  const m = new FaceMapper(
    buildProfile({ expressions: SAMPLE_A_EXPRESSIONS, lookAtType: "bone" }),
    { calibrationFrames: 3, smoothing: false }
  );

  for (let i = 0; i < 3; i++) {
    m.update({ jawOpen: 0.1, _neutral: 0.9 });
  }
  assert.equal(m.neutral.jawOpen, 0.1);

  const atBaseline = m.update({ jawOpen: 0.1, _neutral: 0.9 });
  approx(atBaseline.expressions.aa, 0);
  assert.equal(atBaseline.meta.calibrated, true);

  const above = m.update({ jawOpen: 0.55, _neutral: 0.9 });
  approx(above.expressions.aa, 0.5);
});

test("_neutral 不会被当作 neutral expression 输出", () => {
  const out = mapper().update({ _neutral: 1, jawOpen: 0.2 });
  assert.equal(out.expressions.neutral, undefined);
});

test("口型组归一：多个口型同时激活时总权重不超过 1", () => {
  const out = mapper().update({
    jawOpen: 1,
    mouthPucker: 1,
    mouthFunnel: 1,
  });
  const sum =
    (out.expressions.aa ?? 0) +
    (out.expressions.ih ?? 0) +
    (out.expressions.ou ?? 0) +
    (out.expressions.ee ?? 0) +
    (out.expressions.oh ?? 0);
  assert.ok(sum <= 1 + 1e-9, `mouth sum ${sum}`);
  approx(out.expressions.aa, 1 / 3);
  approx(out.expressions.ou, 1 / 3);
  approx(out.expressions.oh, 1 / 3);
});

test("情绪组归一：多个情绪同时激活时总权重不超过 1", () => {
  const out = mapper().update({
    mouthSmileLeft: 1,
    mouthSmileRight: 1,
    browDownLeft: 1,
    browDownRight: 1,
    mouthFrownLeft: 1,
    mouthFrownRight: 1,
    browInnerUp: 1,
    eyeWideLeft: 1,
    eyeWideRight: 1,
    jawOpen: 1,
  });
  const sum =
    (out.expressions.happy ?? 0) +
    (out.expressions.sad ?? 0) +
    (out.expressions.angry ?? 0) +
    (out.expressions.relaxed ?? 0) +
    (out.expressions.Surprised ?? 0);
  assert.ok(sum <= 1 + 1e-9, `emotion sum ${sum}`);
});

test("平滑：attack 快速上升，release 缓慢下降", () => {
  const profile = buildProfile({
    expressions: ["aa"],
    lookAtType: "none",
  });
  const m = new FaceMapper(profile, {
    calibrationFrames: 0,
    smoothing: true,
    attackTau: 0.03,
    releaseTau: 0.12,
  });

  const a = m.update({ jawOpen: 1 }, { dt: 1 / 30 }).expressions.aa;
  const b = m.update({ jawOpen: 1 }, { dt: 1 / 30 }).expressions.aa;
  assert.ok(a > 0 && a < 1);
  assert.ok(b > a && b < 1);

  const c = m.update({ jawOpen: 0 }, { dt: 1 / 30 }).expressions.aa;
  assert.ok(c < b, `release should decrease: ${c} < ${b}`);
  assert.ok(c > 0, "release should not jump to zero in one frame");
});

test("缺少目标 expression 时不抛错，只输出存在的通道", () => {
  const profile = buildProfile({
    expressions: ["aa"],
    lookAtType: "none",
  });
  const m = new FaceMapper(profile, { calibrationFrames: 0, smoothing: false });
  const out = m.update({
    jawOpen: 0.5,
    eyeBlinkLeft: 1,
  });
  assert.equal(out.expressions.aa, 0.5);
  assert.equal(out.expressions.happy, undefined);
  assert.equal(out.expressions.blinkLeft, undefined);
});

test("reset 清空平滑与校准状态", () => {
  const m = new FaceMapper(
    buildProfile({ expressions: SAMPLE_A_EXPRESSIONS, lookAtType: "bone" }),
    { calibrationFrames: 3, smoothing: true }
  );
  m.update({ jawOpen: 0.2, _neutral: 0.9 });
  assert.ok(m.smoothed);
  m.reset();
  assert.equal(m.smoothed, null);
  assert.equal(m.neutral, null);
  assert.equal(m._calibrationDone, false);
});
