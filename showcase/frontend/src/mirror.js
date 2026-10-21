// 摄像头预览是镜像的（CSS scaleX(-1)），但 MediaPipe 输入的是未镜像的原始帧。
// 为了让皮套人与镜像预览方向一致，只对“驱动 VRM”的语义做镜像：
//   - head yaw / roll 取反（pitch 不受水平镜像影响）
//   - 左右眼视线交换
// 照片 / 视频预览不镜像，调用方不要传 mirror。

export function mirrorHeadEuler(headEuler) {
  if (!headEuler) return headEuler;
  return {
    x: headEuler.x,
    y: -headEuler.y,
    z: -headEuler.z,
  };
}

// cats: [{categoryName, score}]；返回镜像后的 lookLeft / lookRight 分数
export function pickGaze(cats, mirror) {
  let left = 0;
  let right = 0;
  if (cats) {
    for (const c of cats) {
      if (c.categoryName === "eyeLookOutLeft") left = c.score;
      else if (c.categoryName === "eyeLookOutRight") right = c.score;
    }
  }
  return mirror ? { left: right, right: left } : { left, right };
}

// 摄像头方向：部分笔记本（如华为 FHD Camera 5959:0107）的传感器倒装，
// getUserMedia 没有方向元数据，浏览器不会自动纠正。返回 0 或 180。
// saved 是用户对该 deviceId 的显式选择（"0" / "180"），优先于自动识别。
export function cameraRotateFor(label, saved) {
  if (saved === "180") return 180;
  if (saved === "0") return 0;
  return /FHD Camera \(5959:0107\)/i.test(label || "") ? 180 : 0;
}
