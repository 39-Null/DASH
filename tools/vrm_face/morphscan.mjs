// DASH 面部映射 P0-2：扫描已有 morph target，生成运行时 custom expression。
//
// 目标：不重新建模，利用 VRoid 资产里已存在的 BRW_* / EYE_* / MTH_* 目标，
// 把 52 维 ARKit 输入拆成更细的眉、眼、嘴通道。
//
// 设计约束：
// 1. 纯 ES module，不依赖 three.js；调用方传入 morphTargetDictionary 的名称。
// 2. 同一 morph target 只绑定一个自定义 expression，避免 three-vrm 的
//    morphTargetInfluences += 造成双重计数。
// 3. 只在目标存在时生成 expression；缺失的通道进入 skipped，便于诊断。
// 4. 自定义模式不驱动 ALL_* 全脸情绪；调用方应在切换模式时 resetValues()，
//    或按 presetNamesToClear 清零旧 preset。

import {
  FaceMapper,
  DEFAULT_OPTIONS,
  clamp01,
  maxOf,
} from "./facemap.mjs";

export const CUSTOM_MAP_VERSION = "0.1.0";

const PRESET_NAMES = [
  "aa", "ih", "ou", "ee", "oh",
  "blink", "blinkLeft", "blinkRight",
  "happy", "sad", "angry", "relaxed", "surprised", "Surprised",
  "lookUp", "lookDown", "lookLeft", "lookRight",
  // 兼容旧代码可能使用的名称；存在时一并清零。
  "joy", "sorrow", "fun", "surprise",
];

const MAX = (...channels) => ({ type: "max", channels });
const CHANNEL = (channel) => ({ type: "channel", channel });
const DERIVED = (name) => ({ type: "derived", name });
const SCALE = (source, factor) => ({ type: "scale", source, factor });

/**
 * 每个 part 按顺序尝试候选 target；一旦绑定成功，target 进入 usedTargets。
 * source 在该 expression 的权重上求值，输入是校准/平滑后的 52 维分数。
 */
export const CUSTOM_PART_DEFS = Object.freeze([
  {
    id: "browDown",
    targets: ["brw_angry"],
    source: MAX("browDownLeft", "browDownRight"),
    description: "BRW_Angry：压低眉毛",
  },
  {
    id: "browSorrow",
    targets: ["brw_sorrow"],
    source: DERIVED("sadBrow"),
    description: "BRW_Sorrow：悲伤眉，使用 sadBrow 派生量",
  },
  {
    id: "browInnerUp",
    targets: ["brw_surprised"],
    source: CHANNEL("browInnerUp"),
    description: "BRW_Surprised：内侧抬眉",
  },
  {
    id: "browOuterUp",
    targets: ["brw_fun", "brw_joy"],
    source: MAX("browOuterUpLeft", "browOuterUpRight"),
    description: "BRW_Fun/BRW_Joy：外侧抬眉",
  },

  {
    id: "eyeBlinkLeft",
    targets: ["eye_close_l"],
    source: CHANNEL("eyeBlinkLeft"),
    lateral: true,
    overrideBlink: "block",
    description: "EYE_Close_L：左眼闭合",
  },
  {
    id: "eyeBlinkRight",
    targets: ["eye_close_r"],
    source: CHANNEL("eyeBlinkRight"),
    lateral: true,
    overrideBlink: "block",
    description: "EYE_Close_R：右眼闭合",
  },
  {
    id: "eyeWide",
    targets: ["eye_spread", "eye_surprised"],
    source: MAX("eyeWideLeft", "eyeWideRight"),
    description: "EYE_Spread/EYE_Surprised：睁大眼睛",
  },
  {
    id: "eyeSquintLeft",
    targets: ["eye_joy_l"],
    source: CHANNEL("eyeSquintLeft"),
    lateral: true,
    overrideBlink: "blend",
    description: "EYE_Joy_L：左眼眯起",
  },
  {
    id: "eyeSquintRight",
    targets: ["eye_joy_r"],
    source: CHANNEL("eyeSquintRight"),
    lateral: true,
    overrideBlink: "blend",
    description: "EYE_Joy_R：右眼眯起",
  },
  {
    id: "eyeSorrow",
    targets: ["eye_sorrow"],
    source: DERIVED("sadBrow"),
    overrideBlink: "blend",
    description: "EYE_Sorrow：悲伤眼型",
  },
  {
    id: "eyeAngry",
    targets: ["eye_angry"],
    source: SCALE(MAX("browDownLeft", "browDownRight"), 0.8),
    overrideBlink: "blend",
    description: "EYE_Angry：愤怒眼型",
  },
  {
    id: "cheekSquint",
    targets: ["eye_joy"],
    source: MAX("cheekSquintLeft", "cheekSquintRight"),
    skipIfPresent: ["eyeSquintLeft", "eyeSquintRight"],
    description: "EYE_Joy：脸颊眯眼；已有左右眼眯起时跳过，避免重复",
  },

  {
    id: "jawOpen",
    targets: ["mth_a"],
    source: CHANNEL("jawOpen"),
    overrideMouth: "blend",
    description: "MTH_A：张口",
  },
  {
    id: "mouthSmile",
    targets: ["mth_joy"],
    source: MAX("mouthSmileLeft", "mouthSmileRight"),
    overrideMouth: "blend",
    description: "MTH_Joy：嘴角上扬",
  },
  {
    id: "mouthFrown",
    targets: ["mth_sorrow"],
    source: MAX("mouthFrownLeft", "mouthFrownRight"),
    overrideMouth: "blend",
    description: "MTH_Sorrow：嘴角下垂",
  },
  {
    id: "mouthPucker",
    targets: ["mth_u"],
    source: CHANNEL("mouthPucker"),
    overrideMouth: "blend",
    description: "MTH_U：撅嘴",
  },
  {
    id: "mouthFunnel",
    targets: ["mth_o"],
    source: CHANNEL("mouthFunnel"),
    overrideMouth: "blend",
    description: "MTH_O：圆唇",
  },
  {
    id: "mouthStretch",
    targets: ["mth_i", "mth_e"],
    source: MAX("mouthStretchLeft", "mouthStretchRight"),
    overrideMouth: "blend",
    description: "MTH_I/MTH_E：嘴角横向拉伸",
  },
  {
    id: "mouthLowerDown",
    targets: ["mth_down"],
    source: MAX("mouthLowerDownLeft", "mouthLowerDownRight"),
    overrideMouth: "blend",
    description: "MTH_Down：下唇下拉",
  },
  {
    id: "mouthUpperUp",
    targets: ["mth_up"],
    source: MAX("mouthUpperUpLeft", "mouthUpperUpRight"),
    overrideMouth: "blend",
    description: "MTH_Up：上唇上提",
  },
  {
    id: "mouthClose",
    targets: ["mth_close"],
    source: MAX("mouthClose", "mouthPressLeft", "mouthPressRight"),
    overrideMouth: "blend",
    description: "MTH_Close：闭唇/压唇",
  },
  {
    id: "mouthAngry",
    targets: ["mth_angry"],
    source: SCALE(MAX("browDownLeft", "browDownRight"), 0.5),
    overrideMouth: "blend",
    description: "MTH_Angry：愤怒嘴型，由压眉派生",
  },
]);

function expressionNames(expressions) {
  if (!expressions) return [];
  if (Array.isArray(expressions)) return expressions.slice();
  return Object.keys(expressions);
}

/**
 * 把 morph target 名称归一化成语义 key。
 * 例如 Face.M_F00_000_00_Fcl_BRW_Angry -> brw_angry。
 */
export function normalizeMorphTargetName(name) {
  if (typeof name !== "string" || !name) return "";
  let key = name.toLowerCase();
  const fclAt = key.lastIndexOf("fcl_");
  if (fclAt >= 0) {
    key = key.slice(fclAt + 4);
  } else {
    // EyeExtra_01.M_F00_000_00_EyeExtra_On 这类名称没有 Fcl_ 前缀，
    // 用已知语义前缀截取；注意 eyeextra 要排在 eye 前面。
    const semantic = key.match(/.*((?:eyeextra|brw|eye|mth|ha|all)_.*)$/);
    if (semantic) key = semantic[1];
    else if (key.includes(".")) key = key.slice(key.lastIndexOf(".") + 1);
  }
  return key;
}

/**
 * 扫描 morph target 名称，按区域分组。
 */
export function scanMorphTargets(names) {
  const targets = [];
  const seen = new Set();
  const byKey = new Map();
  const groups = {
    brow: [],
    eye: [],
    mouth: [],
    hair: [],
    combined: [],
    other: [],
  };

  for (const raw of names || []) {
    if (typeof raw !== "string" || !raw || seen.has(raw)) continue;
    seen.add(raw);
    targets.push(raw);
    const key = normalizeMorphTargetName(raw);
    if (key && !byKey.has(key)) byKey.set(key, raw);

    if (key.startsWith("brw_")) groups.brow.push(raw);
    else if (key.startsWith("eye_")) groups.eye.push(raw);
    else if (key.startsWith("mth_")) groups.mouth.push(raw);
    else if (key.startsWith("ha_")) groups.hair.push(raw);
    else if (key.startsWith("all_")) groups.combined.push(raw);
    else groups.other.push(raw);
  }

  return {
    version: CUSTOM_MAP_VERSION,
    targets,
    byKey,
    groups,
    faceRelevant: [...groups.brow, ...groups.eye, ...groups.mouth],
  };
}

function findTarget(scan, candidates) {
  for (const key of candidates) {
    const target = scan.byKey.get(key);
    if (target) return target;
  }
  return null;
}

function lookAliases(available) {
  return {
    lookUp: available.has("lookUp") ? "lookUp" : null,
    lookDown: available.has("lookDown") ? "lookDown" : null,
    lookLeft: available.has("lookLeft") ? "lookLeft" : null,
    lookRight: available.has("lookRight") ? "lookRight" : null,
  };
}

/**
 * 根据模型的 morph target 名称生成 custom profile。
 *
 * @param {object} params
 * @param {string[]|object} [params.morphTargets] morphTargetDictionary 的键
 * @param {string[]|object} [params.expressions] expressionMap 的键，用于清理 preset
 * @param {"bone"|"expression"|"none"} [params.lookAtType]
 * @param {"VRM0"|"VRM1"|"unknown"} [params.format]
 * @param {object} [params.gains] 按 part id 或 arkit_* 名称覆盖增益
 * @param {number} [params.maxYaw]
 * @param {number} [params.maxPitch]
 */
export function buildCustomProfile({
  morphTargets = [],
  expressions = [],
  lookAtType = "bone",
  format = "unknown",
  gains = {},
  maxYaw = DEFAULT_OPTIONS.maxYaw,
  maxPitch = DEFAULT_OPTIONS.maxPitch,
} = {}) {
  const scan = scanMorphTargets(expressionNames(morphTargets));
  const available = new Set(expressionNames(expressions));
  const usedTargets = new Set();
  const createdIds = new Set();
  const definitions = [];
  const skipped = [];

  for (const part of CUSTOM_PART_DEFS) {
    if (part.skipIfPresent?.some((id) => createdIds.has(id))) {
      skipped.push({
        id: part.id,
        reason: "skipped-by-rule",
        targets: part.targets,
      });
      continue;
    }

    const target = findTarget(scan, part.targets);
    if (!target) {
      skipped.push({
        id: part.id,
        reason: "target-missing",
        targets: part.targets,
      });
      continue;
    }

    if (usedTargets.has(target)) {
      skipped.push({
        id: part.id,
        reason: "target-already-used",
        target,
      });
      continue;
    }

    usedTargets.add(target);
    createdIds.add(part.id);

    const name = `arkit_${part.id}`;
    const gain = Number.isFinite(gains[part.id])
      ? gains[part.id]
      : Number.isFinite(gains[name])
        ? gains[name]
        : 1;

    definitions.push({
      id: part.id,
      name,
      target,
      binds: [{ target, weight: 1 }],
      source: part.source,
      lateral: !!part.lateral,
      overrideBlink: part.overrideBlink ?? "none",
      overrideMouth: part.overrideMouth ?? "none",
      gain,
      description: part.description,
    });
  }

  const aliases = lookAliases(available);
  const hasLookExpressions = Object.values(aliases).some(Boolean);
  let resolvedLookAtType = lookAtType;
  if (lookAtType === "auto") {
    resolvedLookAtType = hasLookExpressions ? "expression" : "none";
  }

  return {
    version: CUSTOM_MAP_VERSION,
    mode: "custom",
    format,
    expressions: definitions,
    byName: Object.fromEntries(definitions.map((def) => [def.name, def])),
    usedTargets: [...usedTargets],
    skipped,
    scan: {
      targetCount: scan.targets.length,
      byKeyCount: scan.byKey.size,
      groups: Object.fromEntries(
        Object.entries(scan.groups).map(([key, values]) => [key, values.length])
      ),
      faceRelevant: scan.faceRelevant,
    },
    aliases,
    hasLookExpressions,
    lookAtType: resolvedLookAtType,
    maxYaw,
    maxPitch,
    gains: { ...gains },
    presetNamesToClear: PRESET_NAMES.filter((name) => available.has(name)),
  };
}

/**
 * 把 profile 的 target 名称解析到实际 mesh/index，并按 index + weight 分组。
 * 返回 [{ def, groups: [{ index, weight, primitives }] }]。
 *
 * 同一个 target 可能出现在多个 mesh/primitive 上；three-vrm 的
 * VRMExpressionMorphTargetBind 接受一个 index 和一组 primitives，
 * 因此这里按 index 分组，避免同一 mesh 被重复绑定。
 */
export function groupBindsByMesh(meshes, profile) {
  const result = [];
  for (const def of profile.expressions) {
    const groups = new Map();
    for (const bind of def.binds) {
      for (const mesh of meshes) {
        const index = mesh?.morphTargetDictionary?.[bind.target];
        if (!Number.isInteger(index)) continue;
        const key = `${index}|${bind.weight}`;
        if (!groups.has(key)) {
          groups.set(key, {
            index,
            weight: bind.weight,
            primitives: [],
          });
        }
        const group = groups.get(key);
        if (!group.primitives.includes(mesh)) group.primitives.push(mesh);
      }
    }
    result.push({ def, groups: [...groups.values()] });
  }
  return result;
}

function swapLateralScores(scores) {
  const out = { ...scores };
  for (const [key, value] of Object.entries(scores)) {
    if (!key.includes("Left") && !key.includes("Right")) continue;
    const swapped = key.replace(/Left|Right/g, (match) =>
      match === "Left" ? "Right" : "Left"
    );
    out[swapped] = value;
  }
  return out;
}

function computeDerived(scores) {
  const v = (name) => scores[name] ?? 0;
  const browInner = v("browInnerUp");
  const browOuter = maxOf(v("browOuterUpLeft"), v("browOuterUpRight"));
  const eyeWide = maxOf(v("eyeWideLeft"), v("eyeWideRight"));
  const browDown = maxOf(v("browDownLeft"), v("browDownRight"));
  return {
    browDown,
    browInner,
    browOuter,
    eyeWide,
    // 与 P0-1 一致：内侧抬眉在眼大/外侧抬眉时更像惊讶，否则更像悲伤。
    sadBrow: browInner * (1 - eyeWide) * (1 - browOuter),
  };
}

function evaluateSource(source, scores, derived) {
  if (!source) return 0;
  if (source.type === "channel") return scores[source.channel] ?? 0;
  if (source.type === "max") {
    return maxOf(...source.channels.map((channel) => scores[channel] ?? 0));
  }
  if (source.type === "derived") return derived[source.name] ?? 0;
  if (source.type === "scale") {
    return evaluateSource(source.source, scores, derived) * (source.factor ?? 1);
  }
  return 0;
}

/**
 * 自定义模式映射器。复用 FaceMapper 的中性校准和平滑，只替换最后的映射阶段。
 */
export class CustomFaceMapper extends FaceMapper {
  _map(scores, mirror) {
    const derived = computeDerived(scores);
    const lateralScores = mirror ? swapLateralScores(scores) : scores;
    const expressions = {};

    for (const def of this.profile.expressions) {
      const sourceScores = def.lateral ? lateralScores : scores;
      const raw = evaluateSource(def.source, sourceScores, derived);
      expressions[def.name] = clamp01(raw * (def.gain ?? 1));
    }

    const gaze = this._gaze(scores, mirror);
    if (gaze.mode === "expression") {
      const aliases = this.profile.aliases;
      if (aliases.lookUp) expressions[aliases.lookUp] = clamp01(gaze.up);
      if (aliases.lookDown) expressions[aliases.lookDown] = clamp01(gaze.down);
      if (aliases.lookLeft) expressions[aliases.lookLeft] = clamp01(gaze.left);
      if (aliases.lookRight) expressions[aliases.lookRight] = clamp01(gaze.right);
    } else if (gaze.mode === "bone") {
      const aliases = this.profile.aliases;
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
        version: CUSTOM_MAP_VERSION,
        mode: "custom",
        calibrated: this._calibrationDone,
        calibrationFrames: this._calibration.length,
        mirror,
        gaze,
        expressionCount: this.profile.expressions.length,
      },
    };
  }
}

/**
 * 诊断用摘要；不包含完整 source，避免日志过大。
 */
export function describeCustomProfile(profile) {
  return {
    version: profile.version,
    mode: profile.mode,
    format: profile.format,
    expressionCount: profile.expressions.length,
    usedTargets: profile.usedTargets.slice(),
    skipped: profile.skipped.map((item) => ({ ...item })),
    lookAtType: profile.lookAtType,
    presetNamesToClear: profile.presetNamesToClear.slice(),
  };
}
