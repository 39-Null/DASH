// 模型分发：manifest 版本比对 + IndexedDB 缓存 + 按需下载。
// 服务器更新模型的流程 = 换文件 + manifest 版本号 +1，访客下次打开自动拉新。

const DB_NAME = "dash-models";
const STORE = "models";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(name);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(name, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function downloadWithProgress(url, sizeBytes, onProgress) {
  const resp = await fetch(url, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`model download failed: HTTP ${resp.status} ${url}`);
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress) onProgress(received, sizeBytes || 0);
  }
  return new Blob(chunks);
}

export async function fetchManifest() {
  const resp = await fetch("models/manifest.json", { cache: "no-cache" });
  if (!resp.ok) throw new Error(`manifest download failed: HTTP ${resp.status}`);
  return resp.json();
}

// 确保拿到模型文件的 Blob（缓存命中则零网络）；返回 { blob, entry, fromCache }
export async function ensureModel(name, onProgress) {
  const manifest = await fetchManifest();
  const entry = manifest.models.find((m) => m.name === name);
  if (!entry) throw new Error(`model ${name} not in manifest`);
  const cachedVer = localStorage.getItem(`dash.modelVer.${name}`);
  if (cachedVer === entry.version) {
    const blob = await idbGet(name);
    if (blob) return { blob, entry, fromCache: true };
  }
  const blob = await downloadWithProgress(entry.url, entry.sizeBytes, onProgress);
  await idbPut(name, blob);
  localStorage.setItem(`dash.modelVer.${name}`, entry.version);
  return { blob, entry, fromCache: false };
}

// 工具：把缓存的 Blob 转成 FaceLandmarker 需要的 Uint8Array
export async function blobToBuffer(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}
