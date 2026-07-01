/**
 * Shared codex-agent primitives for the blender workflows.
 *
 * This module is the thin, workflow-agnostic layer the blender-pace-review agent
 * (paceReviewAgent.ts) builds on: it constructs the codex client/thread, runs a
 * single bounded turn, loads the per-workflow agent.md instructions, and screens a
 * generated Blender script for the worker-contract violations the runner can't
 * tolerate. Prompt construction and response parsing are the caller's job.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  Codex,
  type Input,
  type ModelReasoningEffort,
  type RunResult,
  type Thread,
  type ThreadOptions,
  type TurnOptions,
} from '@openai/codex-sdk';

import type { BlenderWorkflowId } from './types.js';
import { codexConfig } from './config.js';

const DEFAULT_AGENT_INSTRUCTIONS_PATHS = ['agent.md', 'Agent.md', 'AGENT.md'] as const;
// Per-workflow agent.md files live under workflows/<workflow-id>/. When present
// they take precedence over the repo-root agent.md so each workflow constrains
// its agent independently (the BLENDER_AGENT_INSTRUCTIONS_PATH env still wins).
const WORKFLOW_INSTRUCTION_FILENAMES = ['agent.md', 'Agent.md', 'AGENT.md'] as const;

export interface GenerateBlenderScriptContext {
  sourceImagePath?: string | null;
  workingDirectory: string;
}

interface LoadedBlenderAgentInstructions {
  content: string;
  path: string;
}

export function loadBlenderAgentInstructions(
  workflowId?: BlenderWorkflowId,
): LoadedBlenderAgentInstructions {
  const configuredPath = process.env.BLENDER_AGENT_INSTRUCTIONS_PATH?.trim();
  const workflowCandidates = workflowId
    ? WORKFLOW_INSTRUCTION_FILENAMES.map((filename) =>
        join(process.cwd(), 'workflows', workflowId, filename),
      )
    : [];
  const rootCandidates = DEFAULT_AGENT_INSTRUCTIONS_PATHS.map((filename) =>
    join(process.cwd(), filename),
  );
  const candidatePaths = configuredPath
    ? [configuredPath]
    : [...workflowCandidates, ...rootCandidates];
  const instructionPath = candidatePaths.find((candidatePath) => existsSync(candidatePath));

  if (!instructionPath) {
    throw new Error(`Blender agent instructions file not found: ${candidatePaths.join(', ')}`);
  }

  return {
    content: readFileSync(instructionPath, 'utf8').trim(),
    path: instructionPath,
  };
}

export function collectBlenderScriptViolations(script: string): string[] {
  const violations: string[] = [];
  const normalized = stripPythonCommentsAndStrings(script);
  const hasBpyImport = /(?:^|\n)\s*import\s+bpy\s*(?:\n|$)/m.test(normalized);
  const hasBpyAccess = /\bbpy\.[A-Za-z_]\w*/.test(normalized);

  if (!hasBpyImport || !hasBpyAccess) {
    violations.push('The script must use exactly `import bpy` and direct `bpy.` access; do not alias bpy or use `from bpy import ...`.');
  }
  if (script.includes('BLENDER_EEVEE_NEXT')) {
    violations.push('Do not use `BLENDER_EEVEE_NEXT`; prefer `BLENDER_EEVEE`, `BLENDER_WORKBENCH`, or `CYCLES`, and only set render.engine after checking the enum is available.');
  }
  if (/\bbpy\.mathutils\./.test(normalized)) {
    violations.push('Use `import mathutils` for vectors and quaternions; `bpy.mathutils` does not exist.');
  }
  if (/\bbpy\.ops\.object\.text_add\s*\(/.test(normalized) || /type\s*=\s*['"]FONT['"]/.test(script)) {
    violations.push('Do not add readable on-screen text objects; use object names, non-text markers, color blocks, and simple geometry instead, unless the user explicitly asked for on-screen text.');
  }

  return violations;
}

function stripPythonCommentsAndStrings(script: string): string {
  let output = '';
  let index = 0;

  while (index < script.length) {
    const char = script[index];
    const next3 = script.slice(index, index + 3);

    if (next3 === "'''" || next3 === '"""') {
      const endIndex = findTripleQuotedStringEnd(script, index + 3, next3);
      output += maskScriptSegment(script.slice(index, endIndex));
      index = endIndex;
      continue;
    }

    if (char === '\'' || char === '"') {
      const endIndex = findQuotedStringEnd(script, index + 1, char);
      output += maskScriptSegment(script.slice(index, endIndex));
      index = endIndex;
      continue;
    }

    if (char === '#') {
      const endIndex = findCommentEnd(script, index + 1);
      output += maskScriptSegment(script.slice(index, endIndex));
      index = endIndex;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function findTripleQuotedStringEnd(script: string, startIndex: number, quote: string): number {
  let index = startIndex;

  while (index < script.length) {
    if (script[index] === '\\') {
      index += 2;
      continue;
    }

    if (script.slice(index, index + 3) === quote) {
      return index + 3;
    }

    index += 1;
  }

  return script.length;
}

function findQuotedStringEnd(script: string, startIndex: number, quote: string): number {
  let index = startIndex;

  while (index < script.length) {
    const char = script[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) {
      return index + 1;
    }
    index += 1;
  }

  return script.length;
}

function findCommentEnd(script: string, startIndex: number): number {
  const newlineIndex = script.indexOf('\n', startIndex);
  return newlineIndex === -1 ? script.length : newlineIndex;
}

function maskScriptSegment(segment: string): string {
  return segment.replace(/[^\n]/g, ' ');
}

// Model / reasoning-effort are pinned in config.ts (not env). See src/blender/config.ts.
function getCodexModel(): string | undefined {
  return codexConfig.model;
}

function getCodexReasoningEffort(): ModelReasoningEffort {
  return codexConfig.reasoningEffort;
}

export function createCodexClient(): Codex {
  // The API key is the one codex setting that stays in the environment (a secret,
  // not behaviour). Locally the codex CLI uses its own authenticated app session.
  const apiKey = process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY;
  // CLI binary path: config default, with a CODEX_CLI_PATH escape hatch for hosts
  // that install the binary elsewhere.
  const codexPathOverride = process.env.CODEX_CLI_PATH || codexConfig.cliPath;
  return new Codex({
    ...(apiKey ? { apiKey } : {}),
    ...(existsSync(codexPathOverride) ? { codexPathOverride } : {}),
  });
}

function getCodexTurnTimeoutMs(timeoutOverrideMs?: number): number {
  if (timeoutOverrideMs !== undefined) {
    if (!Number.isFinite(timeoutOverrideMs) || timeoutOverrideMs <= 0) {
      throw new Error(
        `Invalid Codex turn timeout override "${timeoutOverrideMs}". Expected a positive number of milliseconds.`,
      );
    }
    return Math.floor(timeoutOverrideMs);
  }

  return codexConfig.turnTimeoutMs;
}

/**
 * Runs one codex turn with a hard wall-clock bound. On timeout we abort the turn so the underlying
 * `codex exec` child is terminated (node SIGTERMs it via the spawn signal), preventing orphaned
 * codex processes from wedging the shared app-server.
 */
export async function runCodexTurn(
  thread: Thread,
  input: Input,
  turnOptions: Omit<TurnOptions, 'signal'>,
  options?: { timeoutMs?: number },
): Promise<RunResult> {
  const timeoutMs = getCodexTurnTimeoutMs(options?.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await thread.run(input, { ...turnOptions, signal: controller.signal });
  } catch (error: any) {
    if (controller.signal.aborted) {
      throw new Error(
        `Codex turn timed out after ${timeoutMs}ms and was aborted to release the codex process.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Codex is spawned with `--cd <workingDirectory>`. If that path does not exist (or is not a
 * directory), the codex CLI aborts before producing any JSON with the opaque Rust error
 * `Error: No such file or directory (os error 2)`. Validate the boundary here so the failure is
 * actionable instead of a cryptic exit code far downstream.
 */
export function assertWorkingDirectoryExists(workingDirectory: string): void {
  const trimmed = String(workingDirectory || '').trim();
  if (!trimmed) {
    throw new Error('Blender agent workingDirectory is empty; cannot start the codex thread.');
  }
  let stats;
  try {
    stats = statSync(trimmed);
  } catch {
    throw new Error(
      `Blender agent workingDirectory does not exist: "${trimmed}". ` +
        'The codex CLI runs with `--cd <workingDirectory>` and fails with "No such file or directory ' +
        '(os error 2)" when this path is missing on the worker host. Ensure the task project_root ' +
        'points at a directory that exists on the worker.',
    );
  }
  if (!stats.isDirectory()) {
    throw new Error(
      `Blender agent workingDirectory is not a directory: "${trimmed}".`,
    );
  }
}

export function buildThreadOptions(workingDirectory: string): ThreadOptions {
  assertWorkingDirectoryExists(workingDirectory);
  return {
    approvalPolicy: 'never',
    model: getCodexModel(),
    modelReasoningEffort: getCodexReasoningEffort(),
    networkAccessEnabled: false,
    sandboxMode: 'workspace-write',
    skipGitRepoCheck: true,
    webSearchMode: 'disabled',
    workingDirectory,
  };
}
