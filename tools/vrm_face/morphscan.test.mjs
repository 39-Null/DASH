// P0-2 morph target 扫描与 custom profile 回归：
// node --test tools/vrm_face/morphscan.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomProfile,
  CustomFaceMapper,
  describeCustomProfile,
  groupBindsByMesh,
  normalizeMorphTargetName,
  scanMorphTargets,
} from "./morphscan.mjs";

// sample-a.vrm 的 56 个 morph target 名称。
const SAMPLE_A_TARGETS = [
  "Face.M_F00_000_00_Fcl_ALL_Neutral",
  "Face.M_F00_000_00_Fcl_ALL_Angry",
  "Face.M_F00_000_00_Fcl_ALL_Fun",
  "Face.M_F00_000_00_Fcl_ALL_Joy",
  "Face.M_F00_000_00_Fcl_ALL_Sorrow",
  "Face.M_F00_000_00_Fcl_ALL_Surprised",
  "Face.M_F00_000_00_Fcl_BRW_Angry",
  "Face.M_F00_000_00_Fcl_BRW_Fun",
  "Face.M_F00_000_00_Fcl_BRW_Joy",
  "Face.M_F00_000_00_Fcl_BRW_Sorrow",
  "Face.M_F00_000_00_Fcl_BRW_Surprised",
  "Face.M_F00_000_00_Fcl_EYE_Natural",
  "Face.M_F00_000_00_Fcl_EYE_Angry",
  "Face.M_F00_000_00_Fcl_EYE_Close",
  "Face.M_F00_000_00_Fcl_EYE_Close_R",
  "Face.M_F00_000_00_Fcl_EYE_Close_L",
  "Face.M_F00_000_00_Fcl_Eye_Fun",
  "Face.M_F00_000_00_Fcl_EYE_Joy",
  "Face.M_F00_000_00_Fcl_EYE_Joy_R",
  "Face.M_F00_000_00_Fcl_EYE_Joy_L",
  "Face.M_F00_000_00_Fcl_EYE_Sorrow",
  "Face.M_F00_000_00_Fcl_EYE_Surprised",
  "Face.M_F00_000_00_Fcl_EYE_Spread",
  "Face.M_F00_000_00_Fcl_EYE_Iris_Hide",
  "Face.M_F00_000_00_Fcl_EYE_Highlight_Hide",
  "Face.M_F00_000_00_Fcl_EYE_Extra",
  "Face.M_F00_000_00_Fcl_MTH_Up",
  "Face.M_F00_000_00_Fcl_MTH_Down",
  "Face.M_F00_000_00_Fcl_MTH_Angry",
  "Face.M_F00_000_00_Fcl_MTH_Neutral",
  "Face.M_F00_000_00_Fcl_MTH_Fun",
  "Face.M_F00_000_00_Fcl_MTH_Joy",
  "Face.M_F00_000_00_Fcl_MTH_Sorrow",
  "Face.M_F00_000_00_Fcl_MTH_Surprised",
  "Face.M_F00_000_00_Fcl_MTH_SkinFung",
  "Face.M_F00_000_00_Fcl_MTH_SkinFung_R",
  "Face.M_F00_000_00_Fcl_MTH_SkinFung_L",
  "Face.M_F00_000_00_Fcl_MTH_A",
  "Face.M_F00_000_00_Fcl_MTH_I",
  "Face.M_F00_000_00_Fcl_MTH_U",
  "Face.M_F00_000_00_Fcl_MTH_E",
  "Face.M_F00_000_00_Fcl_MTH_O",
  "Face.M_F00_000_00_Fcl_HA_Hide",
  "Face.M_F00_000_00_Fcl_HA_Fung1",
  "Face.M_F00_000_00_Fcl_HA_Fung1_Low",
  "Face.M_F00_000_00_Fcl_HA_Fung1_Up",
  "Face.M_F00_000_00_Fcl_HA_Fung2",
  "Face.M_F00_000_00_Fcl_HA_Fung2_Low",
  "Face.M_F00_000_00_Fcl_HA_Fung2_Up",
  "Face.M_F00_000_00_Fcl_HA_Fung3",
  "Face.M_F00_000_00_Fcl_HA_Fung3_Up",
  "Face.M_F00_000_00_Fcl_HA_Fung3_Low",
  "Face.M_F00_000_00_Fcl_HA_Short",
  "Face.M_F00_000_00_Fcl_HA_Short_Up",
  "Face.M_F00_000_00_Fcl_HA_Short_Low",
  "EyeExtra_01.M_F00_000_00_EyeExtra_On",
];

const SAMPLE_A_EXPRESSIONS = [
  "neutral", "aa", "ih", "ou", "ee", "oh",
  "blink", "blinkLeft", "blinkRight",
  "angry", "relaxed", "happy", "sad", "Surprised", "Extra",
];

const WITH_CLOSE = [
  ...SAMPLE_A_TARGETS,
  "Face.M_F00_000_00_Fcl_MTH_Close",
];

const GIRL_LIKE = [
  ...SAMPLE_A_TARGETS.filter((name) => !name.endsWith("EYE_Spread")),
  "Face.M_F00_000_00_Fcl_MTH_Close",
];

function customMapper(targets = SAMPLE_A_TARGETS, options = {}) {
  const profile = buildCustomProfile({
    morphTargets: targets,
    expressions: SAMPLE_A_EXPRESSIONS,
    lookAtType: "bone",
    format: "VRM0",
  });
  return new CustomFaceMapper(profile, {
    calibrationFrames: 0,
    smoothing: false,
    ...options,
  });
}

function approx(actual, expected, eps = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${expected}, got ${actual}`
  );
}

test("morph target 名称归一化", () => {
  assert.equal(
    normalizeMorphTargetName("Face.M_F00_000_00_Fcl_BRW_Angry"),
    "brw_angry"
  );
  assert.equal(
    normalizeMorphTargetName("Face.M_F00_000_00_Fcl_EYE_Close_L"),
    "eye_close_l"
  );
  assert.equal(
    normalizeMorphTargetName("EyeExtra_01.M_F00_000_00_EyeExtra_On"),
    "eyeextra_on"
  );
  assert.equal(normalizeMorphTargetName(""), "");
});

test("scanMorphTargets 分组并忽略重复", () => {
  const scan = scanMorphTargets([...SAMPLE_A_TARGETS, SAMPLE_A_TARGETS[0]]);
  assert.equal(scan.targets.length, 56);
  assert.equal(scan.groups.brow.length, 5);
  assert.equal(scan.groups.eye.length, 15);
  assert.equal(scan.groups.mouth.length, 16);
  assert.equal(scan.groups.hair.length, 13);
  assert.equal(scan.groups.combined.length, 6);
  assert.equal(scan.groups.other.length, 1);
  assert.ok(scan.faceRelevant.length > 30);
});

test("sample-a 生成 20 个 custom expression，跳过缺失的 MTH_Close", () => {
  const profile = buildCustomProfile({
    morphTargets: SAMPLE_A_TARGETS,
    expressions: SAMPLE_A_EXPRESSIONS,
    lookAtType: "bone",
    format: "VRM0",
  });
  const d = describeCustomProfile(profile);
  assert.equal(d.expressionCount, 20);
  assert.ok(d.skipped.some((item) => item.id === "mouthClose" && item.reason === "target-missing"));
  assert.ok(d.skipped.some((item) => item.id === "cheekSquint" && item.reason === "skipped-by-rule"));
  assert.ok(!profile.byName.arkit_mouthClose);
  assert.ok(profile.byName.arkit_mouthSmile);
  assert.ok(profile.byName.arkit_browSorrow);
  assert.ok(profile.byName.arkit_eyeAngry);
  assert.ok(profile.byName.arkit_mouthAngry);
});

test("新增 MTH_Close 后 mouthClose 生成，且 target 不重复", () => {
  const profile = buildCustomProfile({
    morphTargets: WITH_CLOSE,
    expressions: SAMPLE_A_EXPRESSIONS,
    lookAtType: "bone",
    format: "VRM0",
  });
  assert.equal(profile.expressions.length, 21);
  assert.equal(profile.byName.arkit_mouthClose.target, "Face.M_F00_000_00_Fcl_MTH_Close");

  const targets = profile.expressions.flatMap((def) => def.binds.map((bind) => bind.target));
  assert.equal(new Set(targets).size, targets.length, "每个 morph target 只能绑定一次");
});

test("没有 EYE_Spread 时 eyeWide 回退到 EYE_Surprised", () => {
  const profile = buildCustomProfile({
    morphTargets: GIRL_LIKE,
    expressions: SAMPLE_A_EXPRESSIONS,
    lookAtType: "bone",
    format: "VRM0",
  });
  assert.equal(
    profile.byName.arkit_eyeWide.target,
    "Face.M_F00_000_00_Fcl_EYE_Surprised"
  );
});

test("custom profile 不驱动 ALL_* 全脸组合", () => {
  const profile = buildCustomProfile({
    morphTargets: SAMPLE_A_TARGETS,
    expressions: SAMPLE_A_EXPRESSIONS,
    lookAtType: "bone",
    format: "VRM0",
  });
  for (const def of profile.expressions) {
    for (const bind of def.binds) {
      assert.ok(
        !bind.target.includes("_Fcl_ALL_"),
        `${def.name} 不应绑定 ${bind.target}`
      );
    }
  }
});

test("lookAtType auto 根据已有 look expression 解析", () => {
  const withLook = buildCustomProfile({
    morphTargets: SAMPLE_A_TARGETS,
    expressions: ["lookLeft"],
    lookAtType: "auto",
  });
  assert.equal(withLook.lookAtType, "expression");

  const withoutLook = buildCustomProfile({
    morphTargets: SAMPLE_A_TARGETS,
    expressions: ["aa"],
    lookAtType: "auto",
  });
  assert.equal(withoutLook.lookAtType, "none");
});

test("presetNamesToClear 包含实际存在的旧 preset", () => {
  const profile = buildCustomProfile({
    morphTargets: SAMPLE_A_TARGETS,
    expressions: SAMPLE_A_EXPRESSIONS,
    lookAtType: "bone",
    format: "VRM0",
  });
  for (const name of ["aa", "ih", "ou", "ee", "oh", "blink", "happy", "sad", "Surprised"]) {
    assert.ok(profile.presetNamesToClear.includes(name), `缺少 ${name}`);
  }
  assert.ok(!profile.presetNamesToClear.includes("neutral"));
});

test("groupBindsByMesh 把 target 解析到所有相关 mesh，并按 index 分组", () => {
  const profile = buildCustomProfile({
    morphTargets: SAMPLE_A_TARGETS,
    expressions: SAMPLE_A_EXPRESSIONS,
    lookAtType: "bone",
    format: "VRM0",
  });
  const meshA = { morphTargetDictionary: { "Face.M_F00_000_00_Fcl_MTH_A": 0 } };
  const meshB = { morphTargetDictionary: { "Face.M_F00_000_00_Fcl_MTH_A": 0 } };
  const meshC = { morphTargetDictionary: { "Face.M_F00_000_00_Fcl_MTH_A": 5 } };
  const grouped = groupBindsByMesh([meshA, meshB, meshC], profile);
  const jaw = grouped.find((item) => item.def.id === "jawOpen");

  assert.equal(jaw.groups.length, 2);
  const zero = jaw.groups.find((group) => group.index === 0);
  assert.equal(zero.primitives.length, 2);
  assert.ok(zero.primitives.includes(meshA));
  assert.ok(zero.primitives.includes(meshB));
  const five = jaw.groups.find((group) => group.index === 5);
  assert.deepEqual(five.primitives, [meshC]);
});

test("微笑只驱动 arkit_mouthSmile，不驱动口型或睁眼", () => {
  const out = customMapper().update({
    mouthSmileLeft: 1,
    mouthSmileRight: 1,
  });
  approx(out.expressions.arkit_mouthSmile, 1);
  approx(out.expressions.arkit_jawOpen, 0);
  approx(out.expressions.arkit_mouthStretch, 0);
  approx(out.expressions.arkit_eyeWide, 0);
});

test("分眼眨眼在 custom 模式下保持左右，镜像交换", () => {
  const m = customMapper();
  const left = m.update({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.2 });
  approx(left.expressions.arkit_eyeBlinkLeft, 0.9);
  approx(left.expressions.arkit_eyeBlinkRight, 0.2);

  const mirrored = m.update(
    { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.2 },
    { mirror: true }
  );
  approx(mirrored.expressions.arkit_eyeBlinkLeft, 0.2);
  approx(mirrored.expressions.arkit_eyeBlinkRight, 0.9);
});

test("悲伤：browSorrow / eyeSorrow / mouthFrown 同时出现", () => {
  const out = customMapper().update({
    mouthFrownLeft: 1,
    mouthFrownRight: 1,
    browInnerUp: 0.8,
    mouthLowerDownLeft: 0.5,
    mouthLowerDownRight: 0.5,
  });
  approx(out.expressions.arkit_browSorrow, 0.8);
  approx(out.expressions.arkit_eyeSorrow, 0.8);
  approx(out.expressions.arkit_mouthFrown, 1);
  approx(out.expressions.arkit_mouthLowerDown, 0.5);
});

test("惊讶：内侧抬眉、外侧抬眉、睁眼、张口同时出现，且不拉高悲伤眉", () => {
  const out = customMapper().update({
    browInnerUp: 1,
    browOuterUpLeft: 0.8,
    browOuterUpRight: 0.8,
    eyeWideLeft: 1,
    eyeWideRight: 1,
    jawOpen: 0.6,
  });
  approx(out.expressions.arkit_browInnerUp, 1);
  approx(out.expressions.arkit_browOuterUp, 0.8);
  approx(out.expressions.arkit_eyeWide, 1);
  approx(out.expressions.arkit_jawOpen, 0.6);
  approx(out.expressions.arkit_browSorrow, 0);
  approx(out.expressions.arkit_eyeSorrow, 0);
});

test("愤怒：压眉派生 eyeAngry 和 mouthAngry", () => {
  const out = customMapper().update({
    browDownLeft: 1,
    browDownRight: 1,
  });
  approx(out.expressions.arkit_browDown, 1);
  approx(out.expressions.arkit_eyeAngry, 0.8);
  approx(out.expressions.arkit_mouthAngry, 0.5);
});

test("嘴部拉伸与闭唇使用正确的 target", () => {
  const stretch = customMapper().update({
    mouthStretchLeft: 0.7,
    mouthStretchRight: 0.6,
  });
  approx(stretch.expressions.arkit_mouthStretch, 0.7);

  const close = customMapper(WITH_CLOSE).update({
    mouthPressLeft: 0.6,
    mouthPressRight: 0.4,
  });
  approx(close.expressions.arkit_mouthClose, 0.6);
});

test("骨骼视线只输出 lookAt，不输出 look* expression", () => {
  const out = customMapper().update({
    eyeLookOutLeft: 1,
    eyeLookInRight: 1,
    eyeLookUpLeft: 1,
    eyeLookUpRight: 1,
  });
  assert.equal(out.lookAt.mode, "bone");
  approx(out.lookAt.yaw, 30);
  approx(out.lookAt.pitch, 20);
  assert.equal(out.expressions.lookLeft, undefined);
});

test("expression 型 lookAt 回退到 look* preset", () => {
  const profile = buildCustomProfile({
    morphTargets: SAMPLE_A_TARGETS,
    expressions: ["lookUp", "lookDown", "lookLeft", "lookRight", "happy"],
    lookAtType: "expression",
  });
  const m = new CustomFaceMapper(profile, {
    calibrationFrames: 0,
    smoothing: false,
  });
  const out = m.update({
    eyeLookOutLeft: 1,
    eyeLookInRight: 1,
  });
  assert.equal(out.lookAt, null);
  approx(out.expressions.lookLeft, 1);
  approx(out.expressions.lookRight, 0);
});

test("custom 模式复用自动中性校准", () => {
  const m = customMapper(SAMPLE_A_TARGETS, { calibrationFrames: 3 });
  for (let i = 0; i < 3; i++) {
    m.update({ jawOpen: 0.1, _neutral: 0.9 });
  }
  const baseline = m.update({ jawOpen: 0.1, _neutral: 0.9 });
  approx(baseline.expressions.arkit_jawOpen, 0);

  const above = m.update({ jawOpen: 0.55, _neutral: 0.9 });
  approx(above.expressions.arkit_jawOpen, 0.5);
});

test("custom 模式 meta 与 reset 正常", () => {
  const m = customMapper();
  const out = m.update({ jawOpen: 0.4 });
  assert.equal(out.meta.mode, "custom");
  assert.equal(out.meta.expressionCount, 20);
  assert.equal(out.meta.calibrated, true);
  m.reset();
  assert.equal(m.smoothed, null);
});
