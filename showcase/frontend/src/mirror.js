// 摄像头预览是镜像的（CSS scaleX(-1)），但 MediaPipe 输入的是未镜像的原始帧。
// 驱动 VRM 前需要修正两件事：
//   - head pitch 取反：facialTransformationMatrix 的 pitch 方向与 VRM head 骨骼相反
//     （实测抬头会变成低头，因此 x 统一取负）
//   - 摄像头镜像时 yaw / roll 取反；分眼眨眼与视线的镜像由 facemap 的 mirror 参数负责
// 照片 / 视频预览不镜像，调用方不要传 mirror。
export function mapHeadEuler(headEuler, { mirror = false } = {}) {
  if (!headEuler) return headEuler;
  return {
    x: -headEuler.x,
    y: mirror ? -headEuler.y : headEuler.y,
    z: mirror ? -headEuler.z : headEuler.z,
  };
}
