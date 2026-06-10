# ComfyUI Worker

一个对齐 PAI worker contract 的 `render_panel` worker。

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

当前只支持：

- `task_type = render_panel`

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
- [deploy/droplet/comfyui-worker-server.service](/Users/maozhijian/Documents/GitHub/comfyui_worker/deploy/droplet/comfyui-worker-server.service)
- [deploy/droplet/comfyui-worker-consumer.service](/Users/maozhijian/Documents/GitHub/comfyui_worker/deploy/droplet/comfyui-worker-consumer.service)
- [deploy/droplet/droplet.env.example](/Users/maozhijian/Documents/GitHub/comfyui_worker/deploy/droplet/droplet.env.example)

Droplet 版现在是宿主机直跑，不再依赖 Docker。  
代码会直接从 GitHub 仓库拉到宿主机，再由 `systemd` 维护：

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
3. 确保本地 `.env` 已经填好 PostgreSQL / Redis / S3 / Stephen 配置
4. 执行：

```bash
cd /Users/maozhijian/Documents/GitHub/comfyui_worker
bash deploy/droplet/deploy.sh
```

这个脚本会做：

- 让 Droplet 从 GitHub clone / fetch 仓库
- 上传本地 `.env` 到远端 `${APP_DIR}/.env`
- 安装 `nodejs`、`git`、`davfs2`
- 把 WebDAV 挂到宿主机 `${PAI_WEBDAV_MOUNT_POINT}`
- 再 bind 到宿主机 `/data/pai-projects`
- `npm ci && npm run compile`
- 安装并重启两个 `systemd` 服务

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
