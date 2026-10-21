# VRM 面部映射 P0-1 / P0-2

本目录是模型线的独立映射模块，不依赖 three.js，也不修改 `showcase/` 下的展示线文件。

## 文件

| 文件 | 内容 |
|---|---|
| `facemap.mjs` | P0-1：52 ARKit -> VRM preset 的纯映射、自动中性校准、非对称平滑、骨骼视线 |
| `morphscan.mjs` | P0-2：扫描已有 morph target，生成运行时 custom expression profile |
| `facemap.test.mjs` | P0-1 回归测试 |
| `morphscan.test.mjs` | P0-2 回归测试 |

## 为什么需要它

仓库现有 VRM 资产全部是 VRM 0.x。three-vrm 3.5.3 导入时会把：

- `joy` -> `happy`
- `sorrow` -> `sad`
- `unknown` -> 组名，例如 `Surprised`
- `fun` -> `relaxed`

P0-1 落地前，展示线代码曾写入 `joy`、`sorrow`、`surprise`，这些名称在 VRM 0.x 资产上不存在，`setValue` 会静默无效；视线也曾写入空的 `lookUp/Down/Left/Right` expression，而现有模型的 `lookAtTypeName` 全部是 `Bone`。当前实现已由 PR #22/#23 接入 `avatar.js`，本目录保留为上游源码、测试与接口说明。

P0-1 按运行时 `expressionMap` 的实际名称解析，不硬编码旧名称；视线优先输出 `vrm.lookAt.yaw/pitch`。

P0-2 进一步利用模型里已经存在、但 preset 没有使用的 `BRW_*`、`EYE_*`、`MTH_*` 目标，在运行时生成 custom expression。`sample-a` 生成 20 个，`sample-b`、`three-vrm-girl` 生成 21 个。

## 运行测试

```powershell
cd D:\DASH\V0FastTest
node --test tools/vrm_face/facemap.test.mjs tools/vrm_face/morphscan.test.mjs
```

当前 37 项测试全部通过。

## P0-1：preset 映射

```js
// 从 showcase/frontend/src/avatar.js 出发的相对路径：
import { buildProfile, FaceMapper } from "../../../tools/vrm_face/facemap.mjs";

const morphTargets = [];
vrm.scene.traverse((object) => {
  if (object.isMesh && object.morphTargetDictionary) {
    for (const name of Object.keys(object.morphTargetDictionary)) {
      morphTargets.push(name);
    }
  }
});

const profile = buildProfile({
  expressions: Object.keys(vrm.expressionManager?.expressionMap ?? {}),
  morphTargets,
  lookAtType: vrm.lookAt?.applier?.constructor?.type ?? "auto", // "bone" | "expression" | "none" | "auto"
  format: "VRM0", // 仅用于诊断；不影响映射
});

const faceMapper = new FaceMapper(profile);

const out = faceMapper.update(cats, { dt: 1 / 30, mirror });

for (const [name, weight] of Object.entries(out.expressions)) {
  vrm.expressionManager.setValue(name, weight);
}

if (out.lookAt?.mode === "bone" && vrm.lookAt) {
  vrm.lookAt.autoUpdate = false;
  vrm.lookAt.yaw = out.lookAt.yaw;
  vrm.lookAt.pitch = out.lookAt.pitch;
}
```

## P0-2：运行时 custom expression

### 1. 生成 profile

```js
import {
  buildCustomProfile,
  CustomFaceMapper,
  describeCustomProfile,
  groupBindsByMesh,
} from "../../../tools/vrm_face/morphscan.mjs";

const morphTargets = [];
vrm.scene.traverse((object) => {
  if (object.isMesh && object.morphTargetDictionary) {
    for (const name of Object.keys(object.morphTargetDictionary)) {
      morphTargets.push(name);
    }
  }
});

const customProfile = buildCustomProfile({
  morphTargets,
  expressions: Object.keys(vrm.expressionManager?.expressionMap ?? {}),
  lookAtType: vrm.lookAt?.applier?.constructor?.type ?? "auto",
  format: "VRM0",
});

console.table(describeCustomProfile(customProfile));

const faceMapper = new CustomFaceMapper(customProfile);
```

`describeCustomProfile()` 会列出生成数量、已用 target、被跳过的通道及原因。例如 `sample-a` 没有 `MTH_Close`，`mouthClose` 会以 `target-missing` 跳过。

### 2. 注入 three-vrm

```js
import { VRMExpression, VRMExpressionMorphTargetBind } from "@pixiv/three-vrm";

function injectCustomExpressions(vrm, profile) {
  const meshes = [];
  vrm.scene.traverse((object) => {
    if (object.isMesh && object.morphTargetDictionary) meshes.push(object);
  });

  for (const { def, groups } of groupBindsByMesh(meshes, profile)) {
    if (!groups.length) continue;
    const expression = new VRMExpression(def.name);
    for (const group of groups) {
      expression.addBind(new VRMExpressionMorphTargetBind({
        primitives: group.primitives,
        index: group.index,
        weight: group.weight,
      }));
    }
    expression.overrideBlink = def.overrideBlink;
    expression.overrideMouth = def.overrideMouth;
    vrm.scene.add(expression);
    vrm.expressionManager.registerExpression(expression);
  }
}
```

同一个 morph target 可能出现在多个 mesh/primitive 上。上面的做法按 `index + weight` 分组，把同组 mesh 一起传给一个 bind，避免重复绑定。

### 3. 每帧更新

```js
const out = faceMapper.update(cats, { dt: 1 / 30, mirror });

for (const [name, weight] of Object.entries(out.expressions)) {
  vrm.expressionManager.setValue(name, weight);
}

if (out.lookAt?.mode === "bone" && vrm.lookAt) {
  vrm.lookAt.autoUpdate = false;
  vrm.lookAt.yaw = out.lookAt.yaw;
  vrm.lookAt.pitch = out.lookAt.pitch;
}
```

### 4. 切换模式时清理旧 preset

custom 模式不驱动 `ALL_*` 全脸情绪。如果从 preset 模式切换过来，需要先清一次：

```js
vrm.expressionManager.resetValues();
for (const name of customProfile.presetNamesToClear) {
  vrm.expressionManager.setValue(name, 0);
}
```

之后只写 `out.expressions` 里的 `arkit_*` 名称。`resetValues()` 也会清零 custom expression，下一帧 mapper 会重新写入。

## 接入注意

1. `dt` 单位是秒。展示线当前在 `tick(t)` 里用毫秒，需要除以 1000。
2. `mirror` 会交换左右眼眨眼/眯眼，并翻转 `lookAt.yaw`；头部 yaw/roll 仍由现有 `setHeadEuler` 负责，两者不要重复。
3. 自动中性校准默认采集 30 帧，优先使用 `_neutral` 高的帧；没有手动校准按钮。模型切换或页面复位时调用 `faceMapper.reset()`。
4. 复位时建议调用 `vrm.expressionManager.resetValues()`，不要继续硬编码 `blink/aa/joy/...` 名称。
5. `buildCustomProfile` 的 `morphTargets` 来自 `morphTargetDictionary`；同一个 target 只绑定一个 custom expression。
6. 本模块只输出它控制的 expression。`Extra`、`neutral` 等未控制项不会被清零；页面复位时应统一 `resetValues()`。
7. custom 模式下，情绪由 granular 眉/眼/嘴通道组合出来，不再使用 `happy/sad/angry/Surprised` 的 `ALL_*` 组合。不要在 custom 模式同时写这些 preset。

## 设计要点

- P0-1 口型组和情绪组分别归一，避免多个 expression 叠加过驱动。
- 单纯微笑不会单独驱动 `ih/ee`；`ih/ee` 需要 `jawOpen` 或 `mouthStretch` 作为说话证据。
- `browInnerUp` 同时出现在悲伤和惊讶里，用 `eyeWide`/`browOuterUp` 做区分。
- P0-2 同一 morph target 只绑定一次，避免 `morphTargetInfluences +=` 双重计数。
- P0-2 的 `eyeWide` 优先 `EYE_Spread`，没有时回退 `EYE_Surprised`。
- P0-2 的 `mouthClose` 依赖 `MTH_Close`；`sample-a` 没有该目标，会被跳过。
- P0-2 的 `mouthStretch` 优先绑定 `MTH_I`，缺失时回退 `MTH_E`；当前每个 expression 只绑定第一个存在的目标。
- 分眼眨眼模式会显式把 `blink` 置 0；合并眨眼模式会显式把 `blinkLeft/Right` 置 0。
- `_neutral` 只用于校准门控，不驱动 VRM 的 `neutral` expression。

## 同步约定

`showcase/frontend/src/vrm_face/facemap.mjs` 与 `showcase/frontend/src/vrm_face/morphscan.mjs` 是运行副本，内容必须与本目录保持一致。修改本目录后请同时覆盖运行副本，并在提交前比较两份文件；展示线只改运行副本时，也应把改动回写到本目录，避免上下游漂移。
