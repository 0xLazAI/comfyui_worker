import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';

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

afterEach(async () => {
  setBlenderScriptGeneratorForTests(undefined);
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('@openai/codex-sdk');
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_API_KEY;
  delete process.env.CODEX_CLI_PATH;
  delete process.env.OPENAI_CODEX_MODEL;
});

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
  ).toThrow('Codex returned a script that must use `import bpy` and direct `bpy.` access.');
});

test('parseGeneratedBlenderScriptResponse rejects bpy false positives from strings and comments', () => {
  expect(() =>
    parseGeneratedBlenderScriptResponse(
      JSON.stringify({
        notes: ['string false positive'],
        script: 'import bpy\nprint("bpy")\n',
        summary: 'string false positive',
      }),
    ),
  ).toThrow('Codex returned a script that must use `import bpy` and direct `bpy.` access.');

  expect(() =>
    parseGeneratedBlenderScriptResponse(
      JSON.stringify({
        notes: ['comment false positive'],
        script: 'import bpy\n# bpy.ops.object.select_all()\n',
        summary: 'comment false positive',
      }),
    ),
  ).toThrow('Codex returned a script that must use `import bpy` and direct `bpy.` access.');
});

test('parseGeneratedBlenderScriptResponse rejects bpy alias imports to keep validation style strict', () => {
  expect(() =>
    parseGeneratedBlenderScriptResponse(
      JSON.stringify({
        notes: ['alias import'],
        script: 'import bpy as bp\nbp.ops.object.select_all()\n',
        summary: 'alias import',
      }),
    ),
  ).toThrow('Codex returned a script that must use `import bpy` and direct `bpy.` access.');

  expect(() =>
    parseGeneratedBlenderScriptResponse(
      JSON.stringify({
        notes: ['from import'],
        script: 'from bpy import ops\nops.object.select_all()\n',
        summary: 'from import',
      }),
    ),
  ).toThrow('Codex returned a script that must use `import bpy` and direct `bpy.` access.');
});

test('parseGeneratedBlenderScriptResponse accepts a real Blender script shape', () => {
  expect(
    parseGeneratedBlenderScriptResponse(
      JSON.stringify({
        notes: ['valid'],
        script: 'import bpy\nbpy.ops.object.select_all()\n',
        summary: 'valid blender script',
      }),
    ),
  ).toMatchObject({
    notes: ['valid'],
    script: 'import bpy\nbpy.ops.object.select_all()\n',
    summary: 'valid blender script',
  });
});

test('generateBlenderScript codex branch uses strict sandbox options and structured output schema', async () => {
  const threadRun = vi.fn().mockResolvedValue({
    finalResponse: JSON.stringify({
      notes: ['generated'],
      script: 'import bpy\nbpy.ops.object.select_all()\n',
      summary: 'generated blender script',
    }),
  });
  const startThread = vi.fn().mockReturnValue({
    id: 'thread_live',
    run: threadRun,
  });
  const codexConstructor = vi.fn();
  function CodexMock(options: unknown) {
    codexConstructor(options);
    return {
      startThread,
    };
  }

  vi.resetModules();
  vi.doMock('@openai/codex-sdk', () => ({
    Codex: CodexMock,
  }));

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-agent-test-'));
  const fakeCodexCliPath = path.join(tempRoot, 'codex');
  await writeFile(fakeCodexCliPath, '#!/bin/sh\n');

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.CODEX_CLI_PATH = fakeCodexCliPath;
  process.env.OPENAI_CODEX_MODEL = 'gpt-test-codex';

  try {
    const { generateBlenderScript: generateBlenderScriptWithMock } = await import('./agent.js');
    const result = await generateBlenderScriptWithMock(BASE_PAYLOAD, {
      sourceImagePath: '/tmp/source.png',
      workingDirectory: '/tmp/blender-job',
    });

    expect(result).toMatchObject({
      notes: ['generated'],
      provider: 'codex',
      summary: 'generated blender script',
      threadId: 'thread_live',
    });
    expect(codexConstructor).toHaveBeenCalledWith({
      apiKey: 'test-openai-key',
      codexPathOverride: fakeCodexCliPath,
    });
    expect(startThread).toHaveBeenCalledWith({
      approvalPolicy: 'never',
      model: 'gpt-test-codex',
      modelReasoningEffort: 'low',
      networkAccessEnabled: false,
      sandboxMode: 'workspace-write',
      skipGitRepoCheck: true,
      webSearchMode: 'disabled',
      workingDirectory: '/tmp/blender-job',
    });
    expect(threadRun).toHaveBeenCalledTimes(1);

    const [input, turnOptions] = threadRun.mock.calls[0] as [
      Array<{ path?: string; text?: string; type: string }>,
      { outputSchema: unknown },
    ];
    expect(input).toEqual([
      {
        text: expect.stringContaining('Workflow: blender-create-3d'),
        type: 'text',
      },
      {
        path: '/tmp/source.png',
        type: 'local_image',
      },
    ]);
    expect((input[0] as { text: string }).text).toContain('Task id: task_123');
    expect(turnOptions).toEqual({
      outputSchema: {
        additionalProperties: false,
        properties: {
          notes: {
            items: { type: 'string' },
            type: 'array',
          },
          script: {
            description: 'Complete executable Blender Python script.',
            type: 'string',
          },
          summary: {
            description: 'Short human-readable summary of the script.',
            type: 'string',
          },
        },
        required: ['script', 'summary', 'notes'],
        type: 'object',
      },
    });
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
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
  expect(prompt).toContain('Use exactly `import bpy` and direct `bpy.` access; do not alias `bpy` or use `from bpy import ...`.');
  expect(prompt).toContain('Always create at least one mesh named with MODEL_ID.');
  expect(prompt).toContain('Do not save files; the worker wrapper saves .blend, OBJ, preview PNG, PACE, and summary.');
  expect(prompt).toContain('Never create floating, detached, or separated limbs');
});

test('buildBlenderScriptPrompt constrains human body parts to stay connected', () => {
  const prompt = buildBlenderScriptPrompt(
    BASE_PAYLOAD,
    {
      sourceImagePath: '/tmp/action-reference.png',
      workingDirectory: '/tmp/blender-job',
    },
  );

  expect(prompt).toContain(
    'torso, pelvis, head, arms, hands, legs, and feet must read as one continuous connected body',
  );
  expect(prompt).toContain('Never create floating, detached, or separated limbs');
  expect(prompt).toContain('spaced stance or separated feet means pose spacing only');
  expect(prompt).toContain(
    'joined proxy meshes, overlapping cylinders/capsules, parented primitives, or simple joint spheres',
  );
});
