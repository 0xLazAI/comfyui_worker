import { spawn } from 'node:child_process';
import {
  LORA_TRAINER_COMMAND,
  LORA_TRAINER_SSH_HOST,
  LORA_TRAINER_SSH_PORT,
} from '../infra/constants.js';
import type { NormalizedTrainStyleLoraPayload } from './loraTrainPayload.js';
import { ensureLoraTrainerSynced } from './loraTrainerSync.js';

export interface LoraTrainerSubmitResult {
  jobId: string;
  runDir?: string | null;
  statusPath?: string | null;
  logPath?: string | null;
  outputDir?: string | null;
  status?: string | null;
  phase?: string | null;
  [key: string]: unknown;
}

export interface LoraTrainerStatusResult {
  jobId?: string | null;
  status: string;
  phase?: string | null;
  currentStep?: number | null;
  totalSteps?: number | null;
  progress?: number | null;
  message?: string | null;
  error?: string | null;
  lastLogLines?: string[] | null;
  runDir?: string | null;
  statusPath?: string | null;
  logPath?: string | null;
  outputDir?: string | null;
  [key: string]: unknown;
}

export interface LoraTrainerFinalizeResult {
  status?: string | null;
  lora?: {
    name?: string;
    publishMode?: string;
    usableScope?: string;
    baseProfile?: string;
    trigger?: string;
    localPath?: string;
    metadataPath?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function submitLoraTrainerJob(
  payload: NormalizedTrainStyleLoraPayload,
): Promise<LoraTrainerSubmitResult> {
  await ensureLoraTrainerSynced();
  const result = await runTrainerCommand(['submit'], JSON.stringify(toRunnerSubmitRequest(payload)));
  const jobId = String(result.jobId || result.job_id || '').trim();
  if (!jobId) {
    throw new Error('lora trainer submit did not return jobId');
  }
  return {
    ...result,
    jobId,
    runDir: normalizeOptionalString(result.runDir || result.run_dir),
    statusPath: normalizeOptionalString(result.statusPath || result.status_path),
    logPath: normalizeOptionalString(result.logPath || result.log_path),
    outputDir: normalizeOptionalString(result.outputDir || result.output_dir),
    status: normalizeOptionalString(result.status),
    phase: normalizeOptionalString(result.phase),
  };
}

export async function getLoraTrainerStatus(jobId: string): Promise<LoraTrainerStatusResult> {
  const result = await runTrainerCommand(['status', '--job-id', jobId]);
  const status = String(result.status || '').trim();
  if (!status) {
    throw new Error('lora trainer status did not return status');
  }
  return {
    ...result,
    jobId: normalizeOptionalString(result.jobId || result.job_id),
    status,
    phase: normalizeOptionalString(result.phase),
    currentStep: normalizeOptionalNumber(result.currentStep ?? result.current_step),
    totalSteps: normalizeOptionalNumber(result.totalSteps ?? result.total_steps),
    progress: normalizeOptionalNumber(result.progress),
    message: normalizeOptionalString(result.message),
    error: normalizeOptionalString(result.error),
    lastLogLines: normalizeStringList(result.lastLogLines ?? result.last_log_lines),
    runDir: normalizeOptionalString(result.runDir || result.run_dir),
    statusPath: normalizeOptionalString(result.statusPath || result.status_path),
    logPath: normalizeOptionalString(result.logPath || result.log_path),
    outputDir: normalizeOptionalString(result.outputDir || result.output_dir),
  };
}

export async function finalizeLoraTrainerJob(jobId: string): Promise<LoraTrainerFinalizeResult> {
  return runTrainerCommand(['finalize', '--job-id', jobId]) as Promise<LoraTrainerFinalizeResult>;
}

function toRunnerSubmitRequest(payload: NormalizedTrainStyleLoraPayload): Record<string, unknown> {
  return {
    taskId: payload.taskId,
    projectId: payload.projectId,
    mode: payload.mode,
    baseProfile: payload.baseProfile,
    lora: payload.lora,
    dataset: payload.dataset,
    continueFrom: payload.continueFrom.loraPath ? payload.continueFrom : undefined,
    train: payload.train,
    publish: payload.publish,
  };
}

async function runTrainerCommand(args: string[], stdin?: string): Promise<Record<string, unknown>> {
  if (!LORA_TRAINER_SSH_HOST) {
    throw new Error('LORA_TRAINER_SSH_HOST is required for train_style_lora tasks');
  }
  if (!LORA_TRAINER_COMMAND) {
    throw new Error('LORA_TRAINER_COMMAND is required for train_style_lora tasks');
  }

  const sshArgs = [
    '-p',
    String(LORA_TRAINER_SSH_PORT),
    '-o',
    'BatchMode=yes',
    LORA_TRAINER_SSH_HOST,
    LORA_TRAINER_COMMAND,
    ...args,
  ];
  const output = await spawnCollect('ssh', sshArgs, stdin);
  return parseJsonOutput(output.stdout, output.stderr);
}

function spawnCollect(command: string, args: string[], stdin?: string): Promise<{
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const stdoutText = Buffer.concat(stdout).toString('utf8');
      const stderrText = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        reject(new Error(`lora trainer command failed with exit ${code}: ${stderrText || stdoutText}`.slice(0, 1200)));
        return;
      }
      resolve({
        stdout: stdoutText,
        stderr: stderrText,
      });
    });

    if (stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

function parseJsonOutput(stdout: string, stderr: string): Record<string, unknown> {
  const text = stdout.trim();
  if (!text) {
    throw new Error(`lora trainer returned empty stdout${stderr.trim() ? `: ${stderr.trim().slice(0, 400)}` : ''}`);
  }

  const candidates = [text, ...text.split('\n').reverse()];
  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized.startsWith('{')) {
      continue;
    }
    try {
      const parsed = JSON.parse(normalized);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try the next line; runner logs may precede a final JSON line
    }
  }

  throw new Error(`lora trainer did not return JSON: ${text.slice(0, 800)}`);
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.map((entry) => String(entry || '').trim()).filter(Boolean);
}
