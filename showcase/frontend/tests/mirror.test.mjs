// 摄像头镜像语义回归：node --test showcase/frontend/tests/mirror.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mapHeadEuler, pickGaze } from "../src/mirror.js";

test("mapHeadEuler 修正 pitch，镜像时翻转 yaw / roll", () => {
  const src = { x: 12, y: 20, z: 8 };
  assert.deepEqual(mapHeadEuler(src), { x: -12, y: 20, z: 8 });
  assert.deepEqual(mapHeadEuler(src, { mirror: true }), { x: -12, y: -20, z: -8 });
  assert.deepEqual(src, { x: 12, y: 20, z: 8 }, "不应修改原始帧");
});

test("mapHeadEuler 对 null 安全", () => {
  assert.equal(mapHeadEuler(null), null);
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
