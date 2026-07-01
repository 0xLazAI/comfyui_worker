import type { ModelReasoningEffort } from '@openai/codex-sdk';

/**
 * Static agent configuration for the Blender pace-review workflow.
 *
 * The model / reasoning-effort / timeout / CLI-path knobs that used to live in
 * `OPENAI_CODEX_*` environment variables are pinned here instead — they are part
 * of the worker's behaviour, not per-deployment secrets, so they belong in code
 * where they are reviewable and version-controlled.
 *
 * The ONE thing that stays in the environment is the credential: if a codex/
 * anthropic API key is needed it is read from `OPENAI_API_KEY` / `CODEX_API_KEY`
 * at client-construction time (see agent.ts). Locally the codex CLI uses its own
 * authenticated app session, so no key is required.
 */

export interface CodexAgentConfig {
  /** Model id passed to the codex CLI. `undefined` lets the CLI use its default. */
  model: string | undefined;
  reasoningEffort: ModelReasoningEffort;
  /** Hard wall-clock bound for a single codex turn (ms). */
  turnTimeoutMs: number;
  /** Absolute path to the codex CLI binary. */
  cliPath: string;
}

export interface ClaudeAgentConfig {
  model: string;
  /** Hard wall-clock bound for a single claude turn (ms). */
  turnTimeoutMs: number;
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export const codexConfig: CodexAgentConfig = {
  model: 'gpt-5.5',
  reasoningEffort: 'medium',
  turnTimeoutMs: FIFTEEN_MINUTES_MS,
  cliPath: '/Applications/Codex.app/Contents/Resources/codex',
};

// `claude` is a recognised agent but the adapter is not implemented yet (the
// pace-review payload validator rejects it). Kept here so the model choice is in
// one place when the claude path lands.
export const claudeConfig: ClaudeAgentConfig = {
  model: 'claude-opus-4-8',
  turnTimeoutMs: FIFTEEN_MINUTES_MS,
};
