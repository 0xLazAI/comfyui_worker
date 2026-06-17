import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';

import type { HydratedBlenderTaskPayload } from './types.js';
import {
  buildBlenderScriptPrompt,
  collectBlenderScriptViolations,
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

const VALID_REFERENCE_ANALYSIS = {
  blockingNotes: ['Keep a clear camera corridor to the focus object.'],
  cameraBrief: 'Low centered camera toward the focus object.',
  environment: ['indoor space'],
  generationPrompt: 'Simple previs scene matching the reference image.',
  primarySubjects: ['hero subject'],
  sceneBrief: 'Reference scene with one hero subject and a focus object.',
};

const VALID_SCENE_PLAN = JSON.stringify({
  sceneType: 'indoor basketball arena',
  isStandardVenue: true,
  venue: {
    name: 'FIBA basketball court',
    canonicalDimensions: '28 x 15 m',
    buildRules: ['center the set at world origin', 'axis-aligned', 'markings coplanar'],
    anchors: ['near_hoop', 'center'],
  },
  subjects: [
    { name: 'shooter', role: 'hero', approxSize: '1.9 m', placement: 'near center', action: 'jump shot' },
  ],
  camera: { position: 'high diagonal spectator', lookAt: 'center', focalMm: 35 },
});

afterEach(async () => {
  setBlenderScriptGeneratorForTests(undefined);
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('@openai/codex-sdk');
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_API_KEY;
  delete process.env.CODEX_CLI_PATH;
  delete process.env.OPENAI_CODEX_MODEL;
  delete process.env.OPENAI_CODEX_REASONING_EFFORT;
  delete process.env.OPENAI_CODEX_TURN_TIMEOUT_MS;
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

test('collectBlenderScriptViolations flags scripts that do not use bpy', () => {
  const expected = 'The script must use exactly `import bpy` and direct `bpy.` access; do not alias bpy or use `from bpy import ...`.';

  expect(collectBlenderScriptViolations('print("hello")\n')).toContain(expected);
  expect(collectBlenderScriptViolations('import bpy\nprint("bpy")\n')).toContain(expected);
  expect(
    collectBlenderScriptViolations('import bpy\n# bpy.ops.object.select_all()\n'),
  ).toContain(expected);
  expect(
    collectBlenderScriptViolations('import bpy as bp\nbp.ops.object.select_all()\n'),
  ).toContain(expected);
  expect(
    collectBlenderScriptViolations('from bpy import ops\nops.object.select_all()\n'),
  ).toContain(expected);
});

test('collectBlenderScriptViolations accepts a clean Blender script', () => {
  expect(
    collectBlenderScriptViolations('import bpy\nimport mathutils\nbpy.ops.object.select_all()\n'),
  ).toEqual([]);
});

test('collectBlenderScriptViolations flags unsupported engine, bpy.mathutils, and text objects', () => {
  const eevee = collectBlenderScriptViolations(
    "import bpy\nbpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'\n",
  );
  expect(eevee.some((violation) => violation.includes('BLENDER_EEVEE_NEXT'))).toBe(true);

  const mathutils = collectBlenderScriptViolations(
    'import bpy\ndirection = bpy.mathutils.Vector((0, 0, 0))\n',
  );
  expect(mathutils.some((violation) => violation.includes('import mathutils'))).toBe(true);

  const textAdd = collectBlenderScriptViolations(
    'import bpy\nbpy.ops.object.text_add(location=(0, 0, 0))\n',
  );
  expect(textAdd.some((violation) => violation.includes('on-screen text'))).toBe(true);

  const fontCurve = collectBlenderScriptViolations(
    "import bpy\ncurve = bpy.data.curves.new('label', type='FONT')\n",
  );
  expect(fontCurve.some((violation) => violation.includes('on-screen text'))).toBe(true);
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

test('parseGeneratedBlenderScriptResponse rejects missing script content', () => {
  expect(() =>
    parseGeneratedBlenderScriptResponse(
      JSON.stringify({ notes: [], script: '   ', summary: 'empty' }),
    ),
  ).toThrow('Codex returned invalid script.');
});

test('generateBlenderScript codex branch uses strict sandbox options and structured output schema', async () => {
  const threadRun = vi
    .fn()
    .mockResolvedValueOnce({ finalResponse: VALID_SCENE_PLAN })
    .mockResolvedValueOnce({
      finalResponse: JSON.stringify({
        notes: ['generated'],
        referenceAnalysis: VALID_REFERENCE_ANALYSIS,
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
      modelReasoningEffort: 'medium',
      networkAccessEnabled: false,
      sandboxMode: 'workspace-write',
      skipGitRepoCheck: true,
      webSearchMode: 'disabled',
      workingDirectory: '/tmp/blender-job',
    });
    expect(threadRun).toHaveBeenCalledTimes(2);

    // Turn 1 — analysis: the image is attached and the scene-plan schema is used.
    const [planInput, planOptions] = threadRun.mock.calls[0] as [
      Array<{ path?: string; text?: string; type: string }>,
      { outputSchema: { properties: Record<string, unknown> } },
    ];
    expect(planInput).toEqual([
      { text: expect.stringContaining('ANALYSIS step'), type: 'text' },
      { path: '/tmp/source.png', type: 'local_image' },
    ]);
    expect(planOptions.outputSchema.properties).toHaveProperty('venue');
    expect(planOptions.outputSchema.properties).toHaveProperty('isStandardVenue');

    // Turn 2 — generation: text-only (image already in thread context), script schema.
    const [scriptInput, scriptOptions] = threadRun.mock.calls[1] as [
      string,
      { outputSchema: { properties: Record<string, unknown> } },
    ];
    expect(typeof scriptInput).toBe('string');
    expect(scriptInput).toContain('Workflow: blender-create-3d');
    expect(scriptInput).toContain('Task id: task_123');
    expect(scriptInput).toContain('Populate `referenceAnalysis` first');
    expect(scriptOptions.outputSchema.properties).toHaveProperty('referenceAnalysis');
    expect(scriptOptions.outputSchema.properties).toHaveProperty('script');
    expect(result.referenceAnalysis).toMatchObject({
      cameraBrief: VALID_REFERENCE_ANALYSIS.cameraBrief,
      primarySubjects: VALID_REFERENCE_ANALYSIS.primarySubjects,
    });
    expect(result.agentInstructionsPath).toContain('agent.md');
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test('generateBlenderScript runs a violation repair turn on the same thread when needed', async () => {
  const threadRun = vi
    .fn()
    .mockResolvedValueOnce({ finalResponse: VALID_SCENE_PLAN })
    .mockResolvedValueOnce({
      finalResponse: JSON.stringify({
        notes: ['first attempt'],
        referenceAnalysis: VALID_REFERENCE_ANALYSIS,
        script: "import bpy\nbpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'\n",
        summary: 'first attempt with violation',
      }),
    })
    .mockResolvedValueOnce({
      finalResponse: JSON.stringify({
        notes: ['repaired'],
        referenceAnalysis: VALID_REFERENCE_ANALYSIS,
        script: "import bpy\nbpy.context.scene.render.engine = 'BLENDER_EEVEE'\n",
        summary: 'repaired script',
      }),
    });
  const startThread = vi.fn().mockReturnValue({
    id: 'thread_live',
    run: threadRun,
  });

  vi.resetModules();
  vi.doMock('@openai/codex-sdk', () => ({
    Codex: function CodexMock() {
      return { startThread };
    },
  }));

  process.env.OPENAI_API_KEY = 'test-openai-key';

  const { generateBlenderScript: generateBlenderScriptWithMock } = await import('./agent.js');
  const result = await generateBlenderScriptWithMock(BASE_PAYLOAD, {
    sourceImagePath: null,
    workingDirectory: '/tmp/blender-job',
  });

  // plan turn + script turn + violation repair turn
  expect(threadRun).toHaveBeenCalledTimes(3);
  const [repairInput] = threadRun.mock.calls[2] as [string];
  expect(repairInput).toContain('violates the worker contract');
  expect(repairInput).toContain('BLENDER_EEVEE_NEXT');
  expect(result.summary).toBe('repaired script');
  expect(result.script).toContain("'BLENDER_EEVEE'");
});

test('generateBlenderScript codex branch allows reasoning effort override', async () => {
  const threadRun = vi.fn().mockResolvedValue({
    finalResponse: JSON.stringify({
      notes: ['generated'],
      referenceAnalysis: VALID_REFERENCE_ANALYSIS,
      script: 'import bpy\nbpy.ops.object.select_all()\n',
      summary: 'generated blender script',
    }),
  });
  const startThread = vi.fn().mockReturnValue({
    id: 'thread_live',
    run: threadRun,
  });

  vi.resetModules();
  vi.doMock('@openai/codex-sdk', () => ({
    Codex: function CodexMock() {
      return { startThread };
    },
  }));

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_CODEX_REASONING_EFFORT = 'high';

  const { generateBlenderScript: generateBlenderScriptWithMock } = await import('./agent.js');
  await generateBlenderScriptWithMock(BASE_PAYLOAD, {
    sourceImagePath: null,
    workingDirectory: '/tmp/blender-job',
  });

  expect(startThread).toHaveBeenCalledWith(
    expect.objectContaining({
      modelReasoningEffort: 'high',
    }),
  );
});

test('generateBlenderScript aborts a codex turn that exceeds the turn timeout', async () => {
  // thread.run honors the abort signal node would pass to the spawned `codex exec` child,
  // so a hung turn rejects instead of leaking an orphaned codex process.
  const threadRun = vi.fn().mockImplementation(
    (_input: unknown, options: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      }),
  );
  const startThread = vi.fn().mockReturnValue({
    id: 'thread_live',
    run: threadRun,
  });

  vi.resetModules();
  vi.doMock('@openai/codex-sdk', () => ({
    Codex: function CodexMock() {
      return { startThread };
    },
  }));

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_CODEX_TURN_TIMEOUT_MS = '20';

  const { generateBlenderScript: generateBlenderScriptWithMock } = await import('./agent.js');
  await expect(
    generateBlenderScriptWithMock(BASE_PAYLOAD, {
      sourceImagePath: null,
      workingDirectory: '/tmp/blender-job',
    }),
  ).rejects.toThrow(/timed out after 20ms/);

  const [, options] = threadRun.mock.calls[0] as [unknown, { signal?: AbortSignal }];
  expect(options.signal).toBeInstanceOf(AbortSignal);
});

test('repairBlenderScript resumes the original thread and returns the corrected script', async () => {
  const threadRun = vi.fn().mockResolvedValue({
    finalResponse: JSON.stringify({
      notes: ['repaired'],
      referenceAnalysis: VALID_REFERENCE_ANALYSIS,
      script: 'import bpy\nbpy.ops.mesh.primitive_cube_add()\n',
      summary: 'repaired after runner failure',
    }),
  });
  const resumeThread = vi.fn().mockReturnValue({
    id: 'thread_live',
    run: threadRun,
  });

  vi.resetModules();
  vi.doMock('@openai/codex-sdk', () => ({
    Codex: function CodexMock() {
      return { resumeThread, startThread: vi.fn() };
    },
  }));

  process.env.OPENAI_API_KEY = 'test-openai-key';

  const { repairBlenderScript: repairWithMock } = await import('./agent.js');
  const result = await repairWithMock(
    {
      notes: ['original'],
      provider: 'codex',
      script: 'import bpy\nbroken()\n',
      summary: 'original script',
      threadId: 'thread_live',
    },
    BASE_PAYLOAD,
    { sourceImagePath: null, workingDirectory: '/tmp/blender-job' },
    {
      errorMessage: "NameError: name 'broken' is not defined",
      logsTail: ["stderr: NameError: name 'broken' is not defined"],
      runId: 'run_failed_1',
    },
  );

  expect(resumeThread).toHaveBeenCalledWith(
    'thread_live',
    expect.objectContaining({ workingDirectory: '/tmp/blender-job' }),
  );
  const [repairInput] = threadRun.mock.calls[0] as [string];
  expect(repairInput).toContain('failed to execute your previous script');
  expect(repairInput).toContain("NameError: name 'broken' is not defined");
  expect(result.summary).toBe('repaired after runner failure');
  expect(result.threadId).toBe('thread_live');
});

test('reviewBlenderPreview resumes the thread with preview and reference images', async () => {
  const threadRun = vi.fn().mockResolvedValue({
    finalResponse: JSON.stringify({
      approved: false,
      issues: ['Preview is too dark to inspect.'],
      script: 'import bpy\nbpy.ops.object.light_add(type="AREA")\n',
    }),
  });
  const resumeThread = vi.fn().mockReturnValue({
    id: 'thread_live',
    run: threadRun,
  });

  vi.resetModules();
  vi.doMock('@openai/codex-sdk', () => ({
    Codex: function CodexMock() {
      return { resumeThread, startThread: vi.fn() };
    },
  }));

  process.env.OPENAI_API_KEY = 'test-openai-key';

  const { reviewBlenderPreview: reviewWithMock } = await import('./agent.js');
  const review = await reviewWithMock(
    {
      notes: ['original'],
      provider: 'codex',
      script: 'import bpy\nbpy.ops.object.select_all()\n',
      summary: 'original script',
      threadId: 'thread_live',
    },
    BASE_PAYLOAD,
    { sourceImagePath: '/tmp/source.png', workingDirectory: '/tmp/blender-job' },
    '/tmp/preview.png',
  );

  expect(resumeThread).toHaveBeenCalledWith(
    'thread_live',
    expect.objectContaining({ workingDirectory: '/tmp/blender-job' }),
  );
  const [input] = threadRun.mock.calls[0] as [
    Array<{ path?: string; text?: string; type: string }>,
  ];
  expect(input[0]).toMatchObject({ type: 'text' });
  expect((input[0] as { text: string }).text).toContain('Review the rendered preview');
  expect((input[0] as { text: string }).text).toContain('no floating, detached, or separated limbs');
  expect(input[1]).toEqual({ path: '/tmp/preview.png', type: 'local_image' });
  expect(input[2]).toEqual({ path: '/tmp/source.png', type: 'local_image' });
  expect(review).toEqual({
    approved: false,
    issues: ['Preview is too dark to inspect.'],
    script: 'import bpy\nbpy.ops.object.light_add(type="AREA")\n',
  });
});

test('reviewBlenderPreview can use a shorter preview-specific turn timeout', async () => {
  const threadRun = vi.fn().mockImplementation(
    (_input: unknown, options: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      }),
  );
  const resumeThread = vi.fn().mockReturnValue({
    id: 'thread_live',
    run: threadRun,
  });

  vi.resetModules();
  vi.doMock('@openai/codex-sdk', () => ({
    Codex: function CodexMock() {
      return { resumeThread, startThread: vi.fn() };
    },
  }));

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_CODEX_TURN_TIMEOUT_MS = '200';

  const { reviewBlenderPreview: reviewWithMock } = await import('./agent.js');
  await expect(
    (reviewWithMock as any)(
      {
        notes: ['original'],
        provider: 'codex',
        script: 'import bpy\nbpy.ops.object.select_all()\n',
        summary: 'original script',
        threadId: 'thread_live',
      },
      BASE_PAYLOAD,
      { sourceImagePath: null, workingDirectory: '/tmp/blender-job' },
      '/tmp/preview.png',
      { turnTimeoutMs: 20 },
    ),
  ).rejects.toThrow(/timed out after 20ms/);

  const [, options] = threadRun.mock.calls[0] as [unknown, { signal?: AbortSignal }];
  expect(options.signal).toBeInstanceOf(AbortSignal);
});

test('buildBlenderScriptPrompt includes workflow context, identifiers, update prompt, and the agent.md contract', () => {
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
  expect(prompt).not.toContain('User prompt:');
  expect(prompt).toContain('Agent instructions from agent.md');
  expect(prompt).toContain('low-poly + scene blocking + storyboard previs');
  expect(prompt).toContain('Blender Invocation Contract');
  expect(prompt).toContain('"schema_version": "pace-1"');
  expect(prompt).toContain('TASK_ID, SCENE_ID, SHOT_ID, OUTPUT_DIR');
  expect(prompt).toContain('Name the hero mesh with the Model id below.');
  expect(prompt).toContain('Do not save or export files; the runner saves all artifacts.');
});

test('buildBlenderScriptPrompt constrains human body parts to stay connected', () => {
  const prompt = buildBlenderScriptPrompt(
    {
      ...BASE_PAYLOAD,
      prompt: 'Create two action characters from the reference image.',
    },
    {
      sourceImagePath: '/tmp/reference.png',
      workingDirectory: '/tmp/blender-job',
    },
  );

  expect(prompt).toContain('Human anatomy continuity guardrail:');
  expect(prompt).toContain(
    'torso, pelvis, head, arms, hands, legs, and feet must read as one continuous connected body',
  );
  expect(prompt).toContain('Never create floating, detached, or separated limbs');
  expect(prompt).toContain('spaced stance or separated feet means pose spacing only');
});

test('buildBlenderScriptPrompt stays scene-generic and demands image-specific analysis', () => {
  const prompt = buildBlenderScriptPrompt(
    {
      ...BASE_PAYLOAD,
      prompt: 'Match the reference composition and keep labels out of the scene.',
    },
    {
      sourceImagePath: '/tmp/reference.png',
      workingDirectory: '/tmp/blender-job',
    },
  );

  expect(prompt).toContain('Workflow: blender-create-3d');
  expect(prompt).toContain(
    'User prompt: Match the reference composition and keep labels out of the scene.',
  );
  expect(prompt).not.toContain('Update prompt:');
  expect(prompt).toContain(
    'For create-3d, apply the user prompt as primary creative direction alongside the reference image and PACE.',
  );
  expect(prompt).toContain('Populate `referenceAnalysis` first');
  expect(prompt).toContain(
    '`blockingNotes` must be scene-specific and actionable for THIS reference image and PACE',
  );
  expect(prompt).toContain('never assume a specific sport or setting that the image does not show');
  expect(prompt).not.toContain('hockey');
  expect(prompt).not.toContain('stick blades must sit near the puck');
  expect(prompt).not.toContain('referee must visibly bend');
  expect(prompt).not.toContain('jersey trim');
});
