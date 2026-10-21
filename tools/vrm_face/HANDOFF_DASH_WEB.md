# DASH-Web pane 交接单：VRM 面部映射接口

> 来源：模型线  
> 日期：2026-10-21  
> 状态：P0-1 / P0-2 模块已实现并通过测试；尚未接入 `showcase/frontend/src/avatar.js`
> 约束：模型线不修改展示线文件；以下接入由 DASH-Web pane 执行

---

## 0. 一句话

模型线提供了两个纯 ES module，不依赖 three.js，也不依赖浏览器：

- `tools/vrm_face/facemap.mjs`：P0-1，修好 preset 名称、分眼眨眼、骨骼视线、中性校准、平滑。
- `tools/vrm_face/morphscan.mjs`：P0-2，扫描已有 morph target，生成运行时 custom expression。

DASH-Web 只需在 `avatar.js` 做三件事：加载后建 profile/mapper、每帧调用 `update()`、把结果写回 three-vrm。

---

## 1. 文件与导入

| 文件 | 用途 |
|---|---|
| `tools/vrm_face/facemap.mjs` | P0-1 preset 映射 |
| `tools/vrm_face/morphscan.mjs` | P0-2 custom expression |
| `tools/vrm_face/README.md` | 完整接入示例 |
| `tools/vrm_face/facemap.test.mjs` | P0-1 回归测试 |
| `tools/vrm_face/morphscan.test.mjs` | P0-2 回归测试 |

从 `showcase/frontend/src/avatar.js` 出发：

```js
import {
  buildProfile,
  FaceMapper,
} from "../../../tools/vrm_face/facemap.mjs";

import {
  buildCustomProfile,
  CustomFaceMapper,
  describeCustomProfile,
  groupBindsByMesh,
} from "../../../tools/vrm_face/morphscan.mjs";
```

如果最终要把模块 vendored 到 `showcase/frontend/src/`，保持文件内容不变即可；模块本身不依赖路径。

---

## 2. 接口契约

### 2.1 构建 profile

```js
const profile = buildProfile({
  expressions,              // expressionMap 的键数组，或 expressionMap 对象
  morphTargets,             // morphTargetDictionary 的键数组，或对象
  lookAtType,               // "bone" | "expression" | "none" | "auto"
  format,                   // "VRM0" | "VRM1" | "unknown"，仅诊断
  gains,                    // 可选：{ happy: 0.9, ... }
  maxYaw,                   // 可选：默认 30 度
  maxPitch,                 // 可选：默认 20 度
});
```

P0-2：

```js
const customProfile = buildCustomProfile({
  morphTargets,
  expressions,
  lookAtType,
  format,
  gains,
});
```

`lookAtType` 建议直接用：

```js
const lookAtType = vrm.lookAt?.applier?.constructor?.type ?? "auto";
// three-vrm 的 applier.type 是静态属性；实例上要读 constructor.type
```

### 2.2 创建 mapper

```js
const mapper = new FaceMapper(profile);
// 或
const mapper = new CustomFaceMapper(customProfile);
```

可选项：

```js
new FaceMapper(profile, {
  calibrationFrames: 30,   // 自动中性校准帧数；0 表示关闭
  neutralThreshold: 0.5,   // _neutral 门控阈值
  smoothing: true,         // 非对称 EMA
  attackTau: 0.03,         // 秒
  releaseTau: 0.12,        // 秒
  blinkAttackTau: 0.015,   // 秒
  blinkReleaseTau: 0.06,   // 秒
});
```

### 2.3 每帧更新

```js
const out = mapper.update(categories, {
  dt: 1 / 30,   // 秒，必须传；不要传毫秒
  mirror,       // 摄像头预览镜像
});
```

返回：

```js
{
  expressions: {
    // 键是模型实际存在的 expression 名
    // P0-1: "happy" / "sad" / "Surprised" / "aa" / ...
    // P0-2: "arkit_browDown" / "arkit_eyeBlinkLeft" / ...
    "name": 0.0,
  },
  lookAt: { mode: "bone", yaw: 0, pitch: 0 } | null,
  meta: {
    version: "0.1.0",
    mode: "preset" | "custom",
    calibrated: true,
    calibrationFrames: 30,
    mirror: false,
    gaze: { ... },
    expressionCount: 20,
  },
}
```

### 2.4 注入 custom expression

P0-2 的 profile 只是数据，不会自动创建 three-vrm expression。加载模型后调用一次：

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

`groupBindsByMesh()` 会处理同一个 target 出现在多个 mesh/primitive 的情况，并按 `index + weight` 分组，避免重复绑定。

---

## 3. `avatar.js` 接入点

### 3.1 `loadFromBlob()` 之后

在拿到 `vrm`、完成 `VRMUtils.rotateVRM0(vrm)` 之后：

```js
const morphTargets = [];
vrm.scene.traverse((object) => {
  if (object.isMesh && object.morphTargetDictionary) {
    for (const name of Object.keys(object.morphTargetDictionary)) {
      morphTargets.push(name);
    }
  }
});

const expressions = Object.keys(vrm.expressionManager?.expressionMap ?? {});
const lookAtType = vrm.lookAt?.applier?.constructor?.type ?? "auto";

// 第一阶段：preset 模式
this.faceProfile = buildProfile({
  expressions,
  morphTargets,
  lookAtType,
  format: "VRM0",
});
this.faceMapper = new FaceMapper(this.faceProfile);

// 第二阶段：custom 模式
// this.customProfile = buildCustomProfile({ morphTargets, expressions, lookAtType, format: "VRM0" });
// injectCustomExpressions(vrm, this.customProfile);
// this.faceMapper = new CustomFaceMapper(this.customProfile);
```

模型切换时，旧 `vrm.scene` 会被 `deepDispose` 移除；重新执行上述流程即可。

### 3.2 `setBlendshapes()` 替换

当前实现硬编码了 `blink/aa/joy/sorrow/...`。替换为：

```js
setBlendshapes(cats, { dt = 1 / 30, mirror = false } = {}) {
  if (!cats || !this.vrm || !this.faceMapper) return;
  this._lastCats = cats;
  this._lastMirror = mirror;

  const out = this.faceMapper.update(cats, { dt, mirror });
  const E = this.vrm.expressionManager;
  if (E) {
    for (const [name, weight] of Object.entries(out.expressions)) {
      E.setValue(name, weight);
    }
  }

  if (out.lookAt?.mode === "bone" && this.vrm.lookAt) {
    this.vrm.lookAt.autoUpdate = false;
    this.vrm.lookAt.yaw = out.lookAt.yaw;
    this.vrm.lookAt.pitch = out.lookAt.pitch;
  }
  this.lastMapping = out.meta;
}
```

`dt` 需要由调用方提供。当前 `setBlendshapes` 由 `applyFrame()` 调用；如果不在 rAF 内，可以先固定 `1/30`，或在 `avatar.js` 里记录上次调用时间差。

### 3.3 `resetPose()` 替换

不要再遍历硬编码名称。改为：

```js
this.vrm.expressionManager?.resetValues();
this.faceMapper?.reset();
this.vrm.lookAt?.reset();
```

`resetValues()` 会清零所有 expression，包括 P0-2 注入的 custom expression。

### 3.4 模式切换

从 preset 模式切到 custom 模式时：

```js
this.vrm.expressionManager?.resetValues();
for (const name of customProfile.presetNamesToClear) {
  this.vrm.expressionManager?.setValue(name, 0);
}
```

之后只写 `out.expressions` 里的 `arkit_*`。custom 模式不驱动 `ALL_*` 全脸情绪；不要再同时写 `happy/sad/angry/Surprised/aa/...`，否则会双重计数。

---

## 4. 两种上线顺序

### 4.1 第一阶段：preset 模式

- 只接 `facemap.mjs`。
- 目标：修复 `joy/sorrow/surprise` 静默失效、视线丢失、无中性校准。
- 改动集中在 `loadFromBlob`、`setBlendshapes`、`resetPose`。
- 风险最低，建议先上。

### 4.2 第二阶段：custom 模式

- 接 `morphscan.mjs` + `injectCustomExpressions()`。
- 目标：用 `BRW_*`、`EYE_*`、`MTH_*` 拆出更细的眉、眼、嘴。
- `sample-a` 生成 20 个 custom expression；`sample-b`、`three-vrm-girl` 生成 21 个。
- 需要处理模式切换时的 `resetValues()` 和 `presetNamesToClear`。
- 建议在 preset 模式稳定后再开，便于 A/B 对照。

---

## 5. 必须遵守的约束

1. 不要再硬编码 `joy`、`sorrow`、`surprise`。VRM 0.x 经 three-vrm 后实际名称是 `happy`、`sad`、`Surprised`。
2. 不要同时写 `blink` 和 `blinkLeft/blinkRight`；mapper 已处理，接入方不要额外写。
3. 不要用 `_neutral` 驱动 VRM 的 `neutral` expression；它只做校准门控。
4. custom 模式不要驱动 `ALL_*` 全脸 preset；情绪由眉、眼、嘴的 granular 通道组合。
5. 同一个 morph target 只绑定一个 custom expression；`buildCustomProfile()` 已保证，接入方不要手工重复绑定。
6. 复位统一用 `resetValues()`，不要再硬编码名称列表。
7. 视线骨骼模式要设置 `vrm.lookAt.autoUpdate = false`；否则 `vrm.update()` 可能覆盖 yaw/pitch。

---

## 6. 验收清单

### 6.1 功能

- `sample-a` 上 preset 模式可见：`happy`、`sad`、`Surprised`、`relaxed`、`ih/ou/ee/oh`、分眼眨眼、左右上下视线。
- `sample-a` 上 custom 模式可见：`arkit_browDown`、`arkit_browSorrow`、`arkit_eyeBlinkLeft/Right`、`arkit_eyeWide`、`arkit_jawOpen`、`arkit_mouthSmile`、`arkit_mouthFrown` 等。
- `sample-b`、`three-vrm-girl` 不报错；`three-vrm-girl` 的 `eyeWide` 自动回退到 `EYE_Surprised`。
- 模型切换后旧表情不残留；停止/复位后表情清零。

### 6.2 性能

- `mappingMs` p95 小于 0.5 ms。
- `workMs` p95 不超过 40 ms，`fpsAvg` 不低于 30。
- 如果新增 `mappingMs` 埋点，建议在 `setBlendshapes()` 内用 `performance.now()` 包住 `mapper.update()`，不要混进 `renderMs`。

### 6.3 回归

```powershell
cd D:\DASH\V0FastTest
node --test tools/vrm_face/facemap.test.mjs tools/vrm_face/morphscan.test.mjs
D:\Miniconda3\python.exe -m pytest -q
```

当前结果：Node 36 项通过；pytest 34 项通过。

---

## 7. 需要 DASH-Web pane 确认的事项

1. `avatar.js` 的接入与 PR 由 DASH-Web pane 执行；模型线不改该文件。
2. `dt` 的来源：固定 `1/30`，还是用 `tick` 的真实时间差？建议真实时间差，避免掉帧时平滑速度变化。
3. 第一阶段是否只开 preset 模式，custom 模式用开关控制？建议先 preset，稳定后再开 custom。
4. 是否需要在 benchmark 面板新增 `mappingMs` 一行？如果需要，展示线加 UI，模型线提供 `meta`。
5. 模型切换时是否保留当前模式（preset/custom）？建议保留模式，重新建 profile/mapper。
6. `viewer/index.html` 是否同步修？它是旧调试链路，可后置，但应复用同一套名称别名规则。
