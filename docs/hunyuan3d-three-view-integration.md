# `hunyuan3d_three_view` 接入指南

三视图 → 3D 模型任务的调用方接入文档。任务把某实体的正交视图生成一个 3D 模型(GLB),并把产物注册进该实体的**资产台账**(`entities/characters.json` / `props.json` 的 `model3d` 件槽 + 项目 `manifest.json` 的 `asset_model3d` artifact take)。

**两种输入模式(二选一):**
- **模式 A(推荐):传一张三视图整图 sheet**(`turnaround.assetUri`)。worker 内部按白列投影把整图切成单视图(角色 = 正/侧/背三视 → front/left/back),切片是临时中间产物,不落台账。这正对接 storyboard-tool `complete_entity_assets` 生成的 turnaround。
- **模式 B:传已切好的单视图**(`views.front/left/right/back`)。

- `task_type`:`hunyuan3d_three_view`
- 产物:`assets://entity-models/<date>-<rand>.glb`,写入目标实体 `model3d` 件槽 + append 一条 `asset_model3d` take(`current`)
- 后端:PAILang studio `/api/modeling`(workflow `hunyuan3d_mv`)——worker 内部调用,调用方无需关心
- 建模对象:**character / prop**。走 `model_input_sheet`(`formatVersion=v1`)时两者布局一致
  (一行 front/left/back)——布局由**格式版本**决定,与实体类型无关。
  (老的 styled sheet 路径仍按 entityKind 切,character=三视 / prop=两视。)
  location 暂不支持(`entityKind` 无此项;场景建模待定输入格式)

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
    // —— 模式 A:整图 sheet(worker 内部切片)——
    // 推荐:storyboard-tool 的 model_input_sheet artifact(中性技术风、专供图生 3D),
    // 把 artifact 的 formatVersion / normalized 一起透传过来。
    "turnaround": {
      "assetUri": "assets://entity-images/entity_char_yan_model_v1_1536_1024.png",
      "formatVersion": "v1",   // model_input_sheet 的格式版本;不传=老的 styled sheet
      "normalized": true       // 上游三等分归一化是否成功;缺省/null 当 false
    },

    // —— 或 模式 B:预切单视图(与 turnaround 二选一;两者都给以 views 优先)——
    // "views": {
    //   "front": { "assetUri": "assets://entity-images/....png" },   // 提供 views 时必需
    //   "left":  { "assetUri": "assets://entity-images/....png" },   // 可选
    //   "right": { "assetUri": "assets://entity-images/....png" },   // 可选
    //   "back":  { "assetUri": "assets://entity-images/....png" }    // 可选
    // },
    "target": {
      "entityKind": "character",      // character(主)| prop
      "entityId": "char_yan_liang",   // 台账里的实体 id(须已存在)
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
| `turnaround.assetUri` | 二选一 | string | 模式 A:三视图整图 sheet 的 `assets://` URI,worker 内部切片 |
| `turnaround.formatVersion` | 否 | string | storyboard-tool `model_input_sheet` 的格式版本(现只认 `v1` = 一行 front/left/back,**三类实体统一**)。**不传** = 老的 styled turnaround sheet(按 entityKind 切)。**未知版本直接拒绝**(400),绝不猜:将来 v2(如四视图)被当 v1 切会静默出错模型 |
| `turnaround.normalized` | 否 | bool | 上游三等分归一化是否**真的成功**。`true` → 按精确 1/N 等分切;`false`/缺省/null → 上游回退了原图,改用空白投影测量。缺省当 `false`(来路不明不算保证) |
| `views.front.assetUri` | 二选一 | string | 模式 B:正面单视图 `assets://` URI(提供 views 时必需) |
| `views.left/right/back.assetUri` | 否 | string | 其余单视图 `assets://` URI;越全,侧/背面结构越准 |
| `target.entityKind` | 是 | enum | `character`(主)/ `prop` |
| `target.entityId` | 是 | string | 目标实体 id(须已存在) |
| `target.depictionIndex` | 否 | int≥0 | 挂到实体某个 depiction 的 `model3d` |
| `preset` | 否 | enum | `fast`(50k 面,快)/ `standard`(120k 面,默认) |
| `seed` | 否 | int≥0 | 随机种子 |
| `maxFaces` | 否 | int≥1000 | 覆盖 preset 的目标面数 |

> 校验分两层:平台的 task 定义 schema(`hunyuan3d_three_view` 内置定义)先做类型/枚举校验;字段级 schema 无法表达 turnaround/views「二选一」,故由 worker 端 `hydrateThreeView3dPayload` 兜底(turnaround 或 views.front 至少给一个、URI 必须 `assets://` 等)。非法输入直接 `rejected`。

---

## 3. 生命周期与轮询

worker 内部是"自提交轮询"模型,调用方只需轮询任务状态:

`GET /tasks/{task_id}` → `status` 变化:`accepted → running → succeeded | failed | rejected | cancelled`。

内部阶段(体现在 `progress` 和事件流里,调用方可忽略细节):

1. **submit**:解析视图(模式 A 下载整图并切片;模式 B 下载各单视图)→ 上传到 studio → `POST /api/modeling` 提交 → 记录 jobId → 重新入队。
2. **poll**:轮询 `/api/modeling/{job}`,未完成则每几秒重入队一次;超过 `HUNYUAN3D_MODELING_MAX_DURATION_SECONDS`(默认 30 分钟)仍未终态 → `failed`(超时),不再无限重入队。
3. **finalize**:下载 GLB → 上传为 `ENTITY_MODEL_3D` 资产 → 一次 `writePaceFiles` 原子写(append `asset_model3d` take 置 `current` + 同组旧 current 置 false + 镜像实体 `model3d` 件槽)→ `succeeded`。

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

> `result` 只是**状态摘要**,不是台账真值。真值有两处(一次原子写):
> ```jsonc
> // 1) entities/characters.json 中该实体的件槽(镜像 current take)
> "model3d": { "status": "ready", "uri": "assets://entity-models/....glb", "source": "generated", "group": "asset_model3d:char_yan_liang", "versionId": "asset_take_1_af47c2" }
> // 2) 项目 manifest.json 的 artifacts[] 追加一条 take(append-only + 血缘)
> { "kind": "asset_model3d", "ref": "char_yan_liang", "uri": "assets://...glb", "versionId": "asset_take_1_af47c2", "current": true, "supersedesId": null, "source": "worker_generated", "status": "ready", "mediaType": "model/gltf-binary", "createdAt": "..." }
> ```
> 重生成不覆盖:append 新 take(`asset_take_2...`,`supersedesId` 指上一条)、置 `current`,旧 take `current=false`;件槽 `versionId` 跟着指向新 current。
> 读回 GLB:用 `model3dUri`(或台账里的 `uri`)向平台换短期下载 URL(`assetUrl` / `GET /api/{project}/assets/url?assets_uri=...`)。`dimensions` 可直接用于 3D 故事版摆放(见字段说明:Y 向上,尺寸已归一化)。

---

## 5. 环境变量(worker 侧)

| 变量 | 默认 | 说明 |
|---|---|---|
| `STEPHEN_RENDER_BASE_URL` | (必填) | 3D 建模 studio 地址,复用 Stephen render 同一台(`/api/modeling` 接口)。不再有独立的 `PAILANG_STUDIO_BASE_URL` |
| `HUNYUAN3D_MODELING_WORKFLOW` | `hunyuan3d_mv` | 提交给 `/api/modeling` 的 workflow id |
| `HUNYUAN3D_MODELING_POLL_INTERVAL_SECONDS` | `5` | 轮询间隔 |
| `HUNYUAN3D_MODELING_MAX_DURATION_SECONDS` | `1800` | 轮询超时上限;超过即 `failed`,避免无限重入队 |

> studio 若是自签证书的 https,worker 需设 `NODE_TLS_REJECT_UNAUTHORIZED=0`,或把 `STEPHEN_RENDER_BASE_URL` 指到可直连的 http。

---

## 6. 幂等与错误

- **幂等**:同 `task_id` 重试安全;件槽写回用 `add`(首次即成功,不要求路径预先存在);重生成走 append-only take + `current` 切换,可回溯历史版本。
- **实体不存在**:`target.entityId` 不在台账 → `failed`(`entity ... not found`)。
- **校验失败**:turnaround 与 views 都没给 / URI 非 `assets://` / 非法 `entityKind` → `rejected`。
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

---

## 加一个 `formatVersion`(给未来的你)

**当前只有 `v1`**(上游 storyboard-tool `MODEL_INPUT_FORMAT_VERSION = "v1"`,一行 front/left/back)。

### 先理解一件事:版本不是迁移,是长期共存

上游的 skip-existing 判断是**版本无关**的 —— 它只问「这个实体有没有 current 的 `model_input_sheet`」,
不问是哪个版本。所以**一旦某实体有了 v1 图,上游 bump 到 v2 后也不会给它重出**(除非 `force`)。
老图是不可变的 artifact take,还在项目里、还要能建模。

→ **v1 和 v2 会在同一个项目里同时存在,长期如此。** 你不是在「升级到 v2」,你是在「新增支持 v2」。

### 怎么加

版本相关的一切都在 `src/model3d/modelSheetFormat.ts` 的 `MODEL_SHEET_PROFILES` 里,**只增不改**:

```ts
export const MODEL_SHEET_PROFILES: Record<string, ModelSheetProfile> = {
  v1: { /* 不要动这一条 */ },
  v2: {
    layout: { count: 4, slots: ['front', 'left', 'back', 'right'] },
    background: '#E6E6E6',
    inkThreshold: 205,
  },
};
```

| v2 改了什么 | 你要做的 |
|---|---|
| 视图数 / 槽位顺序 | `layout` |
| 背景色 | `background` **和** `inkThreshold` —— **这俩是一个决定**,trim 的容差是它们的差值,单独调一个就是当初 trim 静默失效的原因 |
| 只是 sheet 像素尺寸变了 | **什么都不用做**(切图读真实尺寸、按比例切),而且这种改动本就不该 bump |
| 布局**结构性**变了(如 2×2 网格) | 给 v2 的 profile 加一个 `slice` 函数;v1 继续走共享的单行切法,一行不动 |

### 三条硬规矩

1. **绝不修改已有版本的条目。** `modelSheetFormat.test.ts` 冻结了 v1 —— 你加 v2 时它红了,
   说明你改错行了。已生成的 v1 图是不可变的,改 v1 的 profile = 悄悄把它们切成另一个(错的)模型。
2. **未知版本直接拒绝,不要兜底成 v1 或「最新版」。** 猜一个没见过的格式 = 静默出烂模型,
   任务失败远好过这个。能在这里失败,正是这个字段存在的全部意义。
3. **`normalized` 语义自动泛化**,不用管:它用的是 `layout.count`,三视是 1/3、四视自然就是 1/4。
