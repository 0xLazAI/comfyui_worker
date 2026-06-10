# ComfyUI Worker

一个对齐 PAI worker contract 的 worker，内置 `render_panel` 和 `blender` 两种 task type。

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
- 最终图片上传到 S3 / Object Storage，结果只回 `assets://renders/...`

## Task Contract

当前内置 task type：

- `task_type = render_panel`
- `task_type = blender`

`payload` 采用通用结构：

```json
{
  "workflow": "bg_retouch_preserve_subject_v1",
  "panelId": "scene_02_shot_01_panel_0001",
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
- `panelId` 必须符合 `scene_<id>_shot_<id>_panel_<id>`
- 输入图片可以直接传 `assets://`，也可以通过 `multipart/form-data` 上传源文件
- `backend`、`base_model`、`positive`、`negative` 不属于公共 contract，不允许直接出现在 payload 顶层

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

结构如下：

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

启动时，worker 会自动补齐内置 task definition seed：

- `render_panel`
- `blender`

其中 `blender` 的内置定义只覆盖通用 contract 字段；不同 workflow 的更细粒度必填约束仍由 `src/blender/payload.ts` 处理。

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

创建一个新任务定义的例子：

```bash
curl -X POST 'http://host/task-definitions' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'x-operator: maozhijian' \
  --data-raw '{
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
4. 如果需要，补对应的 provider / asset / sidecar 逻辑
5. 通过 `POST /task-definitions` 创建启用中的定义
6. 调 `GET /capabilities` 确认新 `task_type` 已经暴露
7. 用 `POST /tasks` 提一条最小任务
8. 轮询 `GET /tasks/{task_id}` 验证最终状态

### 6. 对外新增 Task Type 时要注意什么

这套架构里：

- `task_type` 决定业务路由
- `consumer_key` 决定代码执行逻辑
- `definition_json` 决定 payload 规则

所以：

- 如果只是改参数校验或默认值，可以只改 `task_type_definitions`
- 如果要接一类全新的业务逻辑，必须先补代码里的 `consumer`

另外，`GET /capabilities` 返回的 `supported_tasks` 是从数据库里启用中的定义动态生成的，不是硬编码列表。

## Storage

项目目录只写 metadata sidecar：

- `scenes/<scene_id>/shots/<shot_id>/storyboard/<panel_id>.outputs.json`

最终图片只写对象存储：

- `assets://renders/YYYYMMDD-<random>.png`

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
- Blender provider
  - `BLENDER_API_BASE_URL`
  - `BLENDER_API_TOKEN`
  - `BLENDER_API_POLL_INTERVAL_SECONDS`
  - `BLENDER_API_TIMEOUT_SECONDS`
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
