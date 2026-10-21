// 摄像头镜像语义回归：node --test showcase/frontend/tests/mirror.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mapHeadEuler } from "../src/mirror.js";

test("mapHeadEuler 修正 pitch，镜像时翻转 yaw / roll", () => {
  const src = { x: 12, y: 20, z: 8 };
  assert.deepEqual(mapHeadEuler(src), { x: -12, y: 20, z: 8 });
  assert.deepEqual(mapHeadEuler(src, { mirror: true }), { x: -12, y: -20, z: -8 });
  assert.deepEqual(src, { x: 12, y: 20, z: 8 }, "不应修改原始帧");
});

test("mapHeadEuler 对 null 安全", () => {
  assert.equal(mapHeadEuler(null), null);
});
