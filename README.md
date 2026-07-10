# ComfyUI Worker

一个对齐 `pai_platform/develop` 新版 PAI worker contract 的 `render_panel` worker。

对外：

- `GET /health`
- `GET /capabilities`
- `POST /tasks`
- `GET /tasks/{task_id}`
- `schema.json`
- `credentials.json`
- `heartbeat.json`
- `description.md`

对内：

- 任务状态落 PostgreSQL
- API 进程只负责持久化并入 Redis 队列
- queue worker 异步执行真正的 render
- provider 目前接 Stephen 平台异步 render API
- worker 注册、心跳、PACE 文件读写优先通过 Pai Platform API
- 结果图片当前仍保留 S3 / Object Storage 兼容上传层，结果回 `assets://renders/...`

## Platform Mode

当前实现按 `worker-graphql-migration.md` 走 Pai Platform GraphQL：

- worker 注册：`registerWorker`
- worker 心跳：`heartbeatWorker`
- PACE 文件读取：`paceFile`
- PACE 产物写入：`writePaceFiles(patches)`，局部 append artifact，不再整文件覆盖 manifest
- 资产上传：`createAssetUploadUrl`，worker 用返回的 signed URL 上传二进制，只把 `assets://...` 写回 PACE
- 资产下载：仍使用平台资产 URL 接口解析 `assets://...`

需要的核心配置：

- `PAI_PLATFORM_API_BASE`
- `PAI_PLATFORM_API_KEY`

说明：

- worker 只使用 `x-api-key`，不使用用户 bearer token。
- `projectRoot` 已废弃；平台模式下 worker 不直接读写 `/data/pai-projects/{project_id}`。
- 本地项目目录、S3 直传只作为 `PAI_PLATFORM_API_BASE` 未配置时的兼容模式。

## Task Contract

当前主要支持：

- `task_type = render_panel`
- `task_type = replace_prop_panel`
- `task_type = train_style_lora`
- `task_type = hunyuan3d_three_view`

`payload` 采用通用结构：

```json
{
  "workflow": "bg_retouch_preserve_subject_v1",
  "panelId": "ps002_sh001_p0001",
  "prompt": {
    "text": "Keep the three foreground characters unchanged...",
    "negativeText": "Do not change the foreground people..."
  },
  "inputs": {
    "image": {
      "assetUri": "assets://renders/20260608-AbCd123.png"
    }
  },
  "seed": 202606041,
  "extraParams": {
    "denoise": 0.76,
    "growMask": 5
  }
}
```

也支持 `multipart/form-data` 直接上传源图文件：

- 文本字段：`task_id`、`task_type`、`project_id`、`project_root`
- 文本字段：`payload`，值是 JSON 字符串
- 文件字段：`source_image`，兼容别名 `image`

worker 收到文件后会先上传到对象存储，再自动写回 `payload.inputs.image.assetUri`，后面的任务流程不变。

约束：

- `workflow` 必填
- `panelId` 推荐使用 canonical 形式：
  - `ps001_sh001_p0001`
- 兼容旧输入：
  - `scene_02_shot_01_panel_0001`
- 输入图片可以直接传 `assets://`，也可以通过 `multipart/form-data` 上传源文件
- `backend`、`base_model`、`positive`、`negative` 不属于公共 contract，不允许直接出现在 payload 顶层

### `train_style_lora` 风格 LoRA 训练

`train_style_lora` 用来提交一个风格化 LoRA 训练任务。worker 只管理生命周期：

- 接收任务、校验入参、写数据库状态
- 通过 SSH 调 GPU 机器上的训练 runner
- 定期轮询 runner 状态
- 训练完成后登记本地 LoRA 路径

worker 不下载训练集、不拼训练脚本、不上传 LoRA 到 S3。GPU runner 负责从 S3 拉数据集、校验 image/txt pair、执行训练，并在 `finalize` 时返回本地结果路径。

最小初训请求：

```jsonc
{
  "task_id": "train-dunhuang-style-v3",
  "task_type": "train_style_lora",
  "project_id": "film",
  "payload": {
    "mode": "initial",
    "baseProfile": "flux2_dev_bf16",
    "lora": {
      "name": "dunhuang_flux2_style_v3",
      "kind": "style",
      "trigger": "dunhuangmap"
    },
    "dataset": {
      "uri": "s3://pai-training-datasets/film/dunhuang_style_v3/"
    }
  }
}
```

补训请求：

```jsonc
{
  "task_id": "continue-dunhuang-style-v4",
  "task_type": "train_style_lora",
  "project_id": "film",
  "payload": {
    "mode": "continue_weights",
    "baseProfile": "flux2_dev_bf16",
    "lora": {
      "name": "dunhuang_flux2_style_v4",
      "kind": "style",
      "trigger": "dunhuangmap"
    },
    "dataset": {
      "uri": "s3://pai-training-datasets/film/dunhuang_style_v4_continue/"
    },
    "continueFrom": {
      "loraPath": "/home/ubuntu/sd/lora_runs/train_xxx/output/dunhuang_flux2_style_v3.safetensors"
    },
    "train": {
      "steps": 1200,
      "lr": 0.00005
    }
  }
}
```

支持的训练基座：

- `flux2_dev_bf16`：用 FLUX2 bf16 训练，产物用于 `flux2_dev_fp8mixed.safetensors` 推理。
- `flux2_klein9b`：用 Klein9B 训练，产物用于 Klein9B 推理工作流。

数据集格式固定为单层平铺 S3 prefix：

```text
s3://pai-training-datasets/film/dunhuang_style_v3/
  000001.png
  000001.txt
  000002.jpg
  000002.txt
  000003.webp
  000003.txt
```

规则：

- 第一版不支持子目录。
- 每张图片必须有同名 `.txt` caption。
- 支持图片后缀：`.png`、`.jpg`、`.jpeg`、`.webp`。
- caption 固定为 UTF-8 `.txt`，不能为空。
- 缺 caption、空 caption、坏图时，runner 应让任务失败并返回错误明细。

可选训练参数：

```jsonc
{
  "train": {
    "preset": "style",
    "rank": 16,
    "alpha": 16,
    "steps": 2000,
    "lr": 0.0001,
    "seed": 42,
    "saveEvery": 500
  },
  "publish": {
    "mode": "local",
    "filename": "dunhuang_flux2_style_v3.safetensors"
  }
}
```

如果不传训练参数，worker 会按 `baseProfile + mode` 补默认值：

- `flux2_dev_bf16` 初训：`rank=16`、`alpha=16`、`steps=2000`、`lr=1e-4`
- `flux2_dev_bf16` 补训：`rank=16`、`alpha=16`、`steps=1200`、`lr=5e-5`
- `flux2_klein9b` 初训：`rank=32`、`alpha=16`、`steps=4000`、`lr=1e-4`
- `flux2_klein9b` 补训：`rank=32`、`alpha=16`、`steps=1500`、`lr=5e-5`

GPU runner 命令约定：

```bash
train_style_lora submit < request.json
train_style_lora status --job-id train_xxx
train_style_lora finalize --job-id train_xxx
```

训练 runner 脚本由本仓库维护：

- 本地源文件：`scripts/train_style_lora_runner.py`
- worker 在 `submit` 前计算本地脚本 `sha256`
- 通过 SSH 读取远端 `${LORA_TRAINER_REMOTE_SCRIPT}.sha256`
- hash 一致时跳过同步
- hash 不一致时先 `scp` 到 `.tmp`
- GPU 机上用 `flock` 锁住 `${LORA_TRAINER_SYNC_LOCK_FILE}`，拿锁后复查 hash
- 复查仍不一致时再 `mv` 原子替换；如果等锁期间其他 worker 已同步完成，就清理 `.tmp` 并跳过
- 只同步 `.py` runner，不覆盖 GPU 机上的 `.env`
- `status/finalize` 不做同步，仍然执行固定 `LORA_TRAINER_COMMAND`

相关环境变量：

```bash
LORA_TRAINER_SYNC_ENABLED=true
LORA_TRAINER_LOCAL_SCRIPT=scripts/train_style_lora_runner.py
LORA_TRAINER_REMOTE_SCRIPT=/home/ubuntu/sd/lora-trainer/bin/train_style_lora.py
LORA_TRAINER_REMOTE_ENV_FILE=/home/ubuntu/sd/lora-trainer/.env
LORA_TRAINER_SYNC_LOCK_FILE=/home/ubuntu/sd/lora-trainer/.sync.lock
```

`LORA_TRAINER_COMMAND` 建议保持为固定 wrapper，例如：

```bash
/home/ubuntu/sd/lora-trainer/bin/train_style_lora
```

同步逻辑会确保 wrapper 存在；wrapper 负责加载 `LORA_TRAINER_REMOTE_ENV_FILE`，然后执行远端 `.py` runner。

`submit` 返回：

```json
{
  "jobId": "train_xxx",
  "runDir": "/home/ubuntu/sd/lora_runs/train_xxx",
  "statusPath": "/home/ubuntu/sd/lora_runs/train_xxx/status.json",
  "logPath": "/home/ubuntu/sd/lora_runs/train_xxx/train.log",
  "outputDir": "/home/ubuntu/sd/lora_runs/train_xxx/output"
}
```

`status` 返回：

```json
{
  "status": "running",
  "phase": "training",
  "currentStep": 820,
  "totalSteps": 2000,
  "progress": 0.41,
  "message": "training 820/2000"
}
```

`finalize` 返回：

```json
{
  "status": "succeeded",
  "lora": {
    "publishMode": "local",
    "usableScope": "training_gpu_only",
    "name": "dunhuang_flux2_style_v3",
    "baseProfile": "flux2_dev_bf16",
    "trigger": "dunhuangmap",
    "localPath": "/home/ubuntu/sd/lora_runs/train_xxx/output/dunhuang_flux2_style_v3.safetensors",
    "metadataPath": "/home/ubuntu/sd/lora_runs/train_xxx/output/dunhuang_flux2_style_v3.metadata.json"
  }
}
```

失败策略：

- 训练脚本中途报错时，整个 `train_style_lora` task 标记为 `failed`。
- 第一版不做自动断点恢复。
- 重新训练时重新提交新的 task，新建新的 run 目录，从头跑。
- 测试图不放在训练流程里；如需验收，后续单独接 `test_lora_render` 任务。

### `replace_prop_panel` 风格锁定示例

下面这个例子用于“把舞狮头部替换成猪头造型的舞狮头”，重点是让新物体继承原图的黑白漫画线稿风格，而不是生成成默认的彩色写实猪头。

```jsonc
{
  "task_id": "codex-pig-head-style-lock-20260626020600",
  "task_type": "replace_prop_panel",
  "project_id": "project-mqtrvwwh-351wt0",
  "payload": {
    "inputs": {
      "image": {
        // 源图资产。replace_prop_panel 推荐直接传 assets://，避免 multipart 源图重复上传。
        "assetUri": "assets://renders/20260625-xt39k1kC.png"
      }
    },
    // 使用 canonical panel id，worker 会映射到 PAI Studio 的 scene/shot/panel 路径。
    "panelId": "ps001_sh001_p0001",
    "workflow": "prop_replace_general_flux2_v1",
    "replace": {
      // 自动框选的目标描述。尽量写成图中可见物体，而不是最终要生成的新物体。
      // 这个 case 用“舞狮的头部”比“狮子头”更稳定，能减少框到周围背景/其他道具的概率。
      "sourceProp": "舞狮的头部",

      // 正向指令必须同时说明“替换成什么”和“保持什么风格”。
      // 如果只写“换成猪头”，Flux 容易套用彩色写实猪头先验。
      "instruction": "把舞狮的头部换成一个猪头造型的舞狮头，保持原图黑白漫画线稿风格、灰度、笔触、光影、透视和构图一致，人物和背景不变"
    },
    "prompt": {
      // 反向提示用于压住彩色、写实、3D、真实皮肤等常见跑偏方向。
      "negativeText": "彩色，粉色，照片写实，三维渲染，真实皮肤，真实动物头，光滑塑料质感，人物改变，背景改变，线稿丢失，风格变化"
    },
    "params": {
      // 局部重绘强度。0.44 比默认 0.56 更保守，更容易保留原图线稿和灰度风格。
      "denoise": 0.44,

      // mask 外扩像素。替换单个道具时保持小一点，避免影响人物和背景。
      "growMask": 2,

      // Flux guidance。略低于默认值，减少模型过度追逐“猪头”语义导致的写实化。
      "guidance": 2.8,

      // 采样步数。28 比默认 24 稍高，给低 denoise 下的局部细节一点空间。
      "steps": 28,

      // CFG。低 CFG 能减少风格漂移，更多依赖原图条件。
      "cfg": 1.7,

      // GroundingDINO 阈值。比默认略高，减少误框；如果漏框再往下调。
      "groundConfidence": 0.1,
      "groundTextThreshold": 0.16,

      // precise 强制使用 SAM 精确 mask，不走长条 corridor 自动逻辑。
      // 通用物品替换里，如果目标不是筷子/勺子这类长条物体，优先用 precise。
      "maskMode": "precise"
    }
  }
}
```

这组参数对应的结果资产：

```text
assets://renders/20260625-oqmAI6wQ.png
```

### `hunyuan3d_three_view` 三视图生成 3D 模型

`hunyuan3d_three_view` 用某角色/道具的 3–4 张正交视图生成 3D 模型(GLB),并把产物注册进该实体的**资产台账 `model3d` 件槽**。worker 只管理生命周期:把视图交给 PAILang studio 的 `/api/modeling`(workflow `hunyuan3d_mv`)执行,轮询完成后下载 GLB → 上传为 `ENTITY_MODEL_3D` 资产 → `writePaceFiles` patch 实体 `model3d`。

请求 payload:

```jsonc
{
  "task_type": "hunyuan3d_three_view",
  "project_id": "demo-local",
  "payload": {
    "views": {
      "front": { "assetUri": "assets://entity-images/....png" },  // 必需
      "left":  { "assetUri": "assets://..." },                    // 可选
      "right": { "assetUri": "assets://..." },                    // 可选
      "back":  { "assetUri": "assets://..." }                     // 可选
    },
    "target": {
      "entityKind": "prop",          // prop | character
      "entityId": "prop_oil_lamp",   // 须已存在于 entities/props.json | characters.json
      "depictionIndex": 0             // 可选:挂到某个 depiction 的 model3d
    },
    "preset": "standard",            // 可选 fast | standard(默认 standard)
    "seed": 42,                      // 可选
    "maxFaces": 120000               // 可选
  }
}
```

执行流程:

1. 对每个视图 `downloadAsset` → `POST /api/modeling/upload` 拿 `image_path`。
2. `POST /api/modeling` 提交,轮询 `GET /api/modeling/{job}` 到终态。
3. `GET /api/modeling/{job}/model.glb` 下载 GLB。
4. `createAssetUploadUrl(ENTITY_MODEL_3D)` + PUT 上传 → `assets://entity-models/....glb`。
5. `writePaceFiles` `REPLACE` 目标实体的 `model3d` 件槽为 `{status:"ready", uri, source:"generated", ...}`。

结果 `result`:`{ model3dUri, entityId, ledgerPath, ledgerPointer, faces, verts, dimensions }`。相关环境变量见 `.env.example`(`PAILANG_STUDIO_BASE_URL` 等)。

## Add A New Task

这套 worker 现在不是把 `task_type` 写死在 HTTP 路由里，而是拆成两层：

- 代码层负责实现 `consumer`
- 数据库里的 `task_type_definitions` 负责声明：
  - 哪个 `task_type` 走哪个 `consumer_key`
  - payload 允许哪些字段
  - 哪些字段必填
  - 哪些字段有默认值

也就是说，接一个新任务时，不是只改代码，也不是只改数据库，而是两边都要补齐。

### 1. 先实现 Consumer

每个新任务最终都要落到一个 `consumer_key`。

当前分发入口在：

- [taskExecution.ts](/Users/maozhijian/Documents/GitHub/comfyui_worker/src/tasks/taskExecution.ts:1)

关键点：

- `handleTaskExecute(...)` 会先从 `worker_tasks.request_payload._taskDefinition.consumerKey` 里读 `consumer_key`
- 然后到 `CONSUMER_HANDLERS` 里找具体 handler
- `supportsConsumerKey(...)` 也基于同一个 map 做校验

所以新增任务最少要做两件事：

1. 新增一个 handler  
   例如：
   - `handleUpscalePanelExecute(...)`
   - `handleExtractMaskExecute(...)`

2. 把它注册进 `CONSUMER_HANDLERS`  
   例如：

```ts
const CONSUMER_HANDLERS: Record<string, typeof handleRenderPanelExecute> = {
  render_panel_consumer: handleRenderPanelExecute,
  upscale_panel_consumer: handleUpscalePanelExecute,
};
```

如果 `consumer_key` 没注册：

- `POST /task-definitions` 会直接拒绝
- 即使手工写进数据库，消费时也会报 `Unsupported consumer_key`

### 2. 定义这个 Task Type 的 Payload

任务定义存在表：

- `task_type_definitions`

关键字段是：

- `worker_name`
- `task_type`
- `version`
- `enabled`
- `description`
- `definition_json`
- `created_at`
- `updated_at`
- `created_by`
- `updated_by`

这里真正决定校验规则的是 `definition_json`。

`definition_json` 结构如下：

```json
{
  "consumer_key": "render_panel_consumer",
  "payload": {
    "allow_unknown_fields": false,
    "fields": {
      "workflow": {
        "type": "string",
        "required": true
      },
      "panelId": {
        "type": "string",
        "required": true
      },
      "prompt.text": {
        "type": "string",
        "required": true
      },
      "prompt.negativeText": {
        "type": "string",
        "required": false,
        "default": ""
      },
      "seed": {
        "type": "integer",
        "required": false
      },
      "extraParams.denoise": {
        "type": "number",
        "required": false,
        "default": 0.76,
        "minimum": 0,
        "maximum": 1
      }
    }
  }
}
```

规则说明：

- `type` 目前只支持：
  - `string`
  - `number`
  - `integer`
  - `boolean`
- `required=true` 表示不传就报错
- `default` 表示缺省时自动补齐
- `allow_unknown_fields=false` 表示 payload 里不能出现未声明字段

标准化逻辑在：

- [definitionSchema.ts](/Users/maozhijian/Documents/GitHub/comfyui_worker/src/taskDefinitions/definitionSchema.ts:1)

### 3. 把 Task Definition 写进数据库

任务定义可以通过管理接口增删改查：

- `GET /task-definitions`
- `GET /task-definitions/:id`
- `POST /task-definitions`
- `PUT /task-definitions/:id`
- `DELETE /task-definitions/:id`

这组接口需要：

- `Authorization: Bearer <COMFYUI_WORKER_TOKEN>`

其中：

- `worker_name` 用来决定把这个任务注册到哪个 worker 目录
- 它只影响注册文件写入，不参与任务消费逻辑

创建、更新、删除任务定义成功后，服务会立刻按 `worker_name` 重新发布注册信息。

当前主路径是：

- 调 Pai Platform 的 worker 注册 API

兼容模式下才会写：

- `/data/pai-projects/.pai-workers/<worker_name>/schema.json`
- `/data/pai-projects/.pai-workers/<worker_name>/credentials.json`
- `/data/pai-projects/.pai-workers/<worker_name>/description.md`

这里不会做追加注册，而是按当前数据库里该 `worker_name` 下所有 `enabled=true` 的定义全量重建覆盖，所以不会重复注册。

创建一个新任务定义的例子：

```bash
curl -X POST 'http://host/task-definitions' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'x-operator: maozhijian' \
  --data-raw '{
    "worker_name": "storyboard-worker",
    "task_type": "upscale_panel",
    "version": 1,
    "enabled": true,
    "description": "对 panel 结果图做放大。",
    "definition_json": {
      "consumer_key": "upscale_panel_consumer",
      "payload": {
        "allow_unknown_fields": false,
        "fields": {
          "panelId": { "type": "string", "required": true },
          "inputs.image.assetUri": { "type": "string", "required": true },
          "scale": { "type": "integer", "required": false, "default": 2, "minimum": 2, "maximum": 4 }
        }
      }
    }
  }'
```

几个约束：

- 同一个 `task_type + version` 不能重复
- 同一个 `task_type` 同时只应该有一个 `enabled=true` 的版本
- `consumer_key` 必须是代码里已经支持的 key
- 同一个 `worker_name` 的注册文件始终按数据库重建覆盖，不会追加重复 task

### 4. 提交任务时会发生什么

`POST /tasks` 收到请求后，会：

1. 按顶层 `task_type` 查启用中的定义
2. 按 `definition_json` 校验 `payload`
3. 自动补默认值
4. 把标准化后的 payload 写进 `worker_tasks.request_payload`
5. 同时把任务定义绑定信息写进：
   - `request_payload._taskDefinition`
   - `request_payload._taskRuntime`
6. 入 Redis 队列

所以消费端拿到的不是原始 payload，而是已经补齐默认值的标准化 payload。

这点很重要：

- 你后面改了 `task_type_definitions`
- 不会影响已经入队的旧任务

因为旧任务执行时会优先使用它自己请求快照里固化的：

- `consumerKey`
- `definitionId`
- `version`

### 5. 新任务接入的最小 Checklist

新增一个 `task_type`，建议按这个顺序做：

1. 先确定 `consumer_key`
2. 写具体 handler
3. 把 `consumer_key -> handler` 注册到 `CONSUMER_HANDLERS`
4. 确定这个任务应该归属哪个 `worker_name`
5. 如果需要，补对应的 provider / asset / sidecar 逻辑
6. 通过 `POST /task-definitions` 创建启用中的定义
7. 检查该 `worker_name` 在 Pai Platform 中是否已更新
8. 调 `GET /capabilities` 确认新 `task_type` 已经暴露
9. 用 `POST /tasks` 提一条最小任务
10. 轮询 `GET /tasks/{task_id}` 验证最终状态

### 6. 对外新增 Task Type 时要注意什么

这套架构里：

- `worker_name` 决定注册到哪个 worker 文件目录
- `task_type` 决定业务路由
- `consumer_key` 决定代码执行逻辑
- `definition_json` 决定 payload 规则

所以：

- 如果只是改参数校验或默认值，可以只改 `task_type_definitions`
- 如果要接一类全新的业务逻辑，必须先补代码里的 `consumer`

另外，`GET /capabilities` 返回的 `supported_tasks` 是从数据库里启用中的定义动态生成的，不是硬编码列表。

## PACE Outputs

新 contract 下，worker 不再依赖 `storyboard/*.outputs.json`。

当前成功任务会把结果写回：

- `scenes/<sceneId>/shots/<shotId>/manifest.json`
- 具体是往 `artifacts[]` 里追加一条记录

记录内容至少包括：

- `kind`
- `uri`
- `panelId`
- `createdAt`
- `mediaType`
- `source`
- `status`

其中：

- `uri` 是 `assets://renders/...`
- `panelId` 使用 canonical panel id
- PACE 文件内容遵循 camelCase 字段；旧的 snake_case 字段只保留在本地兼容 sidecar 里

旧的 `storyboard/*.outputs.json` 只作为兼容模式保留，不再是主路径。

## Storage

最终图片仍然上传到对象存储：

- `assets://renders/YYYYMMDD-<random>.png`

源图如果走 `multipart/form-data` 上传，也会先落成：

- `assets://uploads/YYYYMMDD-<random>.png`

任务状态与时间线落数据库：

- `worker_tasks`
- `worker_task_events`
- `worker_task_attempts`
- `failed_jobs`

## Schema

数据库表结构由 TypeORM 实体自动同步：

- [WorkerTask.ts](/Users/maozhijian/Documents/GitHub/comfyui_worker/src/models/WorkerTask.ts:1)
- [WorkerTaskEvent.ts](/Users/maozhijian/Documents/GitHub/comfyui_worker/src/models/WorkerTaskEvent.ts:1)
- [WorkerTaskAttempt.ts](/Users/maozhijian/Documents/GitHub/comfyui_worker/src/models/WorkerTaskAttempt.ts:1)
- [FailedJob.ts](/Users/maozhijian/Documents/GitHub/comfyui_worker/src/models/FailedJob.ts:1)

## Run

```bash
cd /Users/maozhijian/Documents/GitHub/comfyui_worker
npm install
npm run start
npm run queue:worker
```

## Docker

构建镜像：

```bash
cd /Users/maozhijian/Documents/GitHub/comfyui_worker
docker build -t comfyui-worker:local .
```

本地起 API + queue worker（默认模式）：

```bash
docker run --rm -p 8091:8091 \
  --env-file .env \
  -v /absolute/host/pai-projects:/data/pai-projects:rw \
  -v /absolute/host/pai-cache:/var/cache/pai \
  -v /absolute/host/pai-tmp:/var/tmp/pai \
  -v /absolute/host/pai-log:/var/log/pai \
  comfyui-worker:local
```

如果你要手动拆开运行，也仍然支持：

```bash
docker run --rm \
  --env-file .env \
  -v /absolute/host/pai-projects:/data/pai-projects:rw \
  -v /absolute/host/pai-cache:/var/cache/pai \
  -v /absolute/host/pai-tmp:/var/tmp/pai \
  -v /absolute/host/pai-log:/var/log/pai \
  comfyui-worker:local worker
```

容器内的固定目录约定：

- 工程目录挂载根：`/data/pai-projects`
- registry 目录：`/data/pai-projects/.pai-workers`
- cache：`/var/cache/pai`
- tmp：`/var/tmp/pai`
- log：`/var/log/pai`

也就是说，宿主机上可以先把 WebDAV 挂到任意目录，例如 `/mnt/pai-projects`，再 bind mount 到容器内的 `/data/pai-projects`。

## DigitalOcean App Platform

这个镜像现在默认就是单容器双进程：

- 前台主进程：HTTP service
- 后台由 `supervisord` 保活：queue worker

所以在 DO App Platform 上，默认只需要一个 service component，不再要求你额外再建一个 worker component。

但要注意，PAI worker contract 要求项目目录是一个共享挂载目录，而 DO App Platform 不支持这种部署方式。DigitalOcean 官方文档明确说明：

- App Platform 本地文件系统是临时的，重部署和实例替换后会丢失
- App Platform 不支持 volumes
- 不能以持久且多实例一致的方式把网络卷挂到容器文件系统

参考：

- [How to Store Data in App Platform](https://docs.digitalocean.com/products/app-platform/how-to/store-data/)
- [App Platform Limits](https://docs.digitalocean.com/products/app-platform/details/limits/)

所以：

- 如果只是验证镜像、验证 provider/S3/DB/Redis 链路，App Platform 可以跑，而且默认会同时带起 API 和 consumer
- 如果要满足 PAI worker 的共享项目目录合约，应该部署到 Droplet 或 DOKS，然后把 WebDAV 或其他共享文件系统挂到宿主机，再 bind mount 到容器内 `/data/pai-projects`

如果你在 App Platform 上只是做 smoke test，建议显式设置：

```bash
PAI_PROJECTS_EXPECT_SHARED_FS=false
```

这样语义上就不会假装自己有共享挂载。

## Droplet Deployment

如果你要真正挂载共享项目目录，推荐直接用 Droplet。

这套仓库已经带了：

- [deploy/droplet/deploy.sh](/Users/maozhijian/Documents/GitHub/comfyui_worker/deploy/droplet/deploy.sh)
- [deploy/droplet/install-host.sh](/Users/maozhijian/Documents/GitHub/comfyui_worker/deploy/droplet/install-host.sh)
- [deploy/droplet/comfyui-worker.supervisor.conf](/Users/maozhijian/Documents/GitHub/comfyui_worker/deploy/droplet/comfyui-worker.supervisor.conf)
- [deploy/droplet/droplet.env.example](/Users/maozhijian/Documents/GitHub/comfyui_worker/deploy/droplet/droplet.env.example)

Droplet 版现在是宿主机直跑，不再依赖 Docker。  
代码会直接从 GitHub 仓库拉到宿主机，再由 `supervisord` 维护：

- HTTP server
- queue worker

部署步骤：

1. 复制一份 `deploy/droplet/droplet.env.example` 为 `deploy/droplet/droplet.env`
2. 填好：
   - `DEPLOY_HOST`
   - `REPO_URL`
   - `DEPLOY_REF`
   - `PAI_WEBDAV_URL`
   - `PAI_WEBDAV_USERNAME`
   - `PAI_WEBDAV_PASSWORD`
   - `LOCAL_ENV_FILE`
3. 确保本地 `.env.prod` 已经填好 PostgreSQL / Redis / S3 / Stephen 配置
4. 执行：

```bash
cd /Users/maozhijian/Documents/GitHub/comfyui_worker
bash deploy/droplet/deploy.sh
```

这个脚本会做：

- 让 Droplet 从 GitHub clone / fetch 仓库
- 上传本地 `.env.prod` 到远端 `${APP_DIR}/.env`
- 安装 `nodejs`、`git`、`davfs2`、`supervisor`
- 把 WebDAV 挂到宿主机 `${PAI_WEBDAV_MOUNT_POINT}`
- 再 bind 到宿主机 `/data/pai-projects`
- `npm ci && npm run compile`
- 写入并刷新 `supervisord` 配置

最终挂载关系是：

- WebDAV：`${PAI_WEBDAV_MOUNT_POINT}`
- 应用实际使用：`/data/pai-projects`

## Required Env

最关键的是这几组：

- Worker 基础配置
  - `COMFYUI_WORKER_NAME`
  - `COMFYUI_WORKER_HOST`
  - `COMFYUI_WORKER_PORT`
  - `COMFYUI_WORKER_BASE_URL`
  - `COMFYUI_WORKER_TOKEN`
- 工程目录挂载
  - `PAI_PROJECTS_MOUNT_ROOT`
  - `PAI_PROJECTS_MOUNT_MODE`
  - `PAI_PROJECTS_EXPECT_SHARED_FS`
  - `PAI_CACHE_DIR`
  - `PAI_TMP_DIR`
  - `PAI_LOG_DIR`
- PostgreSQL / Redis
  - `DATABASE_URL`
  - `REDIS_URL`
- Stephen provider
  - `STEPHEN_RENDER_BASE_URL`
- S3 / object storage
  - `PAI_ASSET_ENDPOINT`
  - `PAI_ASSET_BUCKET`
  - `PAI_ASSET_REGION`
  - `PAI_ASSET_ACCESS_KEY_ID`
  - `PAI_ASSET_SECRET_ACCESS_KEY`
  - `PAI_ASSET_PREFIX_TEMPLATE`
  - `PAI_ASSET_URL_EXPIRES_SECONDS`

`PAI_ASSET_PREFIX_TEMPLATE` 支持 `{project_id}` 占位符，例如：

- `{project_id}/`
- `staging/{project_id}/`

完整示例见 [.env.example](/Users/maozhijian/Documents/GitHub/comfyui_worker/.env.example:1)。
