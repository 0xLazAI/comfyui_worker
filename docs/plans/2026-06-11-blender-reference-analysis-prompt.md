# Blender Reference Analysis Prompt Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `blender-create-3d` analyze the reference image first, then generate Blender Python from `agent.md`, the analysis brief, the user prompt, and PACE.

**Architecture:** Keep the workflow inside the existing Codex agent adapter. For create jobs with a staged source image, run one structured Codex turn to extract a concise scene brief, then run the existing script-generation turn with that brief embedded in the final prompt. Persist the loaded `agent.md` path and reference analysis in task events for debugging.

**Tech Stack:** TypeScript, `@openai/codex-sdk`, Vitest, local `pai-blender-api` runner.

---

### Task 1: Reference Analysis Tests

**Files:**
- Modify: `src/blender/agent.test.ts`

**Steps:**
1. Add a test showing the Codex branch runs two turns when a source image exists.
2. The first turn must use a reference-analysis schema and include the image.
3. The second turn must include the generated scene brief, user prompt, `agent.md` style, and PACE.
4. Run `npm test -- src/blender/agent.test.ts` and confirm the new test fails before implementation.

### Task 2: Agent Implementation

**Files:**
- Modify: `src/blender/agent.ts`

**Steps:**
1. Add a `ReferenceImageAnalysis` shape and output schema.
2. Add parsing/validation for the analysis response.
3. Add a reference-analysis prompt builder that includes `agent.md`, user prompt, identifiers, image path, and PACE.
4. In `generateWithCodex`, run analysis first for `blender-create-3d` tasks with a source image.
5. Inject the analysis into the final Blender script prompt.

### Task 3: Task Event Metadata

**Files:**
- Modify: `src/tasks/blenderTaskExecution.ts`
- Modify: `src/tasks/blenderTaskExecution.test.ts`

**Steps:**
1. Include `referenceAnalysis` in the `agent_generated` event detail.
2. Keep `agentInstructionsPath` in the same event.
3. Run task execution tests.

### Task 4: Verification And Local Workflow

**Commands:**
- `npm run compile`
- `npm test -- src/blender/payload.test.ts src/blender/agent.test.ts src/tasks/blenderTaskExecution.test.ts`

**Local run:**
1. Submit a new `blender-create-3d` task against local worker/API using the hockey reference image.
2. Wait for completion.
3. Inspect `generated_scene.py`, task events, and `preview.png`.
4. Compare against the previous run for camera/readability/label placement.
