# `hunyuan3d_three_view` 接入指南

三视图 → 3D 模型任务的调用方接入文档。任务把某角色/道具的 3–4 张正交视图生成一个 3D 模型(GLB),并把产物注册进该实体的**资产台账**(`entities/props.json` / `characters.json` 的 `model3d` 件槽)。

- `task_type`:`hunyuan3d_three_view`
- 产物:`assets://entity-models/<date>-<rand>.glb`,并写入目标实体 `model3d`
- 后端:PAILang studio `/api/modeling`(workflow `hunyuan3d_mv`)——worker 内部调用,调用方无需关心

---

## 1. 前置条件

1. **目标实体已存在于台账**。`target.entityId` 必须已在对应的 `entities/props.json` 或 `entities/characters.json` 中(按 `id` 匹配)。任务只会 `REPLACE` 它的 `model3d` 件槽,**不会新建实体**;找不到 → 任务 `failed`。
2. **视图已是 `assets://` 资产**。每个视图传 `assets://` URI(不是本地路径、不是 http URL)。可先用平台的资产上传接口(`createAssetUploadUrl` / `POST /api/{project}/assets/upload-url`,`assetKind = entity_image`)把图片上传成 `assets://`。
3. worker 已配置能访问 PAILang studio(见 §5 环境变量)。

---

## 2. 提交任务

`POST /tasks`(worker HTTP 合同,与 render_panel / train_style_lora 同一入口)。

```jsonc
{
  "task_id": "<幂等唯一 id>",
  "task_type": "hunyuan3d_three_view",
  "project_id": "demo-local",
  "payload": {
    "views": {
      "front": { "assetUri": "assets://entity-images/....png" },   // 必需
      "left":  { "assetUri": "assets://entity-images/....png" },   // 可选
      "right": { "assetUri": "assets://entity-images/....png" },   // 可选
      "back":  { "assetUri": "assets://entity-images/....png" }    // 可选
    },
    "target": {
      "entityKind": "prop",           // prop | character
      "entityId": "prop_oil_lamp",    // 台账里的实体 id(须已存在)
      "depictionIndex": 0              // 可选:挂到某个 depiction 的 model3d,而非实体级
    },
    "preset": "standard",             // 可选:fast | standard(默认 standard)
    "seed": 42,                       // 可选:随机种子
    "maxFaces": 120000                // 可选:覆盖 preset 的目标面数
  }
}
```

### 参数说明

| 字段 | 必需 | 类型 | 说明 |
|---|---|---|---|
| `views.front.assetUri` | 是 | string | 正面视图 `assets://` URI |
| `views.left/right/back.assetUri` | 否 | string | 其余视图 `assets://` URI;越全,侧/背面结构越准 |
| `target.entityKind` | 是 | enum | `prop` / `character` |
| `target.entityId` | 是 | string | 目标实体 id(须已存在) |
| `target.depictionIndex` | 否 | int≥0 | 挂到实体某个 depiction 的 `model3d` |
| `preset` | 否 | enum | `fast`(50k 面,快)/ `standard`(120k 面,默认) |
| `seed` | 否 | int≥0 | 随机种子 |
| `maxFaces` | 否 | int≥1000 | 覆盖 preset 的目标面数 |

> 校验分两层:平台的 task 定义 schema(`hunyuan3d_three_view` 内置定义)先做类型/必填/枚举校验,worker 端 `hydrateThreeView3dPayload` 再做边界校验(front 必需、URI 必须 `assets://` 等)。非法输入直接 `rejected`。

---

## 3. 生命周期与轮询

worker 内部是"自提交轮询"模型,调用方只需轮询任务状态:

`GET /tasks/{task_id}` → `status` 变化:`accepted → running → succeeded | failed | rejected | cancelled`。

内部阶段(体现在 `progress` 和事件流里,调用方可忽略细节):

1. **submit**:下载各视图 → 上传到 studio → `POST /api/modeling` 提交 → 记录 jobId → 重新入队。
2. **poll**:轮询 `/api/modeling/{job}`,未完成则每几秒重入队一次。
3. **finalize**:下载 GLB → 上传为 `ENTITY_MODEL_3D` 资产 → `writePaceFiles` patch 实体 `model3d` → `succeeded`。

事件类型(`GET /tasks/{task_id}/events` 若有):`started` → `model3d_submitted` → `model3d_polled`(多次)→ `succeeded` / `failed`。

standard 档整体约 1–2 分钟(取决于 GPU 排队),fast 更快。

---

## 4. 结果

成功后任务 `result`:

```jsonc
{
  "modelingJobId": "af47...",
  "model3dUri": "assets://entity-models/20260707-Ab3dEf9x.glb",
  "entityKind": "prop",
  "entityId": "prop_oil_lamp",
  "ledgerPath": "entities/props.json",
  "ledgerPointer": "/3/model3d",
  "faces": 120000,
  "verts": 59884,
  "dimensions": { "height_y": 1.97, "footprint_xz": [0.9, 0.57], "ratio": [0.45,1.0,0.29], "ground_offset_y": -1.0, "...": "glTF Y-up;每资产独立归一化" }
}
```

> `result` 只是**状态摘要**,不是台账真值。真值是台账文件里被 patch 的 `model3d` 件槽:
> ```jsonc
> // entities/props.json 中该实体
> "model3d": { "status": "ready", "uri": "assets://entity-models/....glb", "source": "generated", "group": "asset_model3d:prop_oil_lamp", "versionId": "take1" }
> ```
> 读回 GLB:用 `model3dUri`(或台账里的 `uri`)向平台换短期下载 URL(`assetUrl` / `GET /api/{project}/assets/url?assets_uri=...`)。`dimensions` 可直接用于 3D 故事版摆放(见字段说明:Y 向上,尺寸已归一化)。

---

## 5. 环境变量(worker 侧)

| 变量 | 默认 | 说明 |
|---|---|---|
| `PAILANG_STUDIO_BASE_URL` | 回退 `STEPHEN_RENDER_BASE_URL`,否则 `http://34.215.238.232:8911` | 3D 后端 studio 地址(与 Stephen render 同一台) |
| `HUNYUAN3D_MODELING_WORKFLOW` | `hunyuan3d_mv` | 提交给 `/api/modeling` 的 workflow id |
| `HUNYUAN3D_MODELING_POLL_INTERVAL_SECONDS` | `5` | 轮询间隔 |

> studio 若是自签证书的 https,worker 需设 `NODE_TLS_REJECT_UNAUTHORIZED=0`,或把 `PAILANG_STUDIO_BASE_URL` 指到可直连的 http。

---

## 6. 幂等与错误

- **幂等**:同 `task_id` 重试安全;台账写回用 `REPLACE model3d`(覆盖同一件槽,不重复追加)。
- **实体不存在**:`target.entityId` 不在台账 → `failed`(`entity ... not found`)。
- **校验失败**:缺 front / 非 `assets://` / 非法 `entityKind` → `rejected`。
- **后端失败**:`/api/modeling` job 报错或连不上 → `failed`,`result` 带 `modeling_failed` / `modeling_request_failed`。

---

## 7. 端到端示例(HTTP)

```bash
# 1) 提交
curl -X POST "$WORKER/tasks" -H 'content-type: application/json' -d '{
  "task_id":"m3d-demo-1","task_type":"hunyuan3d_three_view","project_id":"demo-local",
  "payload":{
    "views":{"front":{"assetUri":"assets://entity-images/lamp_front.png"},
             "left":{"assetUri":"assets://entity-images/lamp_left.png"},
             "back":{"assetUri":"assets://entity-images/lamp_back.png"}},
    "target":{"entityKind":"prop","entityId":"prop_oil_lamp"},
    "preset":"standard"}}'

# 2) 轮询到终态
curl "$WORKER/tasks/m3d-demo-1"     # status: running → succeeded

# 3) 成功后 result.model3dUri 即产物;台账里该 prop 的 model3d 已被写入
```

相关代码:任务定义 `src/taskDefinitions/taskTypeDefinitionStore.ts`、handler `src/tasks/threeView3dTaskExecution.ts`、后端 client `src/model3d/hunyuan3dClient.ts`、台账写回 `src/model3d/entityLedger.ts`。
