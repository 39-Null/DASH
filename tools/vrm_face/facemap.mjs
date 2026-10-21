// DASH 面部映射 P0-1：52 ARKit BlendShape -> VRM expression 权重。
//
// 设计约束：
// 1. 纯 ES module，不依赖 three.js / 浏览器，便于 Node 单测与后续展示线接入。
// 2. 不硬编码 VRM 0.x 的旧名称。VRM 0.x 经 three-vrm 导入后会把
//    joy -> happy、sorrow -> sad、unknown -> 组名（例如 Surprised）。
//    因此调用方应传入运行时 expressionMap 的实际名称。
// 3. 视线优先输出给骨骼 lookAt（vrm.lookAt.yaw/pitch），
//    只有在模型没有骨骼 lookAt 时才回退到 look* expression。
// 4. 自动中性校准，不依赖手动按钮；校准失败时回退到零基线。
// 5. 映射层只负责输出权重和 lookAt 角度；不直接操作 three.js 对象。

export const FACE_MAP_VERSION = "0.1.0";

export const ARKIT_BLENDSHAPES = Object.freeze([
  "_neutral",
  "browDownLeft", "browDownRight", "browInnerUp",
  "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
  "eyeBlinkLeft", "eyeBlinkRight",
  "eyeLookDownLeft", "eyeLookDownRight",
  "eyeLookInLeft", "eyeLookInRight",
  "eyeLookOutLeft", "eyeLookOutRight",
  "eyeLookUpLeft", "eyeLookUpRight",
  "eyeSquintLeft", "eyeSquintRight",
  "eyeWideLeft", "eyeWideRight",
  "jawForward", "jawLeft", "jawOpen", "jawRight",
  "mouthClose", "mouthDimpleLeft", "mouthDimpleRight",
  "mouthFrownLeft", "mouthFrownRight", "mouthFunnel", "mouthLeft",
  "mouthLowerDownLeft", "mouthLowerDownRight",
  "mouthPressLeft", "mouthPressRight", "mouthPucker", "mouthRight",
  "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
  "mouthSmileLeft", "mouthSmileRight",
  "mouthStretchLeft", "mouthStretchRight",
  "mouthUpperUpLeft", "mouthUpperUpRight",
  "noseSneerLeft", "noseSneerRight",
]);

export const DEFAULT_OPTIONS = Object.freeze({
  calibrationFrames: 30,
  neutralThreshold: 0.5,
  smoothing: true,
  attackTau: 0.03,
  releaseTau: 0.12,
  blinkAttackTau: 0.015,
  blinkReleaseTau: 0.06,
  maxYaw: 30,
  maxPitch: 20,
});

const MOUTH_KEYS = ["aa", "ih", "ou", "ee", "oh"];
const EMOTION_KEYS = ["happy", "sad", "angry", "relaxed", "surprised"];

export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function maxOf(...values) {
  let out = 0;
  for (const value of values) {
    if (Number.isFinite(value) && value > out) out = value;
  }
  return out;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : 0.5 * (sorted[mid - 1] + sorted[mid]);
}

function pickFirst(available, names) {
  for (const name of names) {
    if (available.has(name)) return name;
  }
  return null;
}

function expressionNames(expressions) {
  if (!expressions) return [];
  if (Array.isArray(expressions)) return expressions.slice();
  return Object.keys(expressions);
}

/**
 * 把 MediaPipe 的 categories / Map / 普通对象统一成 {name: score}。
 * 支持 categoryName、category_name、name 三种键名。
 */
export function normalizeCategories(categories) {
  const out = {};
  if (!categories) return out;

  if (categories instanceof Map) {
    for (const [name, score] of categories) {
      if (typeof name === "string") out[name] = Number(score) || 0;
    }
    return out;
  }

  if (Array.isArray(categories)) {
    for (const item of categories) {
      if (!item) continue;
      const name = item.categoryName ?? item.category_name ?? item.name;
      if (typeof name === "string") out[name] = Number(item.score) || 0;
    }
    return out;
  }

  if (typeof categories === "object") {
    for (const [name, score] of Object.entries(categories)) {
      out[name] = Number(score) || 0;
    }
  }
  return out;
}

/**
 * 根据运行时模型能力生成 profile。
 *
 * @param {object} params
 * @param {string[]|object} [params.expressions] expressionMap 的键数组或对象
 * @param {string[]|object} [params.morphTargets] morphTargetDictionary 的名称数组或对象
 * @param {"bone"|"expression"|"none"|"auto"} [params.lookAtType]
 * @param {"VRM0"|"VRM1"|"unknown"} [params.format]
 * @param {object} [params.gains] 每个 canonical 通道的标量增益
 * @param {number} [params.maxYaw] 视线最大水平角，单位度
 * @param {number} [params.maxPitch] 视线最大垂直角，单位度
 */
export function buildProfile({
  expressions = [],
  morphTargets = [],
  lookAtType = "auto",
  format = "unknown",
  gains = {},
  maxYaw = DEFAULT_OPTIONS.maxYaw,
  maxPitch = DEFAULT_OPTIONS.maxPitch,
} = {}) {
  const names = expressionNames(expressions);
  const available = new Set(names);
  const morphNames = expressionNames(morphTargets);

  const aliases = {
    happy: pickFirst(available, ["happy", "joy"]),
    sad: pickFirst(available, ["sad", "sorrow"]),
    surprised: pickFirst(available, ["surprised", "Surprised", "surprise"]),
    relaxed: pickFirst(available, ["relaxed", "fun"]),
    angry: pickFirst(available, ["angry"]),
    aa: pickFirst(available, ["aa"]),
    ih: pickFirst(available, ["ih"]),
    ou: pickFirst(available, ["ou"]),
    ee: pickFirst(available, ["ee"]),
    oh: pickFirst(available, ["oh"]),
    blink: pickFirst(available, ["blink"]),
    blinkLeft: pickFirst(available, ["blinkLeft", "blink_l"]),
    blinkRight: pickFirst(available, ["blinkRight", "blink_r"]),
    lookUp: pickFirst(available, ["lookUp"]),
    lookDown: pickFirst(available, ["lookDown"]),
    lookLeft: pickFirst(available, ["lookLeft"]),
    lookRight: pickFirst(available, ["lookRight"]),
  };

  const hasSplitBlink = !!(aliases.blinkLeft && aliases.blinkRight);
  const hasLookExpressions = !!(aliases.lookUp || aliases.lookDown || aliases.lookLeft || aliases.lookRight);

  let resolvedLookAtType = lookAtType;
  if (lookAtType === "auto") {
    resolvedLookAtType = hasLookExpressions ? "expression" : "none";
  }

  return {
    version: FACE_MAP_VERSION,
    format,
    available,
    morphTargets: morphNames,
    aliases,
    hasSplitBlink,
    hasLookExpressions,
    lookAtType: resolvedLookAtType,
    gains: { ...gains },
    maxYaw,
    maxPitch,
  };
}

/**
 * 有状态映射器：自动中性校准 + 非对称平滑 + 52 -> VRM 映射。
 *
 * update() 的返回值：
 * {
 *   expressions: { [实际 expression 名]: 权重 },
 *   lookAt: { mode: "bone", yaw, pitch } | { mode: "expression" } | null,
 *   meta: { calibrated, calibrationFrames, gaze, ... }
 * }
 */
export class FaceMapper {
  constructor(profile, options = {}) {
    this.profile = profile;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.smoothed = null;
    this.neutral = null;
    this._calibration = [];
    this._calibrationDone = this.options.calibrationFrames <= 0;
  }

  resetCalibration() {
    this.neutral = null;
    this._calibration = [];
    this._calibrationDone = this.options.calibrationFrames <= 0;
  }

  reset() {
    this.smoothed = null;
    this.resetCalibration();
  }

  /**
   * @param {Array|Map|object} categories MediaPipe categories 或 {name: score}
   * @param {object} [opts]
   * @param {number} [opts.dt] 秒
   * @param {boolean} [opts.mirror] 摄像头预览镜像
   */
  update(categories, { dt = 1 / 30, mirror = false } = {}) {
    const raw = normalizeCategories(categories);
    if (!this._calibrationDone) this._collectNeutral(raw);
    const calibrated = this._calibrate(raw);
    const smoothed = this._smooth(calibrated, dt);
    return this._map(smoothed, mirror);
  }

  _collectNeutral(raw) {
    const frames = this.options.calibrationFrames;
    if (frames <= 0) {
      this._calibrationDone = true;
      return;
    }

    const neutralScore = raw._neutral;
    const gated = neutralScore == null || neutralScore >= this.options.neutralThreshold;
    if (!gated && this._calibration.length < frames * 2) {
      return;
    }

    this._calibration.push({ ...raw });
    if (this._calibration.length < frames) return;

    const keys = new Set();
    for (const frame of this._calibration) {
      for (const key of Object.keys(frame)) keys.add(key);
    }
    const neutral = {};
    for (const key of keys) {
      const values = this._calibration
        .map((frame) => frame[key])
        .filter((value) => Number.isFinite(value));
      neutral[key] = median(values);
    }
    this.neutral = neutral;
    this._calibrationDone = true;
  }

  _calibrate(raw) {
    if (!this.neutral) {
      const out = {};
      for (const [key, value] of Object.entries(raw)) out[key] = clamp01(value);
      return out;
    }
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
      const baseline = this.neutral[key] ?? 0;
      const denom = Math.max(1e-6, 1 - baseline);
      out[key] = clamp01((value - baseline) / denom);
    }
    return out;
  }

  _smooth(target, dt) {
    if (!this.options.smoothing) {
      this.smoothed = { ...target };
      return this.smoothed;
    }

    const step = Math.min(0.25, Math.max(1 / 240, Number(dt) || 1 / 30));
    const keys = new Set([
      ...Object.keys(this.smoothed || {}),
      ...Object.keys(target),
    ]);
    const out = {};

    for (const key of keys) {
      const next = target[key] ?? 0;
      const prev = this.smoothed?.[key] ?? 0;
      const isBlink = key === "blink" || key === "eyeBlinkLeft" || key === "eyeBlinkRight";
      const tau = next > prev
        ? (isBlink ? this.options.blinkAttackTau : this.options.attackTau)
        : (isBlink ? this.options.blinkReleaseTau : this.options.releaseTau);
      const alpha = tau <= 0 ? 1 : 1 - Math.exp(-step / tau);
      out[key] = prev + (next - prev) * Math.min(1, Math.max(0, alpha));
    }

    this.smoothed = out;
    return out;
  }

  _map(scores, mirror) {
    const v = (name) => scores[name] ?? 0;
    const p = this.profile;
    const aliases = p.aliases;

    const blinkL = mirror ? v("eyeBlinkRight") : v("eyeBlinkLeft");
    const blinkR = mirror ? v("eyeBlinkLeft") : v("eyeBlinkRight");
    const smile = maxOf(v("mouthSmileLeft"), v("mouthSmileRight"));
    const frown = maxOf(v("mouthFrownLeft"), v("mouthFrownRight"));
    const browDown = maxOf(v("browDownLeft"), v("browDownRight"));
    const browInner = v("browInnerUp");
    const browOuter = maxOf(v("browOuterUpLeft"), v("browOuterUpRight"));
    const browUp = maxOf(browInner, browOuter);
    const cheekSquint = maxOf(v("cheekSquintLeft"), v("cheekSquintRight"));
    const eyeWide = maxOf(v("eyeWideLeft"), v("eyeWideRight"));
    const eyeSquint = maxOf(v("eyeSquintLeft"), v("eyeSquintRight"));
    const noseSneer = maxOf(v("noseSneerLeft"), v("noseSneerRight"));
    const mouthPress = maxOf(v("mouthPressLeft"), v("mouthPressRight"));
    const mouthLower = maxOf(v("mouthLowerDownLeft"), v("mouthLowerDownRight"));
    const mouthStretch = maxOf(v("mouthStretchLeft"), v("mouthStretchRight"));
    const jaw = v("jawOpen");

    // 口型只在“确实在说话”时启用，避免单纯微笑把 ih/ee 带起来。
    const speech = maxOf(jaw, mouthStretch);

    // browInnerUp 同时出现在悲伤和惊讶里。用 eyeWide / browOuterUp
    // 作为“更像惊讶”的证据，抑制悲伤中的惊讶成分，反之亦然。
    const sadBrow = browInner * (1 - eyeWide) * (1 - browOuter);
    const surpriseEvidence = maxOf(eyeWide, browOuter);

    const values = {
      happy: 0.70 * smile + 0.30 * cheekSquint,
      sad: 0.55 * frown + 0.30 * mouthLower + 0.15 * sadBrow,
      angry: 0.60 * browDown + 0.25 * noseSneer + 0.15 * mouthPress,
      relaxed: 0.50 * eyeSquint + 0.50 * smile,
      surprised: 0.45 * browUp * (0.35 + 0.65 * surpriseEvidence)
        + 0.35 * eyeWide
        + 0.20 * jaw * surpriseEvidence,
      aa: jaw,
      ih: speech * (0.50 * smile + 0.50 * mouthStretch),
      ou: v("mouthPucker"),
      ee: speech * (0.60 * mouthStretch + 0.40 * smile),
      oh: v("mouthFunnel"),
    };

    // 口型组和情绪组分别归一，避免多个 expression 叠加过驱动。
    normalizeGroup(values, MOUTH_KEYS.filter((key) => aliases[key]));
    normalizeGroup(values, EMOTION_KEYS.filter((key) => aliases[key]));

    const expressions = {};
    const put = (canonical, actual) => {
      if (!actual) return;
      const gain = Number.isFinite(p.gains?.[canonical]) ? p.gains[canonical] : 1;
      expressions[actual] = clamp01(values[canonical] * gain);
    };

    put("happy", aliases.happy);
    put("sad", aliases.sad);
    put("angry", aliases.angry);
    put("relaxed", aliases.relaxed);
    put("surprised", aliases.surprised);
    put("aa", aliases.aa);
    put("ih", aliases.ih);
    put("ou", aliases.ou);
    put("ee", aliases.ee);
    put("oh", aliases.oh);

    if (p.hasSplitBlink) {
      expressions[aliases.blinkLeft] = clamp01(blinkL);
      expressions[aliases.blinkRight] = clamp01(blinkR);
      // 分眼模式必须显式清零合并眨眼，避免旧值残留或被叠加。
      if (aliases.blink) expressions[aliases.blink] = 0;
    } else if (aliases.blink) {
      expressions[aliases.blink] = clamp01(Math.max(blinkL, blinkR));
      if (aliases.blinkLeft) expressions[aliases.blinkLeft] = 0;
      if (aliases.blinkRight) expressions[aliases.blinkRight] = 0;
    }

    const gaze = this._gaze(scores, mirror);
    if (gaze.mode === "expression") {
      if (aliases.lookUp) expressions[aliases.lookUp] = clamp01(gaze.up);
      if (aliases.lookDown) expressions[aliases.lookDown] = clamp01(gaze.down);
      if (aliases.lookLeft) expressions[aliases.lookLeft] = clamp01(gaze.left);
      if (aliases.lookRight) expressions[aliases.lookRight] = clamp01(gaze.right);
    } else if (gaze.mode === "bone") {
      // 骨骼模式要清零可能存在的 look* expression，避免旧值残留。
      if (aliases.lookUp) expressions[aliases.lookUp] = 0;
      if (aliases.lookDown) expressions[aliases.lookDown] = 0;
      if (aliases.lookLeft) expressions[aliases.lookLeft] = 0;
      if (aliases.lookRight) expressions[aliases.lookRight] = 0;
    }

    return {
      expressions,
      lookAt: gaze.mode === "bone"
        ? { mode: "bone", yaw: gaze.yaw, pitch: gaze.pitch }
        : null,
      meta: {
        version: FACE_MAP_VERSION,
        calibrated: this._calibrationDone,
        calibrationFrames: this._calibration.length,
        mirror,
        gaze,
      },
    };
  }

  _gaze(scores, mirror) {
    const p = this.profile;
    const v = (name) => scores[name] ?? 0;
    const left = 0.5 * (v("eyeLookOutLeft") + v("eyeLookInRight"));
    const right = 0.5 * (v("eyeLookInLeft") + v("eyeLookOutRight"));
    const up = 0.5 * (v("eyeLookUpLeft") + v("eyeLookUpRight"));
    const down = 0.5 * (v("eyeLookDownLeft") + v("eyeLookDownRight"));

    let yaw = (left - right) * p.maxYaw;
    const pitch = (up - down) * p.maxPitch;
    if (mirror) yaw = -yaw;

    if (p.lookAtType === "bone") {
      return { mode: "bone", yaw, pitch, left, right, up, down };
    }
    if (p.lookAtType === "expression" && p.hasLookExpressions) {
      return {
        mode: "expression",
        yaw,
        pitch,
        left: clamp01(left),
        right: clamp01(right),
        up: clamp01(up),
        down: clamp01(down),
      };
    }
    return { mode: "none", yaw: 0, pitch: 0, left, right, up, down };
  }
}

function normalizeGroup(values, keys) {
  let sum = 0;
  for (const key of keys) sum += values[key] ?? 0;
  if (sum <= 1) return;
  for (const key of keys) values[key] = (values[key] ?? 0) / sum;
}

/**
 * 给接入方/诊断页用的简短描述。
 */
export function describeProfile(profile) {
  return {
    version: profile.version,
    format: profile.format,
    expressionCount: profile.available.size,
    morphTargetCount: profile.morphTargets.length,
    hasSplitBlink: profile.hasSplitBlink,
    hasLookExpressions: profile.hasLookExpressions,
    lookAtType: profile.lookAtType,
    aliases: { ...profile.aliases },
  };
}
