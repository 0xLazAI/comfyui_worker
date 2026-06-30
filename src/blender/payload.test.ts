import { expect, test } from 'vitest';

import { ValidationError } from '../infra/HttpError.js';
import { hydrateBlenderTaskPayload } from './payload.js';

const CONTEXT = {
  taskId: 'task_123',
  projectId: 'project_456',
  projectRoot: '/data/pai-projects/demo-project',
};

test('hydrateBlenderTaskPayload builds a review batch from a single shot, deriving sceneId', () => {
  const normalized = hydrateBlenderTaskPayload(
    {
      workflow: 'blender-pace-review',
      shots: ['hs001_sh001'],
    },
    CONTEXT,
  );

  expect(normalized.workflow.id).toBe('blender-pace-review');
  expect(normalized.reviewBatch).toEqual([{ shotId: 'hs001_sh001', sceneId: 's001' }]);
  expect(normalized.sceneId).toBe('s001');
  // PACE + base GLB are resolved from the platform at execution time, not the payload.
  expect(normalized.paceDocument).toBeNull();
  expect(normalized.inputs.baseGlbAssetUri).toBeNull();
});

test('hydrateBlenderTaskPayload selects the workflow from task_type (snake_case) too', () => {
  const normalized = hydrateBlenderTaskPayload(
    { shots: ['hs001_sh001'] },
    { ...CONTEXT, taskType: 'blender_pace_review' },
  );
  expect(normalized.workflow.id).toBe('blender-pace-review');
});

test('hydrateBlenderTaskPayload defaults agent to codex and runner_target to gpu', () => {
  const normalized = hydrateBlenderTaskPayload(
    { workflow: 'blender-pace-review', shots: ['hs001_sh001'] },
    CONTEXT,
  );
  expect(normalized.agent).toBe('codex');
  expect(normalized.runnerTarget).toBe('gpu');
});

test('hydrateBlenderTaskPayload rejects the unimplemented claude agent at validation', () => {
  expect(() =>
    hydrateBlenderTaskPayload(
      { workflow: 'blender-pace-review', shots: ['hs001_sh001'], agent: 'claude' },
      CONTEXT,
    ),
  ).toThrow('payload.agent must be one of: codex');
});

test('hydrateBlenderTaskPayload rejects the removed local runner target', () => {
  expect(() =>
    hydrateBlenderTaskPayload(
      { workflow: 'blender-pace-review', shots: ['hs001_sh001'], runner_target: 'local' },
      CONTEXT,
    ),
  ).toThrow('payload.runner_target must be one of: gpu');
});

test('hydrateBlenderTaskPayload requires a non-empty shots array for blender-pace-review', () => {
  expect(() =>
    hydrateBlenderTaskPayload({ workflow: 'blender-pace-review', shots: [] }, CONTEXT),
  ).toThrow(/non-empty/);
});

test('hydrateBlenderTaskPayload caps blender-pace-review at one shot per task for now', () => {
  expect(() =>
    hydrateBlenderTaskPayload(
      { workflow: 'blender-pace-review', shots: ['hs001_sh001', 'hs002_sh003'] },
      CONTEXT,
    ),
  ).toThrow(/at most 1 shot/);
});

test('hydrateBlenderTaskPayload rejects malformed shot ids for blender-pace-review', () => {
  expect(() =>
    hydrateBlenderTaskPayload({ workflow: 'blender-pace-review', shots: ['not-a-shot'] }, CONTEXT),
  ).toThrow(/valid shot id/);
});

test('hydrateBlenderTaskPayload rejects unsupported workflows', () => {
  expect(() =>
    hydrateBlenderTaskPayload({ workflow: 'blender-delete-3d', shots: ['hs001_sh001'] }, CONTEXT),
  ).toThrow('payload.workflow is unsupported');
});
