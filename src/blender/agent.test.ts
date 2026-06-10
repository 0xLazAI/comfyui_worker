import { expect, test } from 'vitest';

import type { HydratedBlenderTaskPayload } from './types.js';
import {
  buildBlenderScriptPrompt,
  generateBlenderScript,
  parseGeneratedBlenderScriptResponse,
  setBlenderScriptGeneratorForTests,
} from './agent.js';

const BASE_PAYLOAD: HydratedBlenderTaskPayload = {
  workflow: {
    id: 'blender-create-3d',
    summary: 'Create a previs 3D scene from a source image.',
    requiredFields: ['scene_id', 'shot_id', 'pace'],
    requiresSourceImage: true,
    artifactKinds: ['blend', 'obj', 'preview'],
  },
  sceneId: 'scene_001',
  shotId: 'shot_010',
  modelId: null,
  prompt: null,
  pace: {
    schema_version: 'pace-1',
    scene: {
      scene_id: 'scene_001',
      shot_id: 'shot_010',
      mood: 'stormfront',
    },
    event: {
      type: 'create-3d',
      trigger_frame: 16,
    },
  },
  agent: 'codex',
  runnerTarget: 'gpu',
  inputs: {
    sourceImageAssetUri: 'assets://images/source.png',
  },
  taskId: 'task_123',
  projectId: 'project_456',
  projectRoot: '/data/pai-projects/demo-project',
};

test('generateBlenderScript uses test override when installed', async () => {
  const calls: Array<{
    payload: HydratedBlenderTaskPayload;
    context: { workingDirectory: string; sourceImagePath?: string | null };
  }> = [];

  setBlenderScriptGeneratorForTests(async (payload, context) => {
    calls.push({ payload, context });
    return {
      notes: ['override'],
      provider: 'codex',
      script: 'import bpy\nprint("override")\n',
      summary: 'override summary',
      threadId: 'thread_test',
    };
  });

  try {
    const result = await generateBlenderScript(BASE_PAYLOAD, {
      sourceImagePath: '/tmp/source.png',
      workingDirectory: '/tmp/blender-job',
    });

    expect(result).toMatchObject({
      notes: ['override'],
      provider: 'codex',
      summary: 'override summary',
      threadId: 'thread_test',
    });
    expect(calls).toEqual([
      {
        payload: BASE_PAYLOAD,
        context: {
          sourceImagePath: '/tmp/source.png',
          workingDirectory: '/tmp/blender-job',
        },
      },
    ]);
  } finally {
    setBlenderScriptGeneratorForTests(undefined);
  }
});

test('parseGeneratedBlenderScriptResponse rejects scripts that do not use bpy', () => {
  expect(() =>
    parseGeneratedBlenderScriptResponse(
      JSON.stringify({
        notes: ['missing bpy'],
        script: 'print("hello")\n',
        summary: 'not a blender script',
      }),
    ),
  ).toThrow('Codex returned a script that does not import or use bpy.');
});

test('buildBlenderScriptPrompt includes workflow context, identifiers, update prompt, and guardrails', () => {
  const prompt = buildBlenderScriptPrompt(
    {
      ...BASE_PAYLOAD,
      workflow: {
        ...BASE_PAYLOAD.workflow,
        id: 'blender-update-3d',
        requiresSourceImage: false,
      },
      modelId: 'model_abc',
      prompt: 'Add a glass canopy and sharper rim light.',
      pace: {
        ...BASE_PAYLOAD.pace,
        event: {
          type: 'update-3d',
          trigger_frame: 24,
        },
      },
    },
    {
      sourceImagePath: '/tmp/shot-010.png',
      workingDirectory: '/tmp/blender-job',
    },
  );

  expect(prompt).toContain('Workflow: blender-update-3d');
  expect(prompt).toContain('Scene id: scene_001');
  expect(prompt).toContain('Shot id: shot_010');
  expect(prompt).toContain('Model id: model_abc');
  expect(prompt).toContain('Task id: task_123');
  expect(prompt).toContain('Agent provider: codex');
  expect(prompt).toContain('Runner target: gpu');
  expect(prompt).toContain('Reference image path: /tmp/shot-010.png');
  expect(prompt).toContain('Update prompt: Add a glass canopy and sharper rim light.');
  expect(prompt).toContain('"schema_version": "pace-1"');
  expect(prompt).toContain('Always create at least one mesh named with MODEL_ID.');
  expect(prompt).toContain('Do not save files; the worker wrapper saves .blend, OBJ, preview PNG, PACE, and summary.');
});
