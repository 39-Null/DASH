// 三种输入源的管理：camera(getUserMedia) / photo / video，统一收敛到「源画面元素」
// 浏览器本地推理时代：camera 的采集与显示都在本地，不再经过服务器。

export class SourceInput {
  constructor({ box, image, video }) {
    this.box = box;       // .source-box 容器
    this.image = image;   // <img>（photo）
    this.video = video;   // <video>（camera / video 共用）
    this.mode = null;     // "camera" | "photo" | "video"
    this._objectUrl = null;
    this._stream = null;
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
    this.video.srcObject = stream;
    await this.video.play();
    this.box.classList.add("mirrored"); // 自拍镜像习惯
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
    if (this.mode === "video") return this.video;
    if (this.mode === "camera" || this.mode === "photo") return this.image;
    return null;
  }

  stop() {
    this._resetMedia();
    this.mode = null;
  }
}
