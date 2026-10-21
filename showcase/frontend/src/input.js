// 三种输入源的管理：camera(getUserMedia) / photo / video，统一收敛到「源画面元素」
// 浏览器本地推理时代：camera 的采集与显示都在本地，不再经过服务器。
import { cameraRotateFor } from "./mirror.js?v=10";

export class SourceInput {
  constructor({ box, image, video }) {
    this.box = box;       // .source-box 容器
    this.image = image;   // <img>（photo）
    this.video = video;   // <video>（camera / video 共用）
    this.mode = null;     // "camera" | "photo" | "video"
    this._objectUrl = null;
    this._stream = null;
    this.cameraRotate = 0; // 0 | 180（仅摄像头）
    // 旋转后的推理画布：部分笔记本摄像头传感器倒装，CSS 只能修正预览，
    // MediaPipe 也必须拿到转正后的帧，否则网格 / 皮套人方向会不对。
    this._cameraCanvas = document.createElement("canvas");
    this._cameraCtx = this._cameraCanvas.getContext("2d", { alpha: false });
  }

  _resetMedia() {
    this.image.hidden = true;
    this.video.hidden = true;
    this.image.removeAttribute("src");
    if (this._stream) {
      for (const track of this._stream.getTracks()) track.stop(); // 释放摄像头
      this._stream = null;
    }
    this.video.srcObject = null;
    this.video.removeAttribute("src");
    this.video.load();
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
    this.box.classList.remove("mirrored");
    this.video.classList.remove("rotate-180");
    this.cameraRotate = 0;
  }

  _cameraTrack() {
    return this._stream?.getVideoTracks?.()[0] ?? null;
  }

  _cameraKey() {
    const id = this._cameraTrack()?.getSettings?.().deviceId || "default";
    return `dash.cameraRotate.${id}`;
  }

  _saveRotate(deg) {
    try {
      localStorage.setItem(this._cameraKey(), String(deg));
    } catch {
      // 隐私模式下写不进 localStorage，不影响本次使用
    }
  }

  _applyCameraRotate() {
    this.video.classList.toggle("rotate-180", this.cameraRotate === 180);
  }

  // camera：getUserMedia 本地采集（浏览器推理时代，画面不再过服务器）
  async startCamera() {
    this._resetMedia();
    this.mode = "camera";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    this._stream = stream;
    this.video.hidden = false;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.controls = false;
    this.video.loop = false;
    this.video.srcObject = stream;
    await this.video.play();
    this.box.classList.add("mirrored"); // 自拍镜像习惯

    // 方向：用户对该设备的显式选择优先，否则按已知倒装摄像头自动识别
    const track = this._cameraTrack();
    let saved = null;
    try {
      saved = localStorage.getItem(this._cameraKey());
    } catch {}
    this.cameraRotate = cameraRotateFor(track?.label || "", saved);
    this._applyCameraRotate();
    if (saved == null) this._saveRotate(this.cameraRotate);
  }

  // 手动兜底：画面方向不对时切换 0 / 180，并按设备记住
  toggleCameraRotate() {
    this.cameraRotate = this.cameraRotate === 180 ? 0 : 180;
    this._applyCameraRotate();
    this._saveRotate(this.cameraRotate);
    return this.cameraRotate;
  }

  // 返回转正后的画布（摄像头）；未旋转时也返回原始帧，保证调用方统一
  cameraFrame() {
    const v = this.video;
    if (!v.videoWidth || !v.videoHeight) return null;
    const c = this._cameraCanvas;
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
    }
    const ctx = this._cameraCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (this.cameraRotate === 180) {
      ctx.translate(c.width, c.height);
      ctx.rotate(Math.PI);
    }
    ctx.drawImage(v, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return c;
  }

  setPhoto(file) {
    this._resetMedia();
    this.mode = "photo";
    this._objectUrl = URL.createObjectURL(file);
    this.image.hidden = false;
    this.image.src = this._objectUrl;
  }

  setVideo(file) {
    this._resetMedia();
    this.mode = "video";
    this._objectUrl = URL.createObjectURL(file);
    this.video.hidden = false;
    this.video.controls = true;
    this.video.loop = true;
    this.video.src = this._objectUrl;
  }

  activeMedia() {
    if (this.mode === "video" || this.mode === "camera") return this.video;
    if (this.mode === "photo") return this.image;
    return null;
  }

  stop() {
    this._resetMedia();
    this.mode = null;
  }
}
