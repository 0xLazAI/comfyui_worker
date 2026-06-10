# Blender Workflow Design

## Goal

Build the Blender workflow locally across three services before deploying it online:

- `comfyui-worker`: PAI worker, workflow orchestration, task queue, agent script generation, asset upload.
- `pai-blender-api`: RESTful Blender execution service for local and GPU-machine deployment.
- `pai-blender-worker`: local test and observability console.

## Decisions

1. `comfyui-worker` owns the complete Blender workflow.
   It receives PAI tasks, routes by `payload.workflow`, generates Blender Python through the agent layer, calls `pai-blender-api`, polls execution, uploads artifacts, and writes task results.

2. `pai-blender-api` is only the Blender runner.
   It accepts a generated Blender script plus run metadata, executes Blender headlessly on the host, persists run-local logs/artifacts, and exposes REST endpoints for status, logs, and artifact download.

3. `pai-blender-worker` remains the dashboard/test console.
   It does not run production workflow logic. It submits test tasks to `comfyui-worker` and reads task/run logs from both `comfyui-worker` and `pai-blender-api`.

4. Routing follows the existing ComfyUI-style workflow pattern.
   There should be one Blender task family, for example `task_type=blender`, and the actual operation is selected by `payload.workflow`.

## Local Topology

```text
pai-blender-worker UI
  -> comfyui-worker POST /tasks
  -> Redis queue
  -> comfyui-worker blender consumer
  -> agent generates Blender Python
  -> pai-blender-api POST /runs
  -> local Blender headless execution
  -> comfyui-worker downloads run artifacts
  -> comfyui-worker uploads artifacts to object storage
  -> pai-blender-worker displays task status, preview, artifacts, and logs
```

For local development, `BLENDER_API_BASE_URL` points to the local `pai-blender-api`.
For GPU-machine testing or production, the same variable points to the remote GPU host.

## comfyui-worker Responsibilities

### Task Contract

Use the existing worker contract:

```json
{
  "task_id": "task_123",
  "task_type": "blender",
  "project_id": "project_abc",
  "project_root": "/data/pai-projects/project_abc",
  "payload": {
    "workflow": "blender-create-3d",
    "scene_id": "s001",
    "shot_id": "sh001",
    "inputs": {
      "image": {
        "assetUri": "assets://uploads/source.png"
      }
    },
    "pace": {
      "schema_version": "pai-blender-pace-draft-2026-06-09"
    }
  }
}
```

The first supported workflows are:

- `blender-create-3d`
- `blender-update-3d`

Additional Blender workflows should be added under the same `task_type=blender` family.

### Workflow Execution

The Blender consumer should:

1. Read the normalized task payload from `worker_tasks.request_payload`.
2. Hydrate a workflow-specific payload based on `payload.workflow`.
3. Download any input assets needed for agent context.
4. Generate Blender Python inside `comfyui-worker`.
5. Submit the generated script and metadata to `pai-blender-api`.
6. Poll until terminal status.
7. Download run artifacts from `pai-blender-api`.
8. Upload artifacts to the PAI asset store.
9. Store a result manifest in `worker_tasks.result_payload`.
10. Append task events for each major stage.

### Database

Do not migrate `pai-blender-worker`'s `blender_worker_*` tables into `comfyui-worker`.

Use existing tables:

- `worker_tasks` for state and final result.
- `worker_task_events` for stage logs.
- `worker_task_attempts` for attempt outcomes.
- `failed_jobs` for queue failures.
- `task_type_definitions` for task family registration.

### Result Shape

The final task result should return object-store URIs, not local runner paths:

```json
{
  "workflow": "blender-create-3d",
  "model_id": "model_abc",
  "run_id": "run_123",
  "artifacts": {
    "blend": "assets://blender/run_123/scene.blend",
    "model_obj": "assets://blender/run_123/model.obj",
    "preview": "assets://blender/run_123/preview.png",
    "summary": "assets://blender/run_123/summary.json",
    "pace": "assets://blender/run_123/pace.json",
    "generated_script": "assets://blender/run_123/generated_scene.py"
  }
}
```

## pai-blender-api Responsibilities

The API lives at `/Users/lumersgo/code/pai-blender-api`.

It should expose:

```text
GET  /health
POST /runs
GET  /runs/:run_id
GET  /runs/:run_id/logs
GET  /runs/:run_id/artifacts/:artifact_id
```

`POST /runs` receives:

- generated Blender Python script
- workflow id
- task id
- project id
- scene id
- shot id
- model id when applicable
- PACE JSON
- optional reference image bytes or a local staged path

It returns:

- `run_id`
- `status`
- `status_url`

The service executes Blender through `BLENDER_BIN`, writes run-local artifacts, captures stdout/stderr, and exposes artifacts for `comfyui-worker` to fetch.

## pai-blender-worker Responsibilities

`pai-blender-worker` stays as a local operator UI.

It should provide:

- Dashboard showing `comfyui-worker` and `pai-blender-api` health/config.
- Workflow test page that submits to `comfyui-worker`.
- Task list/detail page showing worker status, result manifest, and preview artifact.
- Logs page that shows `comfyui-worker` task events and `pai-blender-api` runner logs.

The UI should test the full chain by default:

```text
UI -> comfyui-worker -> queue worker -> pai-blender-api -> Blender
```

A runner-only debug mode may be added later, but it is not the default path.

## Configuration

`comfyui-worker` needs:

- `BLENDER_API_BASE_URL`
- `BLENDER_API_TOKEN` if auth is enabled
- Codex/OpenAI config for script generation
- existing PostgreSQL, Redis, S3/object-store config

`pai-blender-api` needs:

- `BLENDER_BIN`
- `BLENDER_API_PORT`
- local run/artifact/log directories
- optional bearer token

`pai-blender-worker` needs:

- `COMFYUI_WORKER_BASE_URL`
- `BLENDER_API_BASE_URL`

## Local Acceptance Criteria

1. Start local `pai-blender-api`.
2. Start local `comfyui-worker` HTTP server and queue worker on branch `blender-workflow`.
3. Start local `pai-blender-worker`.
4. Submit `blender-create-3d` from the UI.
5. `comfyui-worker` records a queued task, worker picks it up, and agent generates Blender Python.
6. `pai-blender-api` executes Blender and returns artifacts.
7. `comfyui-worker` uploads artifacts and marks the task done.
8. `pai-blender-worker` shows status, preview, artifacts, worker events, and runner logs.

## Deployment Direction

After local validation:

1. Deploy `pai-blender-api` to the GPU machine.
2. Point `BLENDER_API_BASE_URL` in `comfyui-worker` to the GPU service.
3. Keep `comfyui-worker` Docker free of Blender runtime assumptions.
4. Use `pai-blender-worker` as an operator console for staging verification.
