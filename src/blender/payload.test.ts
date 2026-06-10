import { expect, test } from 'vitest';

import { ValidationError } from '../infra/HttpError.js';
import { hydrateBlenderTaskPayload } from './payload.js';

const CONTEXT = {
  taskId: 'task_123',
  projectId: 'project_456',
  projectRoot: '/data/pai-projects/demo-project',
};

test('hydrateBlenderTaskPayload normalizes create payload with defaults and source image asset uri', () => {
  const normalized = hydrateBlenderTaskPayload(
    {
      workflow: 'blender-create-3d',
      scene_id: 'scene_001',
      shot_id: 'shot_010',
      pace: {
        schema_version: 'pace-1',
        scene: {
          scene_id: 'wrong-scene',
          shot_id: 'wrong-shot',
          mood: 'golden-hour',
        },
      },
      inputs: {
        image: {
          assetUri: 'assets://source-images/source.png',
        },
      },
    },
    CONTEXT,
  );

  expect(normalized).toMatchObject({
    taskId: 'task_123',
    projectId: 'project_456',
    projectRoot: '/data/pai-projects/demo-project',
    workflow: {
      id: 'blender-create-3d',
    },
    sceneId: 'scene_001',
    shotId: 'shot_010',
    agent: 'codex',
    runnerTarget: 'gpu',
    modelId: null,
    prompt: null,
    inputs: {
      sourceImageAssetUri: 'assets://source-images/source.png',
    },
  });
  expect(normalized.pace.scene).toMatchObject({
    scene_id: 'scene_001',
    shot_id: 'shot_010',
    mood: 'golden-hour',
  });
  expect(normalized.pace.event).toMatchObject({
    type: 'create-3d',
    trigger_frame: 1,
  });
});

test('hydrateBlenderTaskPayload requires create payload fields', () => {
  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-create-3d',
        scene_id: 'scene_001',
        shot_id: 'shot_010',
        pace: {
          schema_version: 'pace-1',
          scene: {},
        },
      },
      CONTEXT,
    ),
  ).toThrow('payload.inputs.image.assetUri is required');

  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-create-3d',
        shot_id: 'shot_010',
        pace: {
          schema_version: 'pace-1',
          scene: {},
        },
        inputs: {
          image: {
            assetUri: 'assets://source-images/source.png',
          },
        },
      },
      CONTEXT,
    ),
  ).toThrow('payload.scene_id is required');

  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-create-3d',
        scene_id: 'scene_001',
        inputs: {
          image: {
            assetUri: 'assets://source-images/source.png',
          },
        },
      },
      CONTEXT,
    ),
  ).toThrow('payload.shot_id is required');

  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-create-3d',
        scene_id: 'scene_001',
        shot_id: 'shot_010',
        inputs: {
          image: {
            assetUri: 'assets://source-images/source.png',
          },
        },
      },
      CONTEXT,
    ),
  ).toThrow('payload.pace is required');
});

test('hydrateBlenderTaskPayload normalizes update payload with fallback pace defaults', () => {
  const normalized = hydrateBlenderTaskPayload(
    {
      workflow: 'blender-update-3d',
      scene_id: 'scene_002',
      shot_id: 'shot_020',
      model_id: 'model_abc',
      prompt: 'Add a glass canopy and sharper rim light.',
    },
    CONTEXT,
  );

  expect(normalized).toMatchObject({
    workflow: {
      id: 'blender-update-3d',
    },
    sceneId: 'scene_002',
    shotId: 'shot_020',
    modelId: 'model_abc',
    prompt: 'Add a glass canopy and sharper rim light.',
    agent: 'codex',
    runnerTarget: 'gpu',
    inputs: {
      sourceImageAssetUri: null,
    },
  });
  expect(normalized.pace.schema_version).toBeTruthy();
  expect(normalized.pace.scene).toMatchObject({
    scene_id: 'scene_002',
    shot_id: 'shot_020',
  });
  expect(normalized.pace.event).toMatchObject({
    type: 'update-3d',
    trigger_frame: 1,
  });
});

test('hydrateBlenderTaskPayload requires update payload fields', () => {
  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-update-3d',
        scene_id: 'scene_002',
        shot_id: 'shot_020',
        prompt: 'Refine the environment.',
      },
      CONTEXT,
    ),
  ).toThrow('payload.model_id is required');

  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-update-3d',
        scene_id: 'scene_002',
        shot_id: 'shot_020',
        model_id: 'model_abc',
      },
      CONTEXT,
    ),
  ).toThrow('payload.prompt is required');

  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-update-3d',
        shot_id: 'shot_020',
        model_id: 'model_abc',
        prompt: 'Refine the environment.',
      },
      CONTEXT,
    ),
  ).toThrow('payload.scene_id is required');

  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-update-3d',
        scene_id: 'scene_002',
        model_id: 'model_abc',
        prompt: 'Refine the environment.',
      },
      CONTEXT,
    ),
  ).toThrow('payload.shot_id is required');
});

test('hydrateBlenderTaskPayload forces scene identifiers inside pace for update payloads', () => {
  const normalized = hydrateBlenderTaskPayload(
    {
      workflow: 'blender-update-3d',
      scene_id: 'scene_override',
      shot_id: 'shot_override',
      model_id: 'model_abc',
      prompt: 'Swap the wall material to brushed metal.',
      agent: 'claude',
      runner_target: 'local',
      pace: {
        schema_version: 'pace-2',
        scene: {
          scene_id: 'wrong-scene',
          shot_id: 'wrong-shot',
          variation: 'night',
        },
      },
    },
    CONTEXT,
  );

  expect(normalized.agent).toBe('claude');
  expect(normalized.runnerTarget).toBe('local');
  expect(normalized.pace.scene).toMatchObject({
    scene_id: 'scene_override',
    shot_id: 'shot_override',
    variation: 'night',
  });
});

test('hydrateBlenderTaskPayload deep-merges known pace sections for partial overrides', () => {
  const normalized = hydrateBlenderTaskPayload(
    {
      workflow: 'blender-create-3d',
      scene_id: 'scene_001',
      shot_id: 'shot_010',
      pace: {
        schema_version: 'pace-1',
        camera: {
          focal_length_mm: 50,
        },
      },
      inputs: {
        image: {
          assetUri: 'assets://source-images/source.png',
        },
      },
    },
    CONTEXT,
  );

  expect(normalized.pace.camera).toMatchObject({
    focal_length_mm: 50,
    look_at: [0, 0, 0.8],
    position: [4, -4, 2.6],
  });
});

test('hydrateBlenderTaskPayload requires source image asset URIs to use assets scheme', () => {
  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-create-3d',
        scene_id: 'scene_001',
        shot_id: 'shot_010',
        pace: {
          schema_version: 'pace-1',
          scene: {},
        },
        inputs: {
          image: {
            assetUri: 's3://bucket/source.png',
          },
        },
      },
      CONTEXT,
    ),
  ).toThrow('payload.inputs.image.assetUri must start with assets://');

  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-create-3d',
        scene_id: 'scene_001',
        shot_id: 'shot_010',
        pace: {
          schema_version: 'pace-1',
          scene: {},
        },
        image: 'https://example.com/source.png',
      },
      CONTEXT,
    ),
  ).toThrow('payload.image must start with assets://');
});

test('hydrateBlenderTaskPayload rejects lossy or non-plain objects inside pace', () => {
  class PaceWrapper {
    scene = { variation: 'night' };
  }

  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-create-3d',
        scene_id: 'scene_001',
        shot_id: 'shot_010',
        pace: {
          schema_version: 'pace-1',
          scene: {
            started_at: new Date(),
          },
        },
        inputs: {
          image: {
            assetUri: 'assets://source-images/source.png',
          },
        },
      },
      CONTEXT,
    ),
  ).toThrow('payload.pace.scene.started_at must be JSON-compatible');

  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-create-3d',
        scene_id: 'scene_001',
        shot_id: 'shot_010',
        pace: {
          schema_version: 'pace-1',
          event: new Map([['type', 'create-3d']]),
        },
        inputs: {
          image: {
            assetUri: 'assets://source-images/source.png',
          },
        },
      },
      CONTEXT,
    ),
  ).toThrow('payload.pace.event must be JSON-compatible');

  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-create-3d',
        scene_id: 'scene_001',
        shot_id: 'shot_010',
        pace: new PaceWrapper() as unknown as Record<string, unknown>,
        inputs: {
          image: {
            assetUri: 'assets://source-images/source.png',
          },
        },
      },
      CONTEXT,
    ),
  ).toThrow('payload.pace must be JSON-compatible');

  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-create-3d',
        scene_id: 'scene_001',
        shot_id: 'shot_010',
        pace: {
          schema_version: 'pace-1',
          camera: {
            exposure: Number.NaN,
          },
        },
        inputs: {
          image: {
            assetUri: 'assets://source-images/source.png',
          },
        },
      },
      CONTEXT,
    ),
  ).toThrow('payload.pace.camera.exposure must be JSON-compatible');

  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-create-3d',
        scene_id: 'scene_001',
        shot_id: 'shot_010',
        pace: {
          schema_version: 'pace-1',
          style: {
            on_complete: () => 'done',
          },
        },
        inputs: {
          image: {
            assetUri: 'assets://source-images/source.png',
          },
        },
      },
      CONTEXT,
    ),
  ).toThrow('payload.pace.style.on_complete must be JSON-compatible');

  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-create-3d',
        scene_id: 'scene_001',
        shot_id: 'shot_010',
        pace: {
          schema_version: 'pace-1',
          style: {
            token: Symbol('pace'),
          },
        },
        inputs: {
          image: {
            assetUri: 'assets://source-images/source.png',
          },
        },
      },
      CONTEXT,
    ),
  ).toThrow('payload.pace.style.token must be JSON-compatible');

  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-create-3d',
        scene_id: 'scene_001',
        shot_id: 'shot_010',
        pace: {
          schema_version: 'pace-1',
          style: {
            asset_id: undefined,
          },
        },
        inputs: {
          image: {
            assetUri: 'assets://source-images/source.png',
          },
        },
      },
      CONTEXT,
    ),
  ).toThrow('payload.pace.style.asset_id must be JSON-compatible');
});

test('hydrateBlenderTaskPayload rejects unsupported workflows', () => {
  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-delete-3d',
        scene_id: 'scene_001',
        shot_id: 'shot_010',
      },
      CONTEXT,
    ),
  ).toThrowError(ValidationError);
  expect(() =>
    hydrateBlenderTaskPayload(
      {
        workflow: 'blender-delete-3d',
        scene_id: 'scene_001',
        shot_id: 'shot_010',
      },
      CONTEXT,
    ),
  ).toThrow('payload.workflow is unsupported');
});
