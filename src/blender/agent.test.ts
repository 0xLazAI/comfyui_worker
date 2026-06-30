import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  assertWorkingDirectoryExists,
  buildThreadOptions,
  collectBlenderScriptViolations,
  loadBlenderAgentInstructions,
  runCodexTurn,
} from './agent.js';

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_API_KEY;
  delete process.env.CODEX_CLI_PATH;
  delete process.env.BLENDER_AGENT_INSTRUCTIONS_PATH;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

// ── collectBlenderScriptViolations ──────────────────────────────────────────
test('collectBlenderScriptViolations accepts a clean bpy script', () => {
  const script = 'import bpy\nbpy.ops.mesh.primitive_cube_add()\n';
  expect(collectBlenderScriptViolations(script)).toEqual([]);
});

test('collectBlenderScriptViolations flags missing bpy import/access', () => {
  expect(collectBlenderScriptViolations('print("no bpy here")\n')).toHaveLength(1);
});

test('collectBlenderScriptViolations flags EEVEE_NEXT, bpy.mathutils, and text objects', () => {
  const script =
    "import bpy\nbpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'\nv = bpy.mathutils.Vector()\nbpy.ops.object.text_add()\n";
  const violations = collectBlenderScriptViolations(script);
  expect(violations.some((v) => v.includes('BLENDER_EEVEE_NEXT'))).toBe(true);
  expect(violations.some((v) => v.includes('mathutils'))).toBe(true);
  expect(violations.some((v) => v.includes('on-screen text'))).toBe(true);
});

test('collectBlenderScriptViolations ignores comment-stripped checks (bpy.mathutils) inside comments', () => {
  // The bpy.mathutils check runs against comment/string-stripped source, so a mention
  // in a comment is not flagged (the raw-text checks like EEVEE_NEXT/FONT still are).
  const script = 'import bpy\n# avoid bpy.mathutils.Vector here\nbpy.ops.object.select_all()\n';
  expect(collectBlenderScriptViolations(script)).toEqual([]);
});

// ── loadBlenderAgentInstructions ────────────────────────────────────────────
test('loadBlenderAgentInstructions loads the per-workflow agent.md', () => {
  const loaded = loadBlenderAgentInstructions('blender-pace-review');
  expect(loaded.path).toContain(path.join('workflows', 'blender-pace-review', 'agent.md'));
  expect(loaded.content.length).toBeGreaterThan(0);
});

test('loadBlenderAgentInstructions honors BLENDER_AGENT_INSTRUCTIONS_PATH override', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agent-instr-'));
  const file = path.join(dir, 'agent.md');
  await writeFile(file, 'custom instructions');
  try {
    process.env.BLENDER_AGENT_INSTRUCTIONS_PATH = file;
    const loaded = loadBlenderAgentInstructions('blender-pace-review');
    expect(loaded.path).toBe(file);
    expect(loaded.content).toBe('custom instructions');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── buildThreadOptions / assertWorkingDirectoryExists ───────────────────────
test('buildThreadOptions uses the config model + reasoning effort and safe sandbox flags', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agent-cwd-'));
  try {
    expect(buildThreadOptions(dir)).toEqual({
      approvalPolicy: 'never',
      model: 'gpt-5.5',
      modelReasoningEffort: 'medium',
      networkAccessEnabled: false,
      sandboxMode: 'workspace-write',
      skipGitRepoCheck: true,
      webSearchMode: 'disabled',
      workingDirectory: dir,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('assertWorkingDirectoryExists rejects missing and empty paths', () => {
  expect(() => assertWorkingDirectoryExists('')).toThrow(/empty/);
  expect(() => assertWorkingDirectoryExists('/no/such/dir/xyz123')).toThrow(/does not exist/);
});

// ── createCodexClient ───────────────────────────────────────────────────────
test('createCodexClient passes the env API key and the config CLI path to Codex', async () => {
  let ctorArgs: any;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agent-cli-'));
  const fakeCli = path.join(dir, 'codex');
  await writeFile(fakeCli, '#!/bin/sh\n');
  try {
    vi.resetModules();
    vi.doMock('@openai/codex-sdk', () => ({
      Codex: function CodexMock(args: unknown) {
        ctorArgs = args;
        return {};
      },
    }));
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.CODEX_CLI_PATH = fakeCli;
    const { createCodexClient } = await import('./agent.js');
    createCodexClient();
    expect(ctorArgs).toEqual({ apiKey: 'test-key', codexPathOverride: fakeCli });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── runCodexTurn ────────────────────────────────────────────────────────────
test('runCodexTurn aborts a turn that exceeds the timeout and passes the abort signal', async () => {
  const run = vi.fn().mockImplementation(
    (_input: unknown, options: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  const thread = { id: 'thread_live', run } as any;

  await expect(runCodexTurn(thread, 'prompt', {}, { timeoutMs: 20 })).rejects.toThrow(/timed out after 20ms/);
  const [, options] = run.mock.calls[0] as [unknown, { signal?: AbortSignal }];
  expect(options.signal).toBeInstanceOf(AbortSignal);
});

test('runCodexTurn returns the run result when the turn completes in time', async () => {
  const run = vi.fn().mockResolvedValue({ finalResponse: 'ok' });
  const thread = { id: 'thread_live', run } as any;
  const result = await runCodexTurn(thread, 'prompt', {});
  expect(result).toEqual({ finalResponse: 'ok' });
});
