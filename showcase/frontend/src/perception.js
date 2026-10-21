// 浏览器内感知层：MediaPipe Tasks JS FaceLandmarker。
// 与 Python 后端是同一模型（face_landmarker.task），输出对齐现有 applyFrame 契约：
//   { blendshapes: [{categoryName, score}], landmarks: [{x,y,z}×478], headEuler: {x,y,z} }
// headEuler 来自 Tasks JS 的 facialTransformationMatrixes（4x4 变换矩阵），
// 比服务端的 solvePnP 近似更准。
import { FaceLandmarker, FilesetResolver } from "../vendor/vision/vision_bundle.mjs?v=8";

let _fileset = null;

async function fileset() {
  if (!_fileset) {
    _fileset = await FilesetResolver.forVisionTasks("vendor/vision/wasm");
  }
  return _fileset;
}

// modelBuffer: Uint8Array（modelstore 下载/缓存的 .task 内容）
export async function createFaceLandmarker(modelBuffer, runningMode) {
  const fs = await fileset();
  return FaceLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetBuffer: modelBuffer, delegate: "CPU" },
    runningMode, // "VIDEO" | "IMAGE"
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
}

// 4x4 列主序变换矩阵 → 头部欧拉角（度）
function eulerFromMatrix(data) {
  if (!data || data.length < 16) return null;
  const deg = 180 / Math.PI;
  return {
    x: Math.atan2(data[6], data[10]) * deg,
    y: Math.atan2(-data[2], Math.hypot(data[0], data[1])) * deg,
    z: Math.atan2(data[1], data[0]) * deg,
  };
}

// Tasks JS 结果 → 前端通用帧格式；无人脸返回 null
export function toFrame(result) {
  const face = result?.faceLandmarks?.[0];
  if (!face) return null;
  return {
    blendshapes: result.faceBlendshapes?.[0]?.categories ?? null,
    landmarks: face,
    headEuler: eulerFromMatrix(result.facialTransformationMatrixes?.[0]?.data),
  };
}

// 视频逐帧批处理：拖动 playhead 逐点采样。stride 为采样间隔毫秒（默认 15 FPS）。
export async function processVideo(video, landmarker, onProgress, strideMs = 66) {
  const frames = [];
  const durationMs = video.duration * 1000;
  const total = Math.ceil(durationMs / strideMs);
  video.pause();
  const seeked = () => new Promise((r) => video.addEventListener("seeked", r, { once: true }));
  for (let t = 0, i = 0; t < durationMs; t += strideMs, i++) {
    video.currentTime = t / 1000;
    await seeked();
    const frame = toFrame(landmarker.detectForVideo(video, Math.round(t)));
    const item = { frame: i, timestampMs: Math.round(t), ok: !!frame };
    if (frame) {
      item.blendshapes = frame.blendshapes;
      item.landmarks = frame.landmarks;
      item.headEuler = frame.headEuler;
    }
    frames.push(item);
    if (onProgress) onProgress(frames.length, total);
  }
  return frames;
}
