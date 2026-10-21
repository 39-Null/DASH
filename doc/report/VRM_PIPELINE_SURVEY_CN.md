# DASH 52 BlendShape -> VRM 映射管线调研

> 日期：2026-10-21
> 范围：模型线调研。只读代码与模型资产，不修改展示线实现。
> 状态说明（2026-10-21 补记）：P0-1/P0-2 已由 PR #22/#23 落地并接入展示线。第 2 节保留为落地前的基线，用于解释动机；当前实现见附录 C。
> 结论先行：P0-1 落地前，代码写入了 10 个 preset 名称，但在仓库现有 VRM 0.x 资产上实际只有 3 个生效。最小修复不需要改模型，先把名称解析、左右眼、视线骨骼和中性校准做对；第二步再用现有资产中大量未被 preset 使用的 morph target 生成运行时 custom expression。

---

## 0. 摘要

### 0.1 五个主要结论

1. **P0-1 落地前，现状不是「约 10 个 preset 生效」，而是「3 个 preset 生效」。**
   当时代码调用 `joy`、`sorrow`、`surprise`，但 three-vrm 3.5.3 在导入 VRM 0.x 时会把它们重命名为 `happy`、`sad`，而 `Surprised` 会保留组名首字母大写。`setValue` 对不存在的名称静默无效，所以这三个调用不会报错，也不会产生表情。该问题已由 #22 修复。

2. **P0-1 落地前，视线通道基本是空的。**
   仓库内 9 个 VRM 全部是 VRM 0.x，`firstPerson.lookAtTypeName` 全部为 `Bone`。默认模型 `three-vrm-girl.vrm` 的 `lookUp`、`lookDown`、`lookLeft`、`lookRight` 四个 expression 的 bind 数为 0；`sample-a`、`sample-b` 根本没有这四个组。当时代码用 `setValue("lookUp", ...)` 驱动视线，在这些资产上不会产生效果。正确入口是 `vrm.lookAt.yaw/pitch`，它会驱动左右眼骨骼；该入口已由 #22 接入。

3. **现有资产的可挖掘空间比想象中大。**
   `sample-a.vrm` 有 56 个 morph target，其中只有 16 个被 preset expression 绑定，剩余 40 个未被使用；其中约 25 个是面部相关（`BRW_*`、`EYE_*`、`MTH_*`）。`sample-b`、`three-vrm-girl` 的情况类似。也就是说，不重新做模型，也可以在运行时用这些已存在的 morph target 组合出更多 ARKit 维度。

4. **P0-1/P0-2 已落地；当时的推荐是先做两条，均不需要改模型资产。**
   - P0-1：preset 直映射修正。按运行时 `expressionMap` 解析名称，恢复 `happy`、`sad`、`Surprised`、`relaxed`、`ih/ou/ee/oh`、`blinkLeft/Right`；视线改走 `vrm.lookAt`；加中性基线校准与轻量平滑。已由 #22 实现。
   - P0-2：自动扫描 morph target，生成运行时 custom expression。先在 `sample-a/b` 上覆盖约 15-20 个可解释维度，再逐步扩展。已由 #23 实现。
   这两条合起来，预期把有效表情维度从 3 提升到 10 左右，再提升到 15-20，帧预算增加小于 0.5 ms。

5. **学习式映射现在不值得做。**
   52 -> N 的线性层或小 MLP 推理成本几乎为零，但缺少成对的「52 维输入 -> 目标模型表情权重」监督数据。用规则映射生成伪标签再训练，只是用更复杂的方式逼近规则，收益不明确。它应该放在 P2，等 P0/P1 的规则映射和校准数据稳定后再评估。

### 0.2 推荐排序

| 优先级 | 内容 | 理由 |
|---|---|---|
| P0-1 | preset 直映射修正（名称解析、左右眼、视线骨骼、中性校准、平滑） | P0-1 落地前有明确的静默失效；改动小、收益立即可见、无资产依赖。已由 #22 修复 |
| P0-2 | 自动扫描 morph target + 运行时 custom expression | 现有资产已有大量未使用 morph target；不需要重新建模。已由 #23 实现 |
| P1 | PerfectSync 离线资产（52 个 ARKit BlendShape/expression） | 质量上限最高，但需要 Blender/UniVRM/Hana 工具链与授权确认 |
| P1 | VRM 1.0 迁移与 overrideMouth/overrideBlink | 未来资产更干净，但当前 9 个资产全是 VRM 0.x，短期无法验证 |
| P2 | 学习式 52 -> N 映射 | 数据瓶颈明显；推理成本不是问题，监督信号才是问题 |
| P2 | 更深的工具链集成（Hana、NEB、VRCFaceTracking 映射表） | 作为参考和离线资产管线，不是当前运行时瓶颈 |

P0-1、P0-2 均已由 #22/#23 落地；下表的 P1/P2 仍待评估。

---

## 1. 调研方法与证据

### 1.1 读取的文件

| 类别 | 文件 |
|---|---|
| 约定与现状 | `doc/HANDOFF.md`、`doc/report/TECHNICAL_ROUTE_REPORT_CN.md`、`doc/design/2026-09-16-DASH下一阶段设计.md`、`doc/next.md` |
| 52 维契约 | `showcase/backend/contract.py` |
| 当前映射 | `showcase/frontend/src/avatar.js`、`showcase/frontend/src/mirror.js`、`showcase/frontend/src/main.js` |
| 模型清单 | `showcase/frontend/models/manifest.json` |
| 运行时 | `showcase/frontend/vendor/three-vrm.module.js`（头部标注 v3.5.3） |
| 性能 | `showcase/frontend/src/benchmark.js`、`benchmark-rules.js`、`doc/SHOWCASE_FRONTEND_DESIGN.md` |

### 1.2 解析的模型

用 Python 直接解析 GLB 容器中的 JSON chunk，读取 `extensions.VRM`、`extensions.VRMC_vrm`、`blendShapeMaster.blendShapeGroups`、meshes 的 `extras.targetNames` 和 `firstPerson.lookAtTypeName`。没有加载渲染器，也没有修改模型文件。

| 文件 | 格式 | expression 组数 | 0 bind 组数 | 唯一 morph target 数 | lookAt |
|---|---|---:|---:|---:|---|
| `showcase/frontend/assets/three-vrm-girl.vrm` | VRM 0.x | 19 | 5 | 44 | Bone |
| `showcase/frontend/assets/vrm/sample-a.vrm` | VRM 0.x | 15 | 0 | 56 | Bone |
| `showcase/frontend/assets/vrm/sample-b.vrm` | VRM 0.x | 14 | 0 | 54 | Bone |
| `SysMocap/models/SampleA.vrm` | VRM 0.x | 15 | 0 | 56 | Bone |
| `SysMocap/models/SampleB.vrm` | VRM 0.x | 14 | 0 | 54 | Bone |
| `SysMocap/models/shibu_sendagaya.vrm` | VRM 0.x | 13 | 0 | 40 | Bone |
| `SysMocap/models/test.vrm` | VRM 0.x | 15 | 0 | 56 | Bone |
| `SysMocap/models/three-vrm-girl.vrm` | VRM 0.x | 19 | 5 | 44 | Bone |
| `SysMocap/models/VAL.vrm` | VRM 0.x | 17 | 5 | 96 | Bone |

结论：**当前所有可用资产都是 VRM 0.x，没有一个 VRM 1.0 资产，也没有一个模型自带 52 个 ARKit 命名的 morph target。**

### 1.3 说明

- 本次调研没有修改 `showcase/` 下任何文件。
- 工作区里 `doc/HANDOFF.md` 处于 modified 状态，这是进入本窗口前就存在的状态，本次没有触碰。
- 本次临时探针脚本以 `probe_tmp_*.py` 放在仓库根目录，未入库；待确认后删除。

---

## 2. 现状核对

> 说明：2.2、2.3.2、2.5、2.6 记录的是 P0-1/P0-2 落地前（#22/#23 之前）的基线，用于解释为什么要做 P0；当前实现见附录 C。

### 2.1 52 维契约

`showcase/backend/contract.py` 定义了固定顺序的 52 项：

```python
BLENDSHAPE_NAMES = [
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
]
```

注意两点：

1. `_neutral` 是 MediaPipe 的类别名，不是 Apple ARKit 的 52 个表情通道之一。它可以作为「中性置信度/门控」使用，但不应该直接驱动 VRM 的 `neutral` expression。
2. 除 `_neutral` 外，其余 51 个名称与 ARKit 的命名基本一致，可以作为 PerfectSync 的通道名基础。

### 2.2 P0-1 落地前的映射实现（历史基线）

#22 之前，`showcase/frontend/src/avatar.js` 的 `setBlendshapes()` 在约 199-228 行是下面这样；当前实现已改为 `vrm_face/facemap.mjs` + `FaceMapper`。

```js
const blink = Math.max(bs(m, "eyeBlinkLeft"), bs(m, "eyeBlinkRight"));
const jaw = bs(m, "jawOpen");
const smile = Math.max(bs(m, "mouthSmileLeft"), bs(m, "mouthSmileRight"));
const frown = Math.max(bs(m, "mouthFrownLeft"), bs(m, "mouthFrownRight"));
const browDown = Math.max(bs(m, "browDownLeft"), bs(m, "browDownRight"));
const browUp = Math.max(
  bs(m, "browInnerUp"), bs(m, "browOuterUpLeft"), bs(m, "browOuterUpRight")
);
E.setValue("blink", clamp(blink));
E.setValue("aa", clamp(jaw));
E.setValue("joy", clamp(smile));
E.setValue("sorrow", clamp(frown));
E.setValue("angry", clamp(browDown));
E.setValue("surprise", clamp(browUp * 0.6 + jaw * 0.4));
E.setValue("lookUp", clamp(bs(m, "eyeLookUpLeft")));
E.setValue("lookDown", clamp(bs(m, "eyeLookDownLeft")));
E.setValue("lookLeft", clamp(gaze.left));
E.setValue("lookRight", clamp(gaze.right));
```

当时代码读取了 16 个不同通道：

`eyeBlinkLeft/Right`、`jawOpen`、`mouthSmileLeft/Right`、`mouthFrownLeft/Right`、`browDownLeft/Right`、`browInnerUp`、`browOuterUpLeft/Right`、`eyeLookUpLeft`、`eyeLookDownLeft`、`eyeLookOutLeft/Right`。

经过 `max` 合并后，当时写入了 10 个 preset 名称：

`blink`、`aa`、`joy`、`sorrow`、`angry`、`surprise`、`lookUp`、`lookDown`、`lookLeft`、`lookRight`。

当时的 `mirror` 只影响 `pickGaze()` 返回的左右视线，没有影响左右眼 blink、左右嘴角等横向通道；`pickGaze()` 已在 #22 中移除，视线逻辑现在位于 `vrm_face/facemap.mjs` 的 `_gaze()`。

### 2.3 资产事实

#### 2.3.1 VRM 0.x 到 three-vrm 的名称重命名

three-vrm 3.5.3 的 `v0v1PresetNameMap`（`vendor/three-vrm.module.js` 986-1005 行）明确写了：

```js
a: "aa", e: "ee", i: "ih", o: "oh", u: "ou",
blink: "blink",
joy: "happy",
angry: "angry",
sorrow: "sad",
fun: "relaxed",
lookup: "lookUp", lookdown: "lookDown",
lookleft: "lookLeft", lookright: "lookRight",
blink_l: "blinkLeft", blink_r: "blinkRight",
neutral: "neutral"
```

`_v0Import()` 在 873-875 行决定最终名称：

```js
const v0PresetName = schemaGroup.presetName;
const v1PresetName = v0PresetName != null && v0v1PresetNameMap[v0PresetName] || null;
const name = v1PresetName != null ? v1PresetName : schemaGroup.name;
```

所以：

- 组 `Joy` 的 `presetName` 是 `joy`，最终名称是 `happy`，不是 `joy`。
- 组 `Sorrow` 的 `presetName` 是 `sorrow`，最终名称是 `sad`，不是 `sorrow`。
- 组 `Surprised` 的 `presetName` 是 `unknown`，映射表没有 `unknown`，最终名称是组名 `Surprised`，首字母大写，不是 `surprise`。
- 组 `Fun` 最终名称是 `relaxed`，不是 `fun`。

把所有 9 个资产的实际名称按这个规则重算，结果如下：

```text
three-vrm-girl.vrm ->
  neutral, aa, ih, ou, ee, oh, blink, blinkLeft, blinkRight,
  angry, relaxed, happy, sad, Surprised, Extra,
  lookUp, lookDown, lookLeft, lookRight

sample-a.vrm ->
  neutral, aa, ih, ou, ee, oh, blink, blinkLeft, blinkRight,
  angry, relaxed, happy, sad, Surprised, Extra

sample-b.vrm ->
  neutral, aa, ih, ou, ee, oh, blink, blinkLeft, blinkRight,
  angry, relaxed, happy, sad, Surprised
```

#### 2.3.2 P0-1 落地前代码在这些名称上的实际效果

| 代码写入 | 资产中的实际名称 | 结果 |
|---|---|---|
| `blink` | `blink` | 生效 |
| `aa` | `aa` | 生效 |
| `joy` | `happy` | 静默无效 |
| `sorrow` | `sad` | 静默无效 |
| `angry` | `angry` | 生效，但绑定的是 `ALL_Angry` 全脸组合 morph |
| `surprise` | `Surprised` | 静默无效 |
| `lookUp` | `lookUp`（仅 girl，且 0 bind） | 无效 |
| `lookDown` | `lookDown`（仅 girl，且 0 bind） | 无效 |
| `lookLeft` | `lookLeft`（仅 girl，且 0 bind） | 无效 |
| `lookRight` | `lookRight`（仅 girl，且 0 bind） | 无效 |

因此，**P0-1 落地前，在所有主要资产上实际生效的只有 `blink`、`aa`、`angry` 三个**。`angry` 还是由 `browDown` 驱动的全脸 `ALL_Angry`，会把嘴部也一起带起来。该问题已由 #22 修复：当前实现按运行时 `expressionMap` 解析名称，并写入 `happy/sad/Surprised/relaxed/ih/ou/ee/oh/blinkLeft/Right`。

`expressionManager.setValue()` 的实现是：

```js
setValue(name, weight) {
  const expression = this.getExpression(name);
  if (expression) {
    expression.weight = saturate(weight);
  }
}
```

找不到名称时直接返回，不抛错、不警告。这就是「静默失效」的来源。

#### 2.3.3 preset expression 实际绑定了什么

以 `sample-a.vrm` 为例，`blendShapeMaster` 的绑定关系是：

| expression | 绑定 morph target |
|---|---|
| `aa` | `MTH_A` |
| `ih` | `MTH_I` |
| `ou` | `MTH_U` |
| `ee` | `MTH_E` |
| `oh` | `MTH_O` |
| `blink` | `EYE_Close` |
| `blinkLeft` | `EYE_Close_L` |
| `blinkRight` | `EYE_Close_R` |
| `happy` | `ALL_Joy` |
| `sad` | `ALL_Sorrow` |
| `angry` | `ALL_Angry` |
| `relaxed` | `ALL_Fun` |
| `Surprised` | `ALL_Surprised` |
| `Extra` | `EYE_Extra` + `EyeExtra_On` |

这说明两个事实：

1. 口型 preset 是干净的，直接对应 `MTH_A/I/U/E/O`。
2. 情绪 preset 是**全脸组合 morph**，不是单独的眉、眼、嘴。用 `browDown` 驱动 `angry`，嘴部也会跟着变化；用 `mouthSmile` 驱动 `happy`，眉毛和眼睛也会跟着变化。

#### 2.3.4 未被使用的 morph target

`sample-a.vrm` 的 56 个目标中，被 preset 绑定的只有 16 个，剩余 40 个未使用：

- 面部相关约 25 个：`BRW_Angry/Fun/Joy/Sorrow/Surprised`、`EYE_Angry/Joy/Joy_L/Joy_R/Natural/Sorrow/Surprised/Spread`、`MTH_Angry/Down/Fun/Joy/Neutral/Sorrow/Surprised/Up` 等。
- 头发相关约 13 个：`HA_Fung1/2/3`、`HA_Short` 等。
- 眼睛特殊层 2 个：`EYE_Iris_Hide`、`EYE_Highlight_Hide`。

`three-vrm-girl.vrm` 的 44 个目标中，被绑定的 15 个，剩余 29 个；其中约 23 个是面部相关。

这就是 P0-2 的资产基础：**不需要新增 shape key，运行时就可以把已存在的 `BRW_*`、`EYE_*`、`MTH_*` 组合成新的 custom expression。**

#### 2.3.5 命名约定跨模型稳定，但有差异

| 对比 | 交集 | 差集 |
|---|---:|---:|
| `sample-a` vs `sample-b` | 51 / 56 | a 独有 5，b 独有 3 |
| `sample-a` vs `three-vrm-girl` | 41 / 44 | a 独有 15，girl 独有 3 |

差异包括 `MTH_Close`、`MTH_Small`、`MTH_Large`、`EYE_Spread`、`EYE_Natural`、`EyeExtra` 等。说明：

- 可以用统一的正则/语义匹配做自动扫描。
- 但不能假设所有模型都有同一套目标，必须有 per-model profile 或低置信度回退。

### 2.4 three-vrm 3.5.3 的能力

`vendor/three-vrm.module.js` 头部：

```text
@pixiv/three-vrm v3.5.3
```

当前版本已经具备以下能力，不需要升级：

| 能力 | 证据 | 对本任务的意义 |
|---|---|---|
| VRM 0.x expression 导入 | `_v0Import()` 852-984 行 | 现有资产可直接用 |
| VRM 1.0 expression 导入 | `_v1Import()` 735-850 行 | 未来资产可用 |
| `expressionMap` / `customExpressionMap` | 258-285 行 | 运行时探测可用名称 |
| `setValue()` 饱和写入 | 361-366 行 | 单通道写入已 clamp |
| `overrideBlink/LookAt/Mouth` | 72-125 行、431-443 行 | VRM 1.0 的覆盖机制可用 |
| 运行时 custom expression 类 | 导出列表含 `VRMExpression`、`VRMExpressionMorphTargetBind` | 可以运行时注入 |
| `vrm.lookAt` 骨骼/expression applier | 2410-2745 行 | 视线可以用骨骼驱动 |
| morph 绑定是相加的 | 584-590 行 `morphTargetInfluences[index] += ...` | 同一目标被多个 expression 绑定会叠加，必须去重/归一 |
| `resetValues()` | 370-373 行 | 复位应使用它，而不是硬编码名称 |

版本门槛可以写清楚：

- **当前 3.5.3 已满足本报告所有运行时方案。**
- VRM 1.0 的 `overrideMouth/overrideBlink/overrideLookAt` 在当前版本的 `VRMExpression` 和 `VRMExpressionManager` 中已实现。
- 运行时注入 custom expression 所需的 `VRMExpression`、`VRMExpressionMorphTargetBind` 已在模块导出列表中。
- 因此不需要为了这些方案升级 three-vrm；升级与否主要取决于其他依赖，不取决于本任务。

### 2.5 视线：P0-1 落地前走错了入口

`sample-a`、`sample-b`、`three-vrm-girl` 的 `firstPerson` 都是：

```json
{
  "lookAtTypeName": "Bone",
  "lookAtHorizontalInner": {"xRange": 90, "yRange": 8},
  "lookAtHorizontalOuter": {"xRange": 90, "yRange": 12},
  "lookAtVerticalDown": {"xRange": 90, "yRange": 10},
  "lookAtVerticalUp": {"xRange": 90, "yRange": 10}
}
```

three-vrm 会创建 `vrm.lookAt`，其 applier 是 `VRMLookAtBoneApplier`，驱动 `leftEye`、`rightEye` 骨骼。`VRMLookAtBoneApplier.applyYawPitch(yaw, pitch)` 的角度单位是度，`yaw > 0` 对应向左看，`pitch` 的正负对应上下。

正确的接入方式是：

```js
vrm.lookAt.autoUpdate = false;
vrm.lookAt.yaw = yawDeg;
vrm.lookAt.pitch = pitchDeg;
```

`vrm.update(delta)` 会在每帧调用 `lookAt.update()`，把 yaw/pitch 应用到眼骨。P0-1 落地前，`avatar.js` 从未设置 `vrm.lookAt`，只调用空的 `look*` expression，所以视线完全丢失；该问题已由 #22 修复，当前 `avatar.js` 会设置 `lookAt.autoUpdate = false` 并写入 yaw/pitch。

此外，当时 `mirror.js` 的 `pickGaze()`（现已移除）只用了 `eyeLookOutLeft` 和 `eyeLookOutRight`：

```js
if (c.categoryName === "eyeLookOutLeft") left = c.score;
else if (c.categoryName === "eyeLookOutRight") right = c.score;
```

这不等价于水平视线。正确的水平/垂直分量应该同时使用 In/Out 和 Up/Down 四组：

```text
gazeLeft  = 0.5 * (eyeLookOutLeft  + eyeLookInRight)
gazeRight = 0.5 * (eyeLookInLeft   + eyeLookOutRight)
gazeUp    = 0.5 * (eyeLookUpLeft   + eyeLookUpRight)
gazeDown  = 0.5 * (eyeLookDownLeft + eyeLookDownRight)
yaw       = (gazeLeft - gazeRight) * MAX_YAW
pitch     = (gazeUp - gazeDown) * MAX_PITCH
```

具体符号需要按模型和镜像方向做一次 A/B 核对，但入口必须是 `vrm.lookAt`，而不是空的 `look*` expression。

### 2.6 其他历史基线问题（P0-1 落地前）与当前状态

| 问题 | 证据（P0-1 落地前） | 当前状态 |
|---|---|---|
| 左右取 `max` | `blink`、`smile`、`frown`、`browDown`、`browUp` 全部取 max | `blink` 已改为分眼写入；`smile`/`frown`/`browDown` 仍取 max |
| `browUp` 把语义不同的通道取 max | `browInnerUp` 与 `browOuterUpLeft/Right` 不是同一动作 | 仍存在；custom 模式建议改用 `BRW_*` 独立目标 |
| 无权重归一 | 每个 expression 单独 clamp，但多个 expression 会叠加 | 已由 `facemap.mjs` 的 `normalizeGroup()` 处理口型组和情绪组 |
| 无中性校准 | 前端没有 calibrate 逻辑；设计文档已记录中性基线 0.09-0.20 | 已加入 30 帧自动中性校准 |
| 无表情时序平滑 | 只有头部有 `k=0.18` 的指数平滑 | 已加入非对称 EMA（attack/release 不同时间常数） |
| 复位硬编码 | `resetPose()` 只清 10 个名称，且包含已失效的 `joy/sorrow/surprise` | 已改用 `expressionManager.resetValues()` |
| 映射耗时未单独计量 | `benchmark.js` 的 `applyMs` 包含 `toFrame` + `setBlendshapes` | 仍未单独拆分，建议后续新增 `mappingMs` |
| 设计文档的「照搬」结论需要修正 | `SHOWCASE_FRONTEND_DESIGN.md` 8.3 节说「已实测能驱动 VRM，逐条照抄」 | 仍建议以运行时 `expressionMap` 为准 |

---

## 3. 候选管线逐条评估

### 3.1 a) preset 直映射改进

#### 原理

继续使用 VRM 自带的 preset expression，不新增资产。把 52 维 ARKit 向量做语义组合、归一、校准和平滑，再写入模型实际存在的 expression 名称。

中间表示仍然是 52 维 ARKit 向量。运行时依赖只有 three-vrm 的 `expressionManager` 和 `vrm.lookAt`。

#### 当前资产可用性

全部可用。`sample-a` 有 15 个 expression，`sample-b` 有 14 个，`three-vrm-girl` 有 19 个；足够覆盖基础表情、口型、眨眼和视线。

#### 需要补什么

1. **运行时名称解析表**：加载后读取 `E.expressionMap`，建立别名：
   - `joy` -> `happy`
   - `sorrow` -> `sad`
   - `surprise` -> `Surprised`（同时兼容未来 VRM 1.0 的 `surprised`）
   - `fun` -> `relaxed`
   - `blink_l/r` -> `blinkLeft/Right`
2. **左右眼拆分**：如果 `blinkLeft` 和 `blinkRight` 都存在，使用分眼模式，`blink` 置 0；否则回退到 `blink = max`。不要同时写 `blink` 和分眼，否则同一只眼会被叠加。
3. **视线骨骼**：优先 `vrm.lookAt.yaw/pitch`；只有在 `vrm.lookAt` 为空或 applier 是 expression 类型时，才回退到 `look*` expression。
4. **中性基线**：启动后采集 30-60 帧有人脸的稳定帧，按通道取中位数作为 baseline；之后用 `max(0, x - baseline)`，并做 `1/(1-baseline)` 的轻度缩放。`_neutral` 只作为门控/置信度，不驱动 `neutral` expression。
5. **分组归一**：口型组（`aa/ih/ou/ee/oh`）和情绪组（`happy/sad/angry/relaxed/Surprised`）分别做 L1 归一或软饱和，避免多个 expression 叠加过驱动。
6. **轻量平滑**：每个通道做 one-euro 或非对称 EMA；眨眼 attack 快、release 稍慢；情绪慢一些。平滑不能引入超过 1 帧的可见延迟。
7. **per-model gain**：按模型给少量标量增益，例如 `sample-a` 的 `happy` 可能比 `three-vrm-girl` 更强；先手工 A/B，再考虑自动测量。

#### 建议的初始映射

以下是 P0 的建议初值，不是最终标定值。所有值写入前应 clamp 到 `[0,1]`，再按组归一。

| VRM expression | 输入 | 建议初值 |
|---|---|---|
| `blinkLeft` | `eyeBlinkLeft` | 直接 |
| `blinkRight` | `eyeBlinkRight` | 直接 |
| `blink` | `max(eyeBlinkLeft, eyeBlinkRight)` | 仅在没有分眼时使用 |
| `aa` | `jawOpen` | `jawOpen` |
| `ih` | 口型组合 | `0.5*mouthSmile + 0.5*mouthStretch` |
| `ou` | 口型组合 | `mouthPucker` |
| `ee` | 口型组合 | `0.6*mouthStretch + 0.4*mouthSmile` |
| `oh` | 口型组合 | `mouthFunnel` |
| `happy` | 情绪组合 | `0.7*max(mouthSmileL/R) + 0.3*max(cheekSquintL/R)` |
| `sad` | 情绪组合 | `0.5*max(mouthFrownL/R) + 0.3*browInnerUp + 0.2*max(mouthLowerDownL/R)` |
| `angry` | 情绪组合 | `0.6*max(browDownL/R) + 0.25*max(noseSneerL/R) + 0.15*max(mouthPressL/R)` |
| `relaxed` | 情绪组合 | `0.5*max(eyeSquintL/R) + 0.5*max(mouthSmileL/R)` |
| `Surprised` | 情绪组合 | `0.55*browUp + 0.30*max(eyeWideL/R) + 0.15*jawOpen` |
| `lookUp/Down/Left/Right` | 视线 | 优先走 `vrm.lookAt`；expression 仅作回退 |

其中 `browUp = max(browInnerUp, browOuterUpLeft, browOuterUpRight)` 只是临时组合；更合理的做法是 P0-2 用 `BRW_Surprised` / `BRW_Fun` 等独立目标。

#### 工作量、风险、验证、预算

| 项 | 评估 |
|---|---|
| 工作量 | 1-2 人日（映射函数 + 名称解析 + 校准 + 单测） |
| 风险 | 低。主要风险是 VRM 0.x/1.0 名称差异、`blink` 与分眼叠加、镜像方向、校准过减 |
| 帧预算 | 小于 0.1 ms/帧；52 次查表 + 少量乘加，可忽略 |
| 是否可离线烘焙 | 不需要；运行时即可 |
| 可验证性 | 帧级：固定 52 维序列 -> 输出权重 JSON 对比；主观：A/B 视频；延迟：benchmark `applyMs` |
| 优先级 | P0-1 |

---

### 3.2 b) VRM 0.x custom expression 与 PerfectSync

#### 原理

VRM 0.x 的 `blendShapeMaster.blendShapeGroups[]` 中，每个组有：

- `name`：自定义名称。
- `presetName`：`a/i/u/e/o/blink/blink_l/blink_r/joy/angry/sorrow/fun/lookup/.../unknown`。
- `binds[]`：`{mesh, index, weight}`，指向 mesh 的 morph target。
- `materialValues[]`：材质颜色/纹理变化，本任务不需要。
- `isBinary`：是否二值化。

当 `presetName` 为 `unknown` 时，three-vrm 使用组名作为 expression 名称。因此可以把 52 个 ARKit 名称写成 52 个自定义组，每个组绑定对应的 morph target，形成 PerfectSync。

#### 两种落地方式

**b1. 离线烘焙（推荐用于“主角模型”）**

- 用 Blender + VRM Add-on、UniVRM 或 Hana Tool 给 VRoid 模型添加 52 个 ARKit BlendShape，并在 VRM 中建立 52 个自定义 expression。
- 运行时只做 1:1 映射：`E.setValue("eyeBlinkLeft", score)` 等。
- 优点：质量上限最高，运行时逻辑最简单，可解释性最好。
- 缺点：需要建模/工具链/授权；每个模型都要做一遍；文件会变大。

**b2. 运行时注入（推荐用于当前资产）**

- 不新增 shape key，直接使用现有 morph target。
- 用 `VRMExpression` + `VRMExpressionMorphTargetBind` 在运行时创建 custom expression。
- 优点：不需要改模型；现有资产就能用；可以逐步增加维度。
- 缺点：受现有 morph target 限制，无法覆盖全部 52 维；同一目标被多个 expression 绑定时会相加，需要去重/归一。

运行时注入的 API 形态（当前 3.5.3 已导出）：

```js
import { VRMExpression, VRMExpressionMorphTargetBind } from "@pixiv/three-vrm";

const expr = new VRMExpression("arkit_mouthSmile");
expr.addBind(new VRMExpressionMorphTargetBind({
  primitives: [faceMesh],       // 任何带 morphTargetInfluences 的 mesh
  index: targetIndex,
  weight: 1.0,
}));
expr.overrideMouth = "blend";   // 可选；VRM 0.x 也可运行时设置
vrm.scene.add(expr);
vrm.expressionManager.registerExpression(expr);
```

注意：

- 名称建议加前缀 `arkit_`，避免与 preset 名称冲突。
- `VRMExpressionMorphTargetBind.applyWeight()` 使用 `+=`（vendor 588 行），所以同一个 morph target 被两个 expression 绑定时会叠加。映射表必须保证每个目标只被一个「主」expression 使用，或在权重上分摊。
- `resetValues()` 会清零所有 expression，包括运行时注入的；这比硬编码名称可靠。

#### PerfectSync 的 52 维思路

PerfectSync 的核心不是「52 个新算法」，而是「模型侧有 52 个与 ARKit 同名的形状，跟踪侧按同名写入」。对 DASH 的启示：

1. 52 个 ARKit 名称可以直接作为通道名；`_neutral` 改名为 `neutral` 或忽略。
2. MediaPipe 的分数不是 ARKit 的校准分数，仍然需要 per-channel gain/neutral baseline。
3. 模型如果没有 52 个形状，就不要假装有；用 b2 的近似映射，并明确标注哪些通道不可用。
4. 视线不要走 `look*` expression，除非模型明确是 expression 型 lookAt；当前资产是 Bone 型。

#### 当前资产可用性

- b1：当前资产没有 52 个 ARKit 命名的 morph target，不可直接用；需要离线制作。
- b2：可用。`sample-a` 有 40 个未使用目标，其中约 25 个面部相关；`sample-b`、`three-vrm-girl` 类似。

#### 需要补什么

| 方式 | 需要补 |
|---|---|
| b1 | 52 个 ARKit shape key/expression；模型授权；导出验证；文件大小/性能测试 |
| b2 | per-model morph target 扫描；ARKit -> target 映射表；权重分摊；中性校准；运行时注入生命周期 |

#### 工作量、风险、验证、预算

| 项 | b1 离线 PerfectSync | b2 运行时注入 |
|---|---|---|
| 工作量 | 2-5 人日/模型（工具链 + 调形 + 验证） | 3-5 人日（扫描 + 映射 + 调参） |
| 风险 | 中高：建模质量、授权、导出兼容、文件变大 | 中：目标缺失、语义错配、重复绑定、模型差异 |
| 帧预算 | 运行时 0.1-0.5 ms；新增 52 个目标约 +1.3 MB 顶点数据（2054 顶点模型，未压缩估算）；GPU morph 成本增加但很小 | 运行时 0.1-0.5 ms；不新增几何，GPU 成本不变 |
| 是否可离线烘焙 | 是，主要工作都在离线 | 否，运行时生成；可离线生成 profile JSON |
| 可验证性 | 帧级顶点/权重对比、主观 A/B、端到端延迟 | 帧级权重对比、主观 A/B、端到端延迟 |
| 优先级 | P1（主角模型） | P0-2 / P1 |

补充：`sample-a` 的面部 mesh 约 2054 个顶点。52 个新 morph target 的 float32 位移数据约为 `2054 * 52 * 3 * 4 = 1.28 MB`，加上法线/切线/容器开销可能到 2-4 MB；对 sample-a/b 的 13-15 MB 资产不是数量级问题（默认 three-vrm-girl 约 5.5 MB），但移动端加载和显存需要实测。

---

### 3.3 c) VRM 1.0 expressions 与 override

#### 原理

VRM 1.0 使用 `VRMC_vrm` 扩展，`expressions.preset` 和 `expressions.custom` 都是一等公民。每个 expression 支持：

- `morphTargetBinds`
- `materialColorBinds`
- `textureTransformBinds`
- `isBinary`
- `overrideBlink`
- `overrideLookAt`
- `overrideMouth`

override 的语义（VRM 1.0 规范）：

| 属性 | 作用对象 | `none` | `block` | `blend` |
|---|---|---|---|---|
| `overrideMouth` | `aa/ih/ou/ee/oh` | 不干预 | 目标权重置 0 | 按当前 expression 权重衰减目标 |
| `overrideBlink` | `blink/blinkLeft/blinkRight` | 不干预 | 目标权重置 0 | 按权重衰减 |
| `overrideLookAt` | `lookUp/Down/Left/Right` | 不干预 | 目标权重置 0 | 按权重衰减 |

three-vrm 3.5.3 的实现：

- `VRMExpression` 的 `overrideBlinkAmount`、`overrideLookAtAmount`、`overrideMouthAmount` 在 91-125 行。
- `_calculateWeightMultipliers()` 在 431-443 行把所有 expression 的 override 量相加，再从 1 减去，最后 clamp 到 0。
- 这意味着 override 是**全局的**：只要有一个自定义口型 expression 的 `overrideMouth` 为 `blend` 且权重为 0.6，所有 preset 口型会被乘以 0.4；多个自定义口型同时激活时，乘数会继续下降，直到 0。

#### 对 DASH 的用法

如果模型是 VRM 1.0 且有 52 个 ARKit custom expression：

- 每个口型 custom expression 设 `overrideMouth: "blend"`，让 preset `aa/ih/ou/ee/oh` 在自定义口型激活时自动让位。
- 每个眨眼/眼型 custom expression 设 `overrideBlink: "blend"`，避免和 `blink` 叠加。
- 视线 custom expression 设 `overrideLookAt: "blend"`，避免和 `look*` 叠加。
- 情绪 custom expression 也可以设 `overrideMouth: "blend"`，防止「happy 自带嘴形」和口型叠加。

注意：override 只作用于 preset 名称，不作用于 custom expression。并且它不能解决「preset 情绪绑定的是 `ALL_*` 全脸 morph」的问题；如果模型同时有 `ALL_*` 和 granular 目标，仍然要选择一套，不要两套一起驱动。

#### 当前资产可用性

不可直接用。当前 9 个资产全部是 VRM 0.x，没有 `VRMC_vrm` 扩展。要用 c)，需要：

1. 用 VRoid Studio 导出 VRM 1.0（VRoid 已支持 VRM 1.0 导出），或用 Blender VRM Add-on / UniVRM 转换。
2. 确认 expression 名称、绑定、override 字段在转换后仍然正确。
3. 重新做 52 通道映射和校准。

#### 工作量、风险、验证、预算

| 项 | 评估 |
|---|---|
| 工作量 | 代码 1-2 人日；资产转换/验证 0.5-1 人日/模型 |
| 风险 | 中。转换可能改变材质、expression 名称和绑定；override 是全局乘法，调不好会「一个表情压掉所有口型」；当前没有 VRM 1.0 资产可回归 |
| 帧预算 | 小于 0.1 ms；override 计算只是遍历 expression |
| 是否可离线烘焙 | override 是资产/运行时配置，不需要每帧烘焙 |
| 可验证性 | 同 a/b：帧级权重、主观 A/B、端到端延迟；额外验证 override 乘数是否符合预期 |
| 优先级 | P1（有 VRM 1.0 资产时）/ P2（当前） |

---

### 3.4 d) per-model 自动校准

#### 原理

加载模型后，扫描 `vrm.scene` 中所有 mesh 的 `morphTargetDictionary` 和 `morphTargetInfluences`，按名称语义匹配到 ARKit 通道，自动生成 per-model 映射 profile；再采集中性帧，估计 baseline 和增益。

#### 扫描算法

1. 遍历 `vrm.scene`，收集 `mesh.morphTargetDictionary` 的 `name -> index`。
2. 名称归一化：转小写，去掉 `Face.M_F00_..._Fcl_` 前缀，保留语义后缀。
3. 语义分组：
   - `brw_(angry|fun|joy|sorrow|surprised)`
   - `eye_(close|close_l|close_r|joy|joy_l|joy_r|angry|sorrow|surprised|spread|natural)`
   - `mth_(a|i|u|e|o|close|up|down|joy|sorrow|angry|fun|surprised|small|large|neutral)`
   - `ha_*` 归类为头发，忽略
   - `all_*` 归类为全脸组合，仅在缺少 granular 目标时使用
4. 为每个 ARKit 通道选择目标，优先级：
   - 精确左右目标（如 `EYE_Close_L`）> 无侧别 granular 目标（如 `EYE_Close`）> 全脸组合（如 `ALL_Surprised`）。
   - 每个通道最多绑定 1-2 个目标，权重和为 1。
   - 同一个 morph target 不要被两个「主」通道重复绑定；如果必须共用，做权重分摊或 max 选择。
5. 标记置信度：低置信度通道默认禁用，允许人工覆盖。
6. 采集中性 baseline：30-60 帧有人脸的稳定帧，按通道取中位数，避免眨眼/说话污染。
7. 可选增益校准：对每个表情在权重 1 时测量面部顶点位移，按参考尺度归一；这一步是 P1，不是 P0 必需。
8. 缓存 profile：用模型字节的 SHA-256 + three-vrm 版本作为 key，存 IndexedDB；模型更新后自动失效。

#### Profile 形态建议

```json
{
  "model": "sample-a",
  "format": "VRM0",
  "generatedBy": "auto-scan-v1",
  "expressions": {
    "blinkLeft": {
      "binds": [{"target": "Face.M_F00_000_00_Fcl_EYE_Close_L", "weight": 1.0}],
      "confidence": 1.0
    },
    "mouthSmile": {
      "binds": [{"target": "Face.M_F00_000_00_Fcl_MTH_Joy", "weight": 1.0}],
      "confidence": 0.8
    }
  },
  "neutral": [0.0, 0.02, 0.01],
  "gains": {"aa": 1.0, "happy": 0.9},
  "lookAt": {"type": "bone", "yawScale": 30, "pitchScale": 20}
}
```

#### 当前资产可用性

可用。`sample-a/b` 的命名高度一致（51/54 交集），`three-vrm-girl` 也有 41/44 交集；正则可以覆盖大部分目标。差异项（`MTH_Close`、`MTH_Small/Large`、`EYE_Spread` 等）需要低置信度回退或人工覆盖。

#### 工作量、风险、验证、预算

| 项 | 评估 |
|---|---|
| 工作量 | 3-5 人日（扫描 + 匹配 + profile + 缓存 + 单测） |
| 风险 | 中。语义错配、重复绑定、全脸组合与 granular 混用、非 VRoid 命名不匹配 |
| 帧预算 | 加载时 5-20 ms；每帧与 custom expression 相同，小于 0.5 ms |
| 是否可离线烘焙 | 可离线生成 profile JSON；也可运行时扫描并缓存 |
| 可验证性 | 单测覆盖 6 个资产的 target 名称；帧级权重/顶点对比；主观 A/B；加载耗时 |
| 优先级 | P0-2 的扫描子集；完整校准 P1 |

---

### 3.5 e) 学习式映射（52 -> N）

#### 原理

训练一个线性层或小 MLP，把 52 维 ARKit 分数映射到目标模型的 N 个 expression 权重或 morph 影响值。

- 线性：`y = W x + b`，`W` 为 `N x 52`，推理成本约 `52*N` 次乘加。
- 小 MLP：例如 `52 -> 64 -> N`，推理成本约 `52*64 + 64*N` 次乘加，仍然很小。
- 运行时可以用纯 JS 实现，不需要 onnxruntime-web；引入 ONNX 运行时反而会增加加载和调用开销。

#### 真正的瓶颈是数据，不是算力

要训练 52 -> N，需要成对的 `(52 维 ARKit, 目标模型表情权重)` 数据。当前没有：

- `quant/data/pairs.npz` 是 `(1434 关键点, 52 ARKit)`，不是 VRM 权重。
- 现有资产的 preset 绑定是人工/工具生成的，不是逐帧监督。
- 用规则映射生成伪标签再训练，只是逼近规则；除非能证明非线性/平滑带来可测收益，否则不值得。
- 用 3D 渲染做可微优化，需要把渲染器放进训练循环，工程量大，且与 30 FPS 目标不直接相关。

#### 与 Task 6 的关系

Task 6 的 MLP 是 `1434 -> 256 -> 256 -> 52`，输出的是 ARKit 52 维；它不能替代 52 -> N 的 VRM 映射层。两者可以串联：

```text
landmarks -> Task 6 MLP -> 52 ARKit -> VRM 映射 -> expressions
```

但 52 -> N 这一层仍然是独立问题。把 52 -> N 塞进 Task 6 会破坏可解释性，也会让训练目标混淆。

#### 评估

| 项 | 评估 |
|---|---|
| 工作量 | 基础设施 3-5 人日；数据采集/标注 1-2 周起 |
| 风险 | 高。没有可靠监督信号；容易过拟合；可解释性下降；per-model 校准更复杂 |
| 帧预算 | 线性/小 MLP 小于 0.1 ms；不建议用 ONNX 运行时 |
| 是否可离线烘焙 | 可以离线训练，运行时只做前向 |
| 可验证性 | 留出集 MSE/MAE；主观 A/B；端到端延迟；与规则映射的对照 |
| 优先级 | P2 |

#### 建议

先不做。等 P0/P1 的规则映射、per-model profile、校准数据稳定后，再考虑两种小范围尝试：

1. 用规则映射做 teacher，学习一个「平滑/去噪」的线性残差，看是否能降低抖动而不损失可解释性。
2. 用少量用户校准数据（用户做几个引导表情，调滑块）拟合 per-user/per-model 线性增益，而不是学习完整映射。

---

### 3.6 f) 现成工具链与生态

| 工具 | 作用 | 可复用什么 | 限制 |
|---|---|---|---|
| VRoid Studio | 角色建模、表情编辑、VRM 0.x/1.0 导出 | 生成 VRM 1.0 测试资产；确认默认 expression 结构 | 默认没有 52 个 ARKit 形状；VRM 1.0 导出需确认材质/表情兼容 |
| Blender + VRM Add-on | VRM 导入/导出、Humanoid、MToon、shape key/expression 编辑 | 添加 52 个 ARKit shape key；批量生成/验证 VRM 0.x/1.0 | 手工工作量大；需要建模/绑定知识 |
| UniVRM | Unity 的 VRM 0.x/1.0 实现，BlendShapeClip 编辑 | 资产转换、expression 编辑、VRM 1.0 验证 | Unity 依赖；Windows 工作流 |
| Hana Tool | Booth 付费 Unity 插件，为 VRoid 模型自动添加 52 个 ARKit BlendShape | 快速制作 PerfectSync 主角模型 | 付费；Unity 2019.4/UniVRM 版本要求；导出后需核对 expression 组是否完整 |
| Hinzka 52blendshapes-for-VRoid-face | 免费/开源的 VRoid 52 BlendShape 参考模型 | 作为目标形状参考；配合 NEB 复制 shape key | 模型授权/再分发需核对；不是通用自动工具 |
| NEB（Not Enough Blendshape） | Unity 插件，复制/重命名/合并 BlendShape | 把 52 个形状复制到目标 VRoid 模型 | 仍需人工核对与调形 |
| VMagicMirror / VSeeFace / Warudo | 支持 PerfectSync 的运行时观看器 | 作为主观 A/B 参考；验证 52 形状质量 | 不是 Web 运行时；不能直接复用代码 |
| VRCFaceTracking | ARKit/Unified Expressions 映射与追踪标准 | 参考 ARKit 名称、Unified Expressions 语义、校准思路 | 不是 VRM 运行时；OSC/桌面生态 |
| three-vrm | 当前 Web 运行时 | 直接使用；3.5.3 已足够 | 需要自己实现 per-model profile 和校准 |

结论：生态工具主要解决「离线资产」问题，不解决「当前 Web 运行时如何用好 52 维」的问题。当前最值得复用的是：

1. VRM 1.0 资产导出能力（VRoid/Blender/UniVRM）。
2. PerfectSync 的 52 形状模板（Hana/Hinzka/NEB）。
3. VRCFaceTracking 的通道语义和映射表。
4. VMagicMirror/Warudo 作为主观对照。

---

## 4. 对比表

> 工作量单位：人日（d），按 6-8 小时计。  
> 验证：V1 = 帧级一致性；V2 = 主观评分；V3 = 端到端延迟。

| 管线 | 当前资产可行性 | 主要依赖 | 需补什么 | 工作量 | 主要风险 | 帧预算影响 | 可离线烘焙 | 验证 | 优先级 |
|---|---|---|---|---|---|---|---|---|---|
| a) preset 直映射改进 | 高，全部可用 | 无额外依赖 | 名称别名、左右眼、lookAt、中性校准、平滑、归一 | 1-2 d | 低：名称/镜像/叠加 | <0.1 ms | 不需要 | V1/V2/V3 | P0-1 |
| b1) VRM 0.x PerfectSync 离线烘焙 | 低，当前资产无 52 形状 | Blender/UniVRM/Hana；模型授权 | 52 个 shape key/expression、导出验证 | 2-5 d/模型 | 中高：建模质量、授权、文件变大 | 0.1-0.5 ms；+约 1.3 MB 顶点数据 | 是 | V1/V2/V3 | P1 |
| b2) VRM 0.x 运行时 custom expression | 高，现有 40 个未使用目标 | three-vrm 3.5.3 导出类 | per-model 映射、权重分摊、注入生命周期 | 3-5 d | 中：目标缺失/重复绑定/语义错配 | 0.1-0.5 ms | 可离线生成 profile | V1/V2/V3 | P0-2 |
| c) VRM 1.0 expressions + override | 低，当前全是 VRM 0.x | VRM 1.0 资产；three-vrm 3.x | 资产转换、override 配置、回归测试 | 1-2 d 代码 + 0.5-1 d/模型 | 中：转换兼容、override 全局乘法 | <0.1 ms | 不需要 | V1/V2/V3 | P1/P2 |
| d) per-model 自动校准 | 高，命名约定较稳定 | three.js morphTargetDictionary | 扫描、匹配、profile、缓存、校准 UI | 3-5 d | 中：语义错配、非 VRoid 命名 | 加载 5-20 ms；每帧 <0.5 ms | 可离线生成 profile | V1/V2/V3 + 单测 | P0-2/P1 |
| e) 学习式 52 -> N | 低，缺监督数据 | PyTorch/NumPy；可选 ONNX | 成对目标权重数据、训练/评估协议 | 3-5 d + 1-2 周数据 | 高：无标签、过拟合、不可解释 | <0.1 ms（纯 JS） | 可离线训练 | V1/V2/V3 | P2 |
| f) 工具链复用 | 中，取决于资产 | VRoid/Blender/UniVRM/Hana 等 | 工具链安装、授权、流程 | 1-3 d 集成 | 中：版本/授权/手工成本 | N/A | 是 | 主观/资产品质 | P1/P2 |

---

## 5. 推荐排序与理由

### 5.1 P0-1：preset 直映射修正（已由 #22 落地）

**为什么先做（当时的理由）：**

1. P0-1 落地前有明确的静默失效：`joy/sorrow/surprise` 在 VRM 0.x 上不生效；这不是「效果不够好」，而是「调用错了名字」。
2. 视线完全丢失：所有资产都是 Bone 型 lookAt，当时却写空的 `look*` expression；改走 `vrm.lookAt` 可以立即恢复。
3. 现有资产已经提供 `happy/sad/Surprised/relaxed/ih/ou/ee/oh/blinkLeft/Right`，只是当时代码没用；修复名称和映射后，有效维度可以从 3 提升到约 10。
4. 不需要改模型、不需要新增依赖、帧预算增加可忽略。
5. 它是后续所有方案的基础：per-model profile、custom expression、VRM 1.0 都需要正确的名称解析和校准。

**验收标准：**

- 运行时打印 `expressionMap`，确认 `happy/sad/Surprised` 存在且 bind 数大于 0。
- `sample-a` 上 `happy/sad/Surprised/relaxed/ih/ou/ee/oh/blinkLeft/Right` 均能产生可见变化。
- 视线在左右上下四个方向可见，镜像开关方向一致。
- 中性表情基线校准后，静止时无明显扭曲。
- `applyMs` 相比当前增加小于 0.5 ms；端到端 FPS 不低于 30。
- 帧级 golden JSON 对比通过；主观 A/B 无回归。

**状态：** 已由 #22 实现并接入；实现见 `showcase/frontend/src/vrm_face/facemap.mjs`。

### 5.2 P0-2：自动扫描 + 运行时 custom expression（已由 #23 落地）

**为什么第二做（当时的理由）：**

1. `sample-a` 有 40 个未使用 morph target，其中约 25 个面部相关；不利用它们，52 维信息仍然大量丢失。
2. 不需要重新建模，不需要 Hana/Blender，不需要改模型文件；只在运行时组合已有目标。
3. 可以把当前的全脸 `ALL_*` 情绪拆成眉、眼、嘴的 granular 组合，减少「生气时嘴也一起变形」的问题。
4. 与 P0-1 共用同一套 52 维输入、校准和平滑，工程上连续。
5. 为后续 PerfectSync/VRM 1.0 提供 profile 格式和验证工具。

**状态：** 已由 #23 实现并接入；实现见 `showcase/frontend/src/vrm_face/morphscan.mjs`，默认仍使用 preset 模式，custom 模式由展示线开关控制。

**建议的 MVP 覆盖：**

- 眼：`eyeBlinkLeft/Right`、`eyeWideLeft/Right`、`eyeSquintLeft/Right`。
- 眉：`browDownLeft/Right`、`browInnerUp`、`browOuterUpLeft/Right`。
- 嘴：`jawOpen`、`mouthSmileLeft/Right`、`mouthFrownLeft/Right`、`mouthPucker`、`mouthFunnel`、`mouthStretchLeft/Right`、`mouthUpperUpLeft/Right`、`mouthLowerDownLeft/Right`、`mouthPressLeft/Right`。
- 视线：`vrm.lookAt`，不用 custom expression。
- 暂不覆盖：`cheekPuff`、`jawForward/Left/Right`、`mouthLeft/Right`、`mouthRoll*`、`mouthShrug*`、`noseSneer*`（当前资产没有对应目标；如果后续模型有，再扩展）。

**验收标准：**

- 自动扫描在 `sample-a`、`sample-b`、`three-vrm-girl` 上生成的 profile 覆盖至少 15 个通道，置信度可解释。
- 同一 morph target 不被重复绑定；如果共用，权重和不超过 1。
- 自定义模式下，preset 的全脸情绪（`happy/sad/angry/Surprised`）被关闭或衰减，避免与 granular 目标叠加。
- 帧级权重/顶点对比通过；主观 A/B 优于 P0-1；`applyMs` 增加小于 0.5 ms。

### 5.3 P1：PerfectSync 离线资产与 VRM 1.0

- 如果项目需要一个「质量上限」的主角模型，P1 做 b1：用 Hana/Blender/UniVRM 给一个 VRoid 模型加 52 个 ARKit 形状，导出 VRM 0.x 或 1.0。
- 如果未来模型默认导出 VRM 1.0，P1 做 c：用 `overrideMouth/overrideBlink` 管理叠加，减少手工归一。
- 这两条都需要资产工作，不适合作为第一步；建议等 P0 的映射层和验证工具稳定后再做。

### 5.4 P2：学习式映射

- 不作为近期目标。
- 如果以后有大量成对数据，再考虑线性残差或 per-user 校准；不要一上来做完整 MLP。
- 不要把 52 -> N 塞进 Task 6；Task 6 的输出是 52 维 ARKit，不是 VRM 权重。

### 5.5 不建议现在做的事

1. **不要继续照搬 `viewer/index.html` 的映射表。** 它和 `avatar.js` 有同样的 VRM 0.x 名称失配；「已验证」只说明当时页面能跑，不说明每个 expression 都生效。
2. **不要同时写 `blink` 和 `blinkLeft/Right`。** 会叠加。
3. **不要用 `_neutral` 驱动 VRM `neutral`。** 它是 MediaPipe 的中性类别分数，不是 ARKit 表情通道。
4. **不要把 `ALL_*` 全脸情绪和 granular 目标一起驱动。** 会双重计数。
5. **不要为 52 -> N 线性层引入 onnxruntime-web。** 纯 JS 更快、更简单。
6. **不要在没有目标权重数据的情况下训练 52 -> N。** 伪标签只会复制规则。

---

## 6. 与 30 FPS / 33 ms 硬约束的关系

### 6.1 成本估算

| 操作 | 估算成本 | 说明 |
|---|---:|---|
| preset 映射（P0-1） | <0.1 ms/帧 | 52 次查表 + 少量乘加 + 平滑 |
| 52 个 custom expression 更新 | 0.1-0.5 ms/帧 | 52 个 expression，每个 1-10 个 primitive bind；主要是 `morphTargetInfluences` 写入 |
| per-model 扫描 | 5-20 ms，仅加载时 | 遍历 mesh 和 `morphTargetDictionary` |
| 中性校准 | 30-60 帧，仅启动时 | 每帧 52 维，成本可忽略 |
| 52 -> N 线性层 | <0.05 ms/帧 | N 约 20，约 1000 次乘加 |
| 52 -> 64 -> N 小 MLP | <0.1 ms/帧 | 约 5000 次乘加；纯 JS 足够 |
| 离线 PerfectSync 烘焙 | 0 ms/帧 | 成本转移到资产大小和 GPU morph 更新 |

结论：**映射层不是 33 ms 预算的瓶颈。** 当前主要成本仍是 MediaPipe 推理（实测约 11.9 ms）和渲染/骨骼。映射层即使做到 52 个 custom expression，也只占预算的很小一部分。

### 6.2 需要新增的观测

当前 `benchmark.js` 的 `workMs` 组成是：

```js
const workMs = t1 - t0 + (t2 - t1) + timing.rigMs + timing.renderMs;
```

其中 `t2 - t1` 已经包含 `applyFrame`（包括 `avatar.setBlendshapes`），但没有单独拆分。建议新增：

- `mappingMs`：`setBlendshapes` 内部计时，或包一层。
- `expressionScanMs`：模型加载后扫描/生成 profile 的耗时。
- `morphTargetCount`：每个模型的 morph target 数量。
- `lookAtType`：`bone` / `expression` / `none`。
- `expressionMapSize`：实际可用 expression 数量。

这些指标不需要改展示线也能在探针页/控制台先测；正式集成时再由展示线决定 UI 呈现。

### 6.3 资产大小与 GPU 影响

- 运行时 custom expression（b2）不新增几何，GPU morph 成本不变。
- 离线 PerfectSync（b1）会给面部 mesh 增加 52 个 morph target。以 `sample-a` 的 2054 顶点估算，float32 位移约 1.28 MB；加上法线/切线/容器开销可能 2-4 MB。对 sample-a/b 的 13-15 MB 资产不是数量级问题（默认 three-vrm-girl 约 5.5 MB），但移动端加载时间和显存需要实测。
- 如果模型原本已有 40-56 个目标，再加 52 个可能达到约 100 个目标。three.js 可以处理，但 shader 复杂度和移动端 GPU 成本需要基准测试。

---

## 7. 验证方案

### 7.1 帧级一致性（V1）

目标：证明映射函数在固定输入下逐帧可复现。

做法：

1. 准备一段固定 52 维序列（可以从 `quant/data/pairs.npz` 的 Y 部分导出，或新录一段），每帧带时间戳。
2. 在 Node 或浏览器中禁用 `performance.now()` 依赖，用固定 `dt = 1/30` 驱动映射；关闭或固定平滑滤波器的初始状态。
3. 输出每帧的 `{expressionName: weight}` JSON，作为 golden 文件。
4. 对以下变化做回归：
   - 名称别名：VRM 0.x / VRM 1.0。
   - 左右眼拆分与合并。
   - 镜像开/关。
   - 中性校准开/关。
   - 平滑开/关。
5. 对渲染结果做可选对比：固定相机、固定灯光、固定帧，截图后用 SSIM 或逐像素 MAE 对比；或者直接在 CPU 上根据 `morphTargetInfluences` 和 morph attributes 计算顶点位置，做 L2 对比。

通过标准：

- 权重 JSON 逐帧误差小于 1e-6（纯函数部分）。
- 顶点位置 L2 误差小于 1e-4（如果做 CPU 顶点对比）。
- 截图 SSIM 大于 0.99（如果做渲染对比）。

### 7.2 主观评分（V2）

目标：证明「更像、更自然、更跟手」，而不只是数值上更多通道。

做法：

- 准备 8-10 段短片段：中性、微笑、悲伤、生气、惊讶、单眼眨眼、左右看、说话（元音交替）、快速表情切换。
- 同一段视频分别驱动 baseline 和新管线，输出并排 A/B 视频；顺序随机，评分者不知道哪边是新管线。
- 5 分 Likert：
  - 相似度（像不像输入表情）
  - 自然度（有没有扭曲/穿模/过驱动）
  - 跟手性（延迟/滞后）
  - 眼睛/视线可信度
  - 整体偏好
- 至少 3 名评分者；报告均值、标准差和偏好比例。
- 额外记录「不可接受帧」：明显穿模、眼睛翻转、嘴部撕裂、表情卡住。

通过标准：

- 新管线在相似度、自然度、跟手性上至少两项显著优于 baseline。
- 没有新增不可接受帧。

### 7.3 端到端延迟（V3）

目标：证明映射层没有破坏 30 FPS / 33 ms 预算。

做法：

- 使用现有 benchmark 面板，记录：
  - `perceptionMs`
  - `applyMs`（包含映射）
  - `rigMs`
  - `renderMs`
  - `workMs`
  - `fpsAvg`、`p95WorkMs`
- 新增 `mappingMs` 微基准：固定 52 维输入，连续调用 1000 次 `setBlendshapes`，报告 p50/p95。
- 对比 baseline 和新管线的 `applyMs`、`workMs`、`fpsAvg`。
- 在目标笔记本上跑，至少 3 次，报告均值和 p95。

通过标准：

- `mappingMs` p95 小于 0.5 ms。
- `workMs` p95 不超过 33.3 ms 的 1.2 倍（现有规则为 40 ms）。
- `fpsAvg` 不低于 30。
- 没有因为映射层引入新的长尾帧。

### 7.4 资产/映射回归（V1 的补充）

做一个只读诊断页或控制台脚本，加载每个模型后打印：

```js
{
  format: "VRM0" | "VRM1",
  expressionMap: { name: { binds: n, overrideMouth, overrideBlink } },
  lookAt: "bone" | "expression" | "none",
  morphTargets: { count, faceRelevant, unused },
  profile: { channels, lowConfidence }
}
```

对 `three-vrm-girl`、`sample-a`、`sample-b` 三个资产做快照测试。每次改映射或升级 three-vrm，先跑这个诊断，避免再次出现「名称静默失效」。

---

## 8. 交付边界与待定问题

### 8.1 交付边界

- 调研阶段没有修改 `showcase/` 下任何文件；P0-1/P0-2 的实现随后由 #22/#23 接入展示线。
- `avatar.js` 属于展示线；后续改动仍需与展示线窗口约定接口和合并顺序，避免两边同时改同一文件。
- 模型线已提供（实际接口名）：
  - `buildProfile({ expressions, morphTargets, lookAtType, format })`：解析运行时能力，生成 preset 映射 profile。
  - `FaceMapper` / `CustomFaceMapper`：自动校准、平滑与 52 -> VRM 映射，输出 expression 权重和 lookAt yaw/pitch。
  - `buildCustomProfile({ morphTargets, expressions, lookAtType, format })`：扫描 morph target，生成 custom expression profile。
  - `groupBindsByMesh(meshes, profile)`：把 target 名称解析到实际 mesh/index。
  - 帧级测试：`tools/vrm_face/*.test.mjs`。
- 展示线已完成：
  - 在 `avatar.js` 中调用上述接口，并在 `loadFromBlob` 后建立 profile/mapper。
  - 加入 preset/custom 模式开关与 `resetValues()` 清理。
- 展示线后续负责：
  - 把 `mappingMs`、`lookAtType` 等指标接入 benchmark UI。
  - 如果需要「校准」按钮，由展示线加 UI，模型线提供 API。

### 8.2 待定问题

1. **主角模型选哪个？** `three-vrm-girl` 是默认，但 `sample-a/b` 的 expression 更完整（有 `MTH_Close`、`MTH_Small/Large` 等差异）。P0 的验收应至少覆盖 `sample-a` 和默认模型。
2. **是否需要单眼眨眼和独立视线？** 如果要，P0-1 就必须做 `blinkLeft/Right` 和 `vrm.lookAt`；如果只要「能动」，可以后置。
3. **是否接受 VRM 1.0 资产？** 如果接受，P1 的 c 可以提前；如果不接受，当前 VRM 0.x + b2 是主线。
4. **是否接受付费工具/Hana？** 如果接受，P1 的 b1 可以快速做出主角模型；如果不接受，用 Blender + Hinzka/NEB 的免费路线，但工作量更高。
5. **是否需要「校准」交互？** 自动基线校准可以默认开启；手动校准按钮需要展示线配合。
6. **是否需要保持 `viewer/index.html` 同步？** 它也有同样的 VRM 0.x 名称失配；如果旧 viewer 还要用，应单独修，但不属于本次展示线。

---

## 附录 A：52 通道分组与建议目标

> `当前` 指 `avatar.js` 是否使用；`P0/P1 目标` 是建议，不是最终实现。  
> D = 直接/较强对应；A = 近似/组合；X = 当前资产无对应；B = 走骨骼 lookAt。

| 区域 | ARKit 通道 | 当前 | 建议目标 |
|---|---|---|---|
| 中性 | `_neutral` | 未用 | 仅作置信度/门控，不驱动 `neutral` |
| 眉 | `browDownLeft/Right` | max -> `angry` | `angry` 加权 + custom `browDownL/R` |
| 眉 | `browInnerUp` | 参与 `browUp` | `sad`/`Surprised` 加权 + custom |
| 眉 | `browOuterUpLeft/Right` | 参与 `browUp` | `Surprised` 加权 + custom |
| 颊 | `cheekPuff` | 未用 | X；有目标时 custom |
| 颊 | `cheekSquintLeft/Right` | 未用 | `happy` 加权 + custom |
| 眼 | `eyeBlinkLeft/Right` | max -> `blink` | `blinkLeft/Right` 分眼 |
| 眼 | `eyeLookDownLeft/Right` | 仅 Left -> `lookDown` | B：`vrm.lookAt.pitch` |
| 眼 | `eyeLookInLeft/Right` | 未用 | B：水平视线组合 |
| 眼 | `eyeLookOutLeft/Right` | Out L/R -> `lookLeft/Right` | B：水平视线组合 |
| 眼 | `eyeLookUpLeft/Right` | 仅 Left -> `lookUp` | B：`vrm.lookAt.pitch` |
| 眼 | `eyeSquintLeft/Right` | 未用 | `relaxed` 加权 + custom |
| 眼 | `eyeWideLeft/Right` | 未用 | `Surprised` 加权 + custom |
| 颌 | `jawForward` | 未用 | X；有目标时 custom |
| 颌 | `jawLeft/Right` | 未用 | X；有目标时 custom |
| 颌 | `jawOpen` | `aa` | `aa` + `Surprised` 加权 |
| 嘴 | `mouthClose` | 未用 | custom / 有目标时直接 |
| 嘴 | `mouthDimpleLeft/Right` | 未用 | `happy` 加权 + custom |
| 嘴 | `mouthFrownLeft/Right` | max -> `sorrow` | `sad` |
| 嘴 | `mouthFunnel` | 未用 | `oh` |
| 嘴 | `mouthLeft/Right` | 未用 | X；有目标时 custom |
| 嘴 | `mouthLowerDownLeft/Right` | 未用 | `sad`/`aa` 加权 + custom |
| 嘴 | `mouthPressLeft/Right` | 未用 | `angry` 加权 + custom |
| 嘴 | `mouthPucker` | 未用 | `ou` |
| 嘴 | `mouthRollLower/Upper` | 未用 | X；有目标时 custom |
| 嘴 | `mouthShrugLower/Upper` | 未用 | X；有目标时 custom |
| 嘴 | `mouthSmileLeft/Right` | max -> `joy` | `happy` + 口型组合 |
| 嘴 | `mouthStretchLeft/Right` | 未用 | `ee`/`ih` + custom |
| 嘴 | `mouthUpperUpLeft/Right` | 未用 | `Surprised`/`ih` + custom |
| 鼻 | `noseSneerLeft/Right` | 未用 | `angry` 加权 + custom |

---

## 附录 B：复现与探针

### B.1 关键复现命令

```powershell
$py = "D:\Miniconda3\python.exe"
cd D:\DASH\V0FastTest
& $py -m pytest
```

本次调研使用的解析命令是临时脚本，读取 GLB 的 JSON chunk，不依赖 three.js：

```python
import json, struct

with open(path, "rb") as f:
    data = f.read()

off = 12
while off < len(data):
    length, ctype = struct.unpack_from("<II", data, off)
    off += 8
    chunk = data[off:off + length]
    off += length
    if ctype == 0x4E4F534A:  # JSON
        gltf = json.loads(chunk.decode("utf-8").rstrip("\x00 "))
        break
```

读取字段：

- `gltf["extensions"]["VRM"]["blendShapeMaster"]["blendShapeGroups"]`
- `gltf["extensions"]["VRM"]["firstPerson"]["lookAtTypeName"]`
- `gltf["meshes"][i]["primitives"][j]["extras"]["targetNames"]`
- `gltf["extensions"]["VRMC_vrm"]["expressions"]`（如果存在）

### B.2 临时探针文件

本次在仓库根目录创建了以下未入库脚本：

- `probe_tmp_vrm_survey.py`
- `probe_tmp_vrm_summary.py`
- `probe_tmp_vrm_sampleb.py`
- `probe_tmp_lookat.py`
- `probe_tmp_bones.py`
- `probe_tmp_counts.py`
- `probe_tmp_all_counts.py`
- `probe_tmp_target_overlap.py`
- `probe_tmp_target_diff.py`
- `probe_tmp_binds.py`
- `probe_tmp_unused.py`
- `probe_tmp_verts.py`
- `probe_tmp_mapped_names.py`

它们不参与构建，也不入库；待确认后删除。

---

## 附录 C：P0-1 / P0-2 实现状态（2026-10-21）

- P0-1 已实现：`tools/vrm_face/facemap.mjs`，覆盖 VRM 0.x/1.0 名称解析、分眼眨眼、骨骼视线、自动中性校准、分组归一、非对称平滑；18 项 Node 测试通过。
- P0-2 已实现：`tools/vrm_face/morphscan.mjs`，扫描 `BRW_*` / `EYE_*` / `MTH_*`，生成运行时 custom expression profile；`sample-a` 生成 20 个，`sample-b` 与 `three-vrm-girl` 生成 21 个；19 项 Node 测试通过。两个测试文件合计 37 项。
- `tools/vrm_face/` 是上游源码与测试（见 PR #25）；展示线运行副本位于 `showcase/frontend/src/vrm_face/`，内容与上游一致。
- 接入已由 #22/#23 完成：`avatar.js` 在加载模型后建立 profile/mapper，默认 preset 模式，custom 模式通过展示线开关切换；两个模块本身不依赖 three.js。接入方式见 `tools/vrm_face/README.md`。
- 当前尚未做真实浏览器端的主观 A/B 与端到端延迟回归；这是后续展示线验证的重点。

---

## 参考资料

1. VRM 1.0 expressions 规范：https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/expressions.md
2. three-vrm 仓库与文档：https://github.com/pixiv/three-vrm
3. VMagicMirror Perfect Sync 说明：https://malaybaku.github.io/VMagicMirror/en/tips/perfect_sync
4. Hinzka 52blendshapes-for-VRoid-face：https://github.com/hinzka/52blendshapes-for-VRoid-face
5. VRCFaceTracking ARKit 对照表：https://docs.vrcft.io/docs/tutorial-avatars/tutorial-avatars-extras/compatibility/arkit
6. VRoid FAQ：VRM 1.0 导出：https://vroid.pixiv.help/hc/en-us/articles/15760756822297
7. Blender VRM Add-on：https://github.com/saturday06/VRM-Addon-for-Blender
8. UniVRM：https://github.com/vrm-c/UniVRM
9. Warudo 3D VTubing Primer（Perfect Sync / ARKit 说明）：https://docs.warudo.app/docs/tutorials/3d-primer
