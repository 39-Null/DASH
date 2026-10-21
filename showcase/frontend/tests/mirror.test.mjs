// 摄像头镜像语义回归：node --test showcase/frontend/tests/mirror.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mirrorHeadEuler, pickGaze } from "../src/mirror.js";

test("mirrorHeadEuler 只翻转 yaw / roll，保留 pitch", () => {
  const src = { x: 12, y: 20, z: 8 };
  const out = mirrorHeadEuler(src);
  assert.deepEqual(out, { x: 12, y: -20, z: -8 });
  assert.deepEqual(src, { x: 12, y: 20, z: 8 }, "不应修改原始帧");
});

test("mirrorHeadEuler 对 null 安全", () => {
  assert.equal(mirrorHeadEuler(null), null);
});

test("镜像模式下交换左右眼视线", () => {
  const cats = [
    { categoryName: "eyeLookOutLeft", score: 0.8 },
    { categoryName: "eyeLookOutRight", score: 0.2 },
  ];
  assert.deepEqual(pickGaze(cats, false), { left: 0.8, right: 0.2 });
  assert.deepEqual(pickGaze(cats, true), { left: 0.2, right: 0.8 });
});

test("缺失视线分数按 0 处理", () => {
  assert.deepEqual(pickGaze([], true), { left: 0, right: 0 });
  assert.deepEqual(pickGaze(null, false), { left: 0, right: 0 });
});

test("倒装摄像头按标签自动旋转 180", async () => {
  const { cameraRotateFor } = await import("../src/mirror.js");
  assert.equal(cameraRotateFor("FHD Camera (5959:0107)", null), 180);
  assert.equal(cameraRotateFor("USB Camera", null), 0);
});

test("用户对设备的显式选择优先于自动识别", async () => {
  const { cameraRotateFor } = await import("../src/mirror.js");
  assert.equal(cameraRotateFor("FHD Camera (5959:0107)", "0"), 0);
  assert.equal(cameraRotateFor("USB Camera", "180"), 180);
});
