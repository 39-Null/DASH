# vendored VRM face mapping

`facemap.mjs` 从 `tools/vrm_face/facemap.mjs` 复制而来（P0-1），保持文件内容一致；
模型线更新后需同步覆盖本文件。

P0-2 的 `morphscan.mjs` 也已 vendored，并在 `avatar.js` 中通过「面部映射 preset/custom」开关接入；
custom 模式注入 `arkit_*` expression，默认仍走 preset。

注意：VRM 0.x 的 targetNames 在 `primitive.extras`，three.js GLTFLoader 只读 `mesh.extras.targetNames`；
`avatar.js` 会按 `parser.associations` 补齐 `morphTargetDictionary`。
