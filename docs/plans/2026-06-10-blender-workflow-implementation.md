# Blender Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run the full Blender workflow locally through `pai-blender-worker -> comfyui-worker -> pai-blender-api -> local Blender`, then prepare the same path for GPU-machine deployment.

**Architecture:** `comfyui-worker` owns task orchestration, workflow routing, agent script generation, queue state, and asset upload. `pai-blender-api` is a RESTful Blender execution service that receives generated scripts and returns run artifacts/logs. `pai-blender-worker` is a local test and observability console that submits tasks to `comfyui-worker` and displays worker plus runner state.

**Tech Stack:** TypeScript, Node.js, Express, PostgreSQL, Redis, TypeORM, AWS S3-compatible object storage, OpenAI Codex SDK, Next.js, Blender headless CLI, Vitest.

---

## Repositories

- Main worker branch: `/Users/lumersgo/code/comfyui-worker`, branch `blender-workflow`
- New runner service: `/Users/lumersgo/code/pai-blender-api`
- Test console: `/Users/lumersgo/Code/pai-blender-worker`

## Task 1: Verify Workspaces And Branch

**Files:**
- Verify: `/Users/lumersgo/code/comfyui-worker`
- Verify: `/Users/lumersgo/Code/pai-blender-worker`
- Create later: `/Users/lumersgo/code/pai-blender-api`

**Step 1: Verify `comfyui-worker` branch**

Run:

```bash
cd /Users/lumersgo/code/comfyui-worker
git status --short --branch
```

Expected: branch is `blender-workflow`; no unexpected uncommitted code changes.

**Step 2: Verify design docs exist**

Run:

```bash
ls docs/plans/2026-06-10-blender-workflow-design.md
ls docs/plans/2026-06-10-blender-workflow-implementation.md
```

Expected: both files exist.

**Step 3: Commit plan-only changes**

Run:

```bash
git add docs/plans/2026-06-10-blender-workflow-implementation.md
git commit -m "docs: add blender workflow implementation plan"
```

Expected: commit succeeds.

## Task 2: Add Test Harness To `comfyui-worker`

**Files:**
- Modify: `/Users/lumersgo/code/comfyui-worker/package.json`
- Modify: `/Users/lumersgo/code/comfyui-worker/package-lock.json`
- Create: `/Users/lumersgo/code/comfyui-worker/vitest.config.ts`

**Step 1: Add the failing test command**

Add scripts:

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Add dev dependencies:

```json
{
  "vitest": "^4.1.8"
}
```

**Step 2: Install dependencies**

Run:

```bash
cd /Users/lumersgo/code/comfyui-worker
npm install
```

Expected: `package-lock.json` updates.

**Step 3: Add config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

**Step 4: Run tests**

Run:

```bash
npm test
```

Expected: no tests found or pass, depending on Vitest behavior.

**Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "test: add worker test harness"
```

## Task 3: Extend Task Definition Schema For JSON Payload Fields

**Files:**
- Modify: `/Users/lumersgo/code/comfyui-worker/src/taskDefinitions/types.ts`
- Modify: `/Users/lumersgo/code/comfyui-worker/src/taskDefinitions/definitionSchema.ts`
- Test: `/Users/lumersgo/code/comfyui-worker/src/taskDefinitions/definitionSchema.test.ts`

**Step 1: Write failing tests**

Create tests proving:

- `type: "object"` accepts plain objects.
- `type: "json"` accepts arrays, objects, strings, numbers, booleans, and null.
- required/default behavior remains unchanged.
- unknown field rejection still works.

Example test:

```ts
import { describe, expect, test } from 'vitest';
import { normalizePayloadWithDefinition, normalizeTaskDefinitionJson } from './definitionSchema.js';

test('object fields preserve nested payloads', () => {
  const definition = normalizeTaskDefinitionJson({
    consumer_key: 'blender_consumer',
    payload: {
      allow_unknown_fields: false,
      fields: {
        workflow: { type: 'string', required: true },
        pace: { type: 'object', required: true },
      },
    },
  });

  expect(normalizePayloadWithDefinition({
    workflow: 'blender-create-3d',
    pace: { schema_version: 'test', scene: { scene_id: 's001' } },
  }, definition)).toEqual({
    workflow: 'blender-create-3d',
    pace: { schema_version: 'test', scene: { scene_id: 's001' } },
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm test -- src/taskDefinitions/definitionSchema.test.ts
```

Expected: failure because `object/json` are unsupported.

**Step 3: Implement schema support**

Change `TaskDefinitionFieldType`:

```ts
export type TaskDefinitionFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'json';
```

Update normalization:

- `object`: value must be non-null object and not array.
- `json`: accept any JSON-compatible value.
- defaults for `object/json` should use `structuredClone`.
- numeric min/max only applies to number/integer.

**Step 4: Run tests**

Run:

```bash
npm test -- src/taskDefinitions/definitionSchema.test.ts
npm run compile
```

Expected: pass.

**Step 5: Commit**

```bash
git add src/taskDefinitions/types.ts src/taskDefinitions/definitionSchema.ts src/taskDefinitions/definitionSchema.test.ts
git commit -m "feat: support object task definition fields"
```

## Task 4: Add Blender Payload And Workflow Catalog To `comfyui-worker`

**Files:**
- Create: `/Users/lumersgo/code/comfyui-worker/src/blender/types.ts`
- Create: `/Users/lumersgo/code/comfyui-worker/src/blender/workflowCatalog.ts`
- Create: `/Users/lumersgo/code/comfyui-worker/src/blender/payload.ts`
- Test: `/Users/lumersgo/code/comfyui-worker/src/blender/payload.test.ts`
- Reference: `/Users/lumersgo/Code/pai-blender-worker/src/lib/worker-types.ts`
- Reference: `/Users/lumersgo/Code/pai-blender-worker/src/server/task-request.ts`

**Step 1: Write failing payload tests**

Cover:

- `blender-create-3d` requires `scene_id`, `shot_id`, `pace`, and image input.
- `blender-update-3d` requires `scene_id`, `shot_id`, `model_id`, and `prompt`.
- `agent` defaults to `codex`.
- `runner_target` defaults to `gpu`.
- `pace.scene.scene_id` and `pace.scene.shot_id` are forced from task fields.

**Step 2: Run test to verify failure**

```bash
npm test -- src/blender/payload.test.ts
```

Expected: module not found.

**Step 3: Implement minimal payload modules**

Use the schemas from `pai-blender-worker`, but adapt:

- default `runnerTarget` is `gpu`
- payload field names stay snake_case externally
- hydrated internal object may use camelCase
- include `taskId`, `projectId`, and `projectRoot`

**Step 4: Run tests and compile**

```bash
npm test -- src/blender/payload.test.ts
npm run compile
```

Expected: pass.

**Step 5: Commit**

```bash
git add src/blender/types.ts src/blender/workflowCatalog.ts src/blender/payload.ts src/blender/payload.test.ts
git commit -m "feat: add blender workflow payload parsing"
```

## Task 5: Port Agent Script Generation Into `comfyui-worker`

**Files:**
- Create: `/Users/lumersgo/code/comfyui-worker/src/blender/agent.ts`
- Test: `/Users/lumersgo/code/comfyui-worker/src/blender/agent.test.ts`
- Modify: `/Users/lumersgo/code/comfyui-worker/package.json`
- Modify: `/Users/lumersgo/code/comfyui-worker/package-lock.json`
- Reference: `/Users/lumersgo/Code/pai-blender-worker/src/server/agent.ts`
- Reference: `/Users/lumersgo/Code/pai-blender-worker/agent.md`

**Step 1: Add dependency**

Add:

```json
"@openai/codex-sdk": "0.138.0"
```

Run:

```bash
npm install
```

**Step 2: Write tests with generator override**

Test that:

- `setBlenderScriptGeneratorForTests` can inject a fake generator.
- generated script must include `bpy`.
- prompt includes workflow, scene, shot, model, and PACE.

**Step 3: Implement agent module**

Port the Codex logic from `pai-blender-worker/src/server/agent.ts`, keeping:

- structured JSON output schema
- `CODEX_CLI_PATH`
- `OPENAI_API_KEY` or `CODEX_API_KEY`
- `OPENAI_CODEX_MODEL`
- `networkAccessEnabled: false`
- `sandboxMode: "workspace-write"`

**Step 4: Run tests and compile**

```bash
npm test -- src/blender/agent.test.ts
npm run compile
```

Expected: pass without invoking real Codex because tests use the override.

**Step 5: Commit**

```bash
git add package.json package-lock.json src/blender/agent.ts src/blender/agent.test.ts
git commit -m "feat: add blender script generation"
```

## Task 6: Create `pai-blender-api`

**Files:**
- Create: `/Users/lumersgo/code/pai-blender-api/package.json`
- Create: `/Users/lumersgo/code/pai-blender-api/tsconfig.json`
- Create: `/Users/lumersgo/code/pai-blender-api/vitest.config.ts`
- Create: `/Users/lumersgo/code/pai-blender-api/src/app.ts`
- Create: `/Users/lumersgo/code/pai-blender-api/src/index.ts`
- Create: `/Users/lumersgo/code/pai-blender-api/src/runs/runStore.ts`
- Create: `/Users/lumersgo/code/pai-blender-api/src/runs/blenderRunner.ts`
- Create: `/Users/lumersgo/code/pai-blender-api/src/runs/types.ts`
- Create: `/Users/lumersgo/code/pai-blender-api/src/runs/runService.ts`
- Create: `/Users/lumersgo/code/pai-blender-api/src/runs/runService.test.ts`
- Create: `/Users/lumersgo/code/pai-blender-api/.env.example`
- Create: `/Users/lumersgo/code/pai-blender-api/README.md`

**Step 1: Initialize git and package**

Run:

```bash
mkdir -p /Users/lumersgo/code/pai-blender-api
cd /Users/lumersgo/code/pai-blender-api
git init
npm init -y
npm install express cors multer zod nanoid dotenv
npm install -D typescript tsx vitest @types/node @types/express @types/cors @types/multer
```

**Step 2: Add scripts**

`package.json` scripts:

```json
{
  "dev": "tsx watch src/index.ts",
  "compile": "tsc",
  "start": "node dist/index.js",
  "test": "vitest run"
}
```

**Step 3: Write failing service tests**

Use a fake runner override to avoid launching Blender. Test:

- `POST /runs` returns `run_id`.
- `GET /runs/:run_id` returns terminal status after fake runner completes.
- `GET /runs/:run_id/logs` returns captured logs.
- `GET /runs/:run_id/artifacts/:artifact_id` returns artifact bytes.

**Step 4: Implement run service**

Minimum request body:

```json
{
  "task_id": "task_123",
  "workflow": "blender-create-3d",
  "project_id": "project_abc",
  "scene_id": "s001",
  "shot_id": "sh001",
  "model_id": "model_abc",
  "pace": {},
  "script": "import bpy\n...",
  "reference_image": {
    "filename": "source.png",
    "content_type": "image/png",
    "base64": "..."
  }
}
```

Minimum response:

```json
{
  "run_id": "run_abc",
  "status": "queued",
  "status_url": "/runs/run_abc"
}
```

**Step 5: Implement Blender runner**

Use `BLENDER_BIN` and run:

```bash
$BLENDER_BIN -b --python run_blender.py
```

The wrapper should:

- write `generated_scene.py`
- write `pace.json`
- execute generated script in Blender
- ensure a camera/light/mesh exist if possible
- save `.blend`
- export OBJ
- render `preview.png`
- write `summary.json`
- capture stdout/stderr

**Step 6: Run tests and compile**

```bash
npm test
npm run compile
```

Expected: pass.

**Step 7: Commit**

```bash
git add .
git commit -m "feat: create blender runner api"
```

## Task 7: Add Blender API Client To `comfyui-worker`

**Files:**
- Create: `/Users/lumersgo/code/comfyui-worker/src/blender/blenderApiClient.ts`
- Test: `/Users/lumersgo/code/comfyui-worker/src/blender/blenderApiClient.test.ts`
- Modify: `/Users/lumersgo/code/comfyui-worker/src/infra/constants.ts`
- Modify: `/Users/lumersgo/code/comfyui-worker/.env.example`

**Step 1: Write client tests**

Mock `fetch` and test:

- `submitBlenderRun` posts to `${BLENDER_API_BASE_URL}/runs`.
- `pollBlenderRunUntilTerminal` stops on `succeeded`, `failed`, or `rejected`.
- artifact download returns Buffer plus content type.
- bearer token is sent when `BLENDER_API_TOKEN` exists.

**Step 2: Add env constants**

Add:

- `BLENDER_API_BASE_URL`
- `BLENDER_API_TOKEN`
- `BLENDER_API_POLL_INTERVAL_SECONDS`
- `BLENDER_API_TIMEOUT_SECONDS`

**Step 3: Implement client**

Do not import app/router code from `pai-blender-api`; keep this as HTTP-only.

**Step 4: Run tests and compile**

```bash
npm test -- src/blender/blenderApiClient.test.ts
npm run compile
```

Expected: pass.

**Step 5: Commit**

```bash
git add src/blender/blenderApiClient.ts src/blender/blenderApiClient.test.ts src/infra/constants.ts .env.example
git commit -m "feat: add blender api client"
```

## Task 8: Extend Asset Store For Blender Artifacts

**Files:**
- Modify: `/Users/lumersgo/code/comfyui-worker/src/render/assetStore.ts`
- Test: `/Users/lumersgo/code/comfyui-worker/src/render/assetStore.test.ts`

**Step 1: Write tests**

Test extension/content type detection for:

- `.blend` -> `application/x-blender`
- `.obj` -> `model/obj`
- `.png` -> `image/png`
- `.json` -> `application/json`
- `.py` -> `text/x-python`

**Step 2: Refactor public upload helper**

Expose a generic helper:

```ts
export async function uploadWorkerAsset(projectId: string, group: string, input: {
  buffer: Buffer;
  contentType?: string;
  filenameHint?: string;
}): Promise<UploadedAsset>
```

Keep `uploadRenderAsset` and `uploadSourceImageAsset` as wrappers.

**Step 3: Run tests and compile**

```bash
npm test -- src/render/assetStore.test.ts
npm run compile
```

Expected: pass.

**Step 4: Commit**

```bash
git add src/render/assetStore.ts src/render/assetStore.test.ts
git commit -m "feat: support generic worker asset uploads"
```

## Task 9: Implement Blender Consumer In `comfyui-worker`

**Files:**
- Create: `/Users/lumersgo/code/comfyui-worker/src/tasks/blenderTaskExecution.ts`
- Modify: `/Users/lumersgo/code/comfyui-worker/src/tasks/taskExecution.ts`
- Modify: `/Users/lumersgo/code/comfyui-worker/src/tasks/types.ts`
- Test: `/Users/lumersgo/code/comfyui-worker/src/tasks/blenderTaskExecution.test.ts`

**Step 1: Write failing consumer tests**

Use fake implementations for:

- asset download
- agent script generation
- Blender API client
- asset upload
- task store

Test success path:

- task moves to `running`
- event `started` is appended
- agent script is generated
- Blender API run is submitted and polled
- artifacts are uploaded
- task becomes `succeeded`
- result payload contains `assets://blender/...`

Test failure path:

- Blender API terminal failure marks task `failed`
- attempt is saved
- error message is visible in result payload.

**Step 2: Run test to verify failure**

```bash
npm test -- src/tasks/blenderTaskExecution.test.ts
```

Expected: module not found.

**Step 3: Implement consumer**

Add:

```ts
export const BLENDER_CONSUMER_KEY = 'blender_consumer';
export async function handleBlenderExecute(envelope, context): Promise<void> {
  // load task
  // hydrate payload by workflow
  // generate script
  // call pai-blender-api
  // upload artifacts
  // save result and events
}
```

Register in `CONSUMER_HANDLERS`:

```ts
const CONSUMER_HANDLERS = {
  [RENDER_PANEL_CONSUMER_KEY]: handleRenderPanelExecute,
  [BLENDER_CONSUMER_KEY]: handleBlenderExecute,
};
```

Default `task_type=blender` should map to `blender_consumer`.

**Step 4: Run tests and compile**

```bash
npm test -- src/tasks/blenderTaskExecution.test.ts
npm run compile
```

Expected: pass.

**Step 5: Commit**

```bash
git add src/tasks/blenderTaskExecution.ts src/tasks/taskExecution.ts src/tasks/types.ts src/tasks/blenderTaskExecution.test.ts
git commit -m "feat: execute blender workflow tasks"
```

## Task 10: Seed Blender Task Definition

**Files:**
- Modify: `/Users/lumersgo/code/comfyui-worker/src/taskDefinitions/taskTypeDefinitionStore.ts`
- Test: `/Users/lumersgo/code/comfyui-worker/src/taskDefinitions/taskTypeDefinitionStore.test.ts`
- Modify: `/Users/lumersgo/code/comfyui-worker/README.md`

**Step 1: Write tests**

Test that `ensureReady()` creates an enabled `task_type=blender` definition when missing.

**Step 2: Define default payload fields**

Use:

```json
{
  "consumer_key": "blender_consumer",
  "payload": {
    "allow_unknown_fields": false,
    "fields": {
      "workflow": { "type": "string", "required": true },
      "scene_id": { "type": "string", "required": true },
      "shot_id": { "type": "string", "required": true },
      "model_id": { "type": "string", "required": false },
      "prompt": { "type": "string", "required": false },
      "pace": { "type": "object", "required": false },
      "inputs.image.assetUri": { "type": "string", "required": false },
      "agent": { "type": "string", "required": false, "default": "codex" },
      "runner_target": { "type": "string", "required": false, "default": "gpu" }
    }
  }
}
```

Workflow-specific required fields remain enforced in `src/blender/payload.ts`.

**Step 3: Run tests and compile**

```bash
npm test -- src/taskDefinitions/taskTypeDefinitionStore.test.ts
npm run compile
```

Expected: pass.

**Step 4: Commit**

```bash
git add src/taskDefinitions/taskTypeDefinitionStore.ts src/taskDefinitions/taskTypeDefinitionStore.test.ts README.md
git commit -m "feat: seed blender task definition"
```

## Task 11: Update `pai-blender-worker` Test Console

**Files:**
- Modify: `/Users/lumersgo/Code/pai-blender-worker/src/lib/client-api.ts`
- Modify: `/Users/lumersgo/Code/pai-blender-worker/src/lib/worker-types.ts`
- Modify: `/Users/lumersgo/Code/pai-blender-worker/src/components/DashboardView.tsx`
- Modify: `/Users/lumersgo/Code/pai-blender-worker/src/components/WorkflowsView.tsx`
- Modify: `/Users/lumersgo/Code/pai-blender-worker/src/components/LogsView.tsx`
- Modify: `/Users/lumersgo/Code/pai-blender-worker/.env.example`
- Test: `/Users/lumersgo/Code/pai-blender-worker/tests/ui/dashboard-view.test.tsx`
- Test: `/Users/lumersgo/Code/pai-blender-worker/tests/ui/logs-view.test.tsx`

**Step 1: Write/update tests**

Test UI behavior:

- Dashboard shows `comfyui-worker` health.
- Dashboard shows `pai-blender-api` health.
- Workflow form submits to `comfyui-worker /tasks`.
- Logs page can show worker events and runner logs.

**Step 2: Add env vars**

Add:

```text
COMFYUI_WORKER_BASE_URL=http://localhost:8091
BLENDER_API_BASE_URL=http://localhost:8092
```

**Step 3: Update client API**

Add fetch helpers:

- `getComfyWorkerHealth`
- `getComfyWorkerTask`
- `submitComfyWorkerTask`
- `getBlenderApiHealth`
- `getBlenderRun`
- `getBlenderRunLogs`

**Step 4: Update UI copy and forms**

The default workflow test path submits to `comfyui-worker`.
Do not call `pai-blender-api /runs` directly by default.

**Step 5: Run tests**

```bash
cd /Users/lumersgo/Code/pai-blender-worker
pnpm typecheck
pnpm test
```

Expected: pass.

**Step 6: Commit if repository exists**

This folder is currently not a git repository. If it becomes one before execution, commit:

```bash
git add src .env.example tests
git commit -m "feat: observe blender workflow chain"
```

## Task 12: Local End-To-End Run

**Files:**
- Modify: `/Users/lumersgo/code/comfyui-worker/README.md`
- Modify: `/Users/lumersgo/code/pai-blender-api/README.md`
- Modify: `/Users/lumersgo/Code/pai-blender-worker/README.md`

**Step 1: Start dependencies**

Run PostgreSQL and Redis using local preferred setup.

Expected:

```bash
redis-cli ping
# PONG
```

**Step 2: Start `pai-blender-api`**

Run:

```bash
cd /Users/lumersgo/code/pai-blender-api
cp .env.example .env.local
npm run dev
```

Expected: `GET http://localhost:8092/health` returns ok.

**Step 3: Start `comfyui-worker` server**

Run:

```bash
cd /Users/lumersgo/code/comfyui-worker
cp .env.example .env.local
npm run server
```

Expected: `GET http://localhost:8091/health` returns ok.

**Step 4: Start `comfyui-worker` queue worker**

Run in another terminal:

```bash
cd /Users/lumersgo/code/comfyui-worker
npm run queue:worker
```

Expected: queue worker logs active queue.

**Step 5: Start test console**

Run:

```bash
cd /Users/lumersgo/Code/pai-blender-worker
pnpm dev
```

Expected: dashboard loads.

**Step 6: Submit `blender-create-3d` from UI**

Expected:

- task starts as queued
- task becomes running
- runner run id appears
- preview appears
- artifacts appear
- task becomes done

**Step 7: Commit docs updates**

Commit in each git repository that has changes. Do not commit generated outputs.

## Task 13: Verification Before Online Deployment

**Files:**
- Verify: `/Users/lumersgo/code/comfyui-worker`
- Verify: `/Users/lumersgo/code/pai-blender-api`
- Verify: `/Users/lumersgo/Code/pai-blender-worker`

**Step 1: Run all local checks**

```bash
cd /Users/lumersgo/code/comfyui-worker
npm test
npm run compile

cd /Users/lumersgo/code/pai-blender-api
npm test
npm run compile

cd /Users/lumersgo/Code/pai-blender-worker
pnpm typecheck
pnpm test
pnpm build
```

Expected: all pass.

**Step 2: Record remaining deployment config**

Document:

- GPU host URL
- `BLENDER_BIN` on GPU host
- auth/token choice for `pai-blender-api`
- object storage bucket/prefix
- queue timeout/backoff values for Blender jobs

**Step 3: Stop before deployment**

Do not deploy until local chain is stable and user approves moving online.
