import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  LORA_TRAINER_COMMAND,
  LORA_TRAINER_LOCAL_SCRIPT,
  LORA_TRAINER_REMOTE_ENV_FILE,
  LORA_TRAINER_REMOTE_SCRIPT,
  LORA_TRAINER_SSH_HOST,
  LORA_TRAINER_SSH_PORT,
  LORA_TRAINER_SYNC_LOCK_FILE,
  LORA_TRAINER_SYNC_ENABLED,
} from '../infra/constants.js';
import { logger } from '../infra/logger.js';

export interface LoraTrainerSyncResult {
  enabled: boolean;
  synced: boolean;
  localHash?: string;
  remoteHash?: string;
  remoteScript?: string;
  reason?: string;
}

let activeSync: Promise<LoraTrainerSyncResult> | null = null;

export async function ensureLoraTrainerSynced(): Promise<LoraTrainerSyncResult> {
  if (!LORA_TRAINER_SYNC_ENABLED) {
    return {
      enabled: false,
      synced: false,
      reason: 'disabled',
    };
  }

  if (activeSync) {
    return activeSync;
  }

  activeSync = doEnsureLoraTrainerSynced().finally(() => {
    activeSync = null;
  });
  return activeSync;
}

async function doEnsureLoraTrainerSynced(): Promise<LoraTrainerSyncResult> {
  if (!LORA_TRAINER_SSH_HOST) {
    throw new Error('LORA_TRAINER_SSH_HOST is required when LORA_TRAINER_SYNC_ENABLED=true');
  }
  if (!LORA_TRAINER_COMMAND) {
    throw new Error('LORA_TRAINER_COMMAND is required when LORA_TRAINER_SYNC_ENABLED=true');
  }

  const localScriptPath = resolveLocalScriptPath();
  const script = await fs.readFile(localScriptPath);
  const localHash = createHash('sha256').update(script).digest('hex');
  const remoteScript = resolveRemoteScriptPath();
  const remoteShaPath = `${remoteScript}.sha256`;
  const remoteState = await readRemoteState(remoteScript, remoteShaPath, LORA_TRAINER_COMMAND);

  if (
    remoteState.sha === localHash
    && remoteState.scriptExists
    && remoteState.commandExists
  ) {
    return {
      enabled: true,
      synced: false,
      localHash,
      remoteHash: remoteState.sha,
      remoteScript,
      reason: 'unchanged',
    };
  }

  await prepareRemoteDirectories(remoteScript, LORA_TRAINER_COMMAND);
  const unique = `${process.pid}-${Date.now()}`;
  const remoteTmp = `${remoteScript}.tmp-${unique}`;
  const remoteShaTmp = `${remoteShaPath}.tmp-${unique}`;
  await scpToRemote(localScriptPath, remoteTmp);
  await installRemoteScript({
    remoteTmp,
    remoteScript,
    remoteShaTmp,
    remoteShaPath,
    remoteCommand: LORA_TRAINER_COMMAND,
    remoteEnvFile: LORA_TRAINER_REMOTE_ENV_FILE,
    remoteLockFile: LORA_TRAINER_SYNC_LOCK_FILE,
    localHash,
  });

  logger.info(
    'lora trainer runner synced remote_script=%s hash=%s',
    remoteScript,
    localHash.slice(0, 12),
  );

  return {
    enabled: true,
    synced: true,
    localHash,
    remoteHash: remoteState.sha || undefined,
    remoteScript,
    reason: 'updated',
  };
}

function resolveLocalScriptPath(): string {
  const configured = LORA_TRAINER_LOCAL_SCRIPT;
  if (path.isAbsolute(configured)) {
    return configured;
  }
  return path.resolve(process.cwd(), configured);
}

function resolveRemoteScriptPath(): string {
  if (LORA_TRAINER_REMOTE_SCRIPT) {
    return LORA_TRAINER_REMOTE_SCRIPT;
  }
  if (LORA_TRAINER_COMMAND.endsWith('.py')) {
    return LORA_TRAINER_COMMAND;
  }
  return `${LORA_TRAINER_COMMAND}.py`;
}

async function readRemoteState(
  remoteScript: string,
  remoteShaPath: string,
  remoteCommand: string,
): Promise<{
  sha: string;
  scriptExists: boolean;
  commandExists: boolean;
}> {
  const output = await runSsh(
    ['sh', '-s', '--', remoteScript, remoteShaPath, remoteCommand],
    [
      'set -eu',
      'script_file="$1"',
      'sha_file="$2"',
      'command_file="$3"',
      'sha=""',
      'if [ -f "$sha_file" ]; then sha="$(cat "$sha_file" 2>/dev/null || true)"; fi',
      'script_exists=0',
      'if [ -f "$script_file" ]; then script_exists=1; fi',
      'command_exists=0',
      'if [ -x "$command_file" ]; then command_exists=1; fi',
      'printf "sha=%s\\nscript=%s\\ncommand=%s\\n" "$sha" "$script_exists" "$command_exists"',
    ].join('\n'),
  );
  const values = Object.fromEntries(
    output.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf('=');
        return index === -1 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
      }),
  );
  return {
    sha: String(values.sha || '').trim(),
    scriptExists: values.script === '1',
    commandExists: values.command === '1',
  };
}

async function prepareRemoteDirectories(remoteScript: string, remoteCommand: string): Promise<void> {
  await runSsh(
    ['sh', '-s', '--', remoteScript, remoteCommand],
    [
      'set -eu',
      'mkdir -p "$(dirname "$1")" "$(dirname "$2")"',
    ].join('\n'),
  );
}

async function installRemoteScript(input: {
  remoteTmp: string;
  remoteScript: string;
  remoteShaTmp: string;
  remoteShaPath: string;
  remoteCommand: string;
  remoteEnvFile: string;
  remoteLockFile: string;
  localHash: string;
}): Promise<void> {
  await runSsh(
    [
      'bash',
      '-s',
      '--',
      input.remoteTmp,
      input.remoteScript,
      input.remoteShaTmp,
      input.remoteShaPath,
      input.remoteCommand,
      input.remoteEnvFile,
      input.remoteLockFile,
      input.localHash,
    ],
    [
      'set -eu',
      'tmp="$1"',
      'target="$2"',
      'sha_tmp="$3"',
      'sha_file="$4"',
      'command_file="$5"',
      'env_file="$6"',
      'lock_file="$7"',
      'hash="$8"',
      'mkdir -p "$(dirname "$lock_file")"',
      '(',
      '  flock 9',
      '  current_sha=""',
      '  if [ -f "$sha_file" ]; then current_sha="$(cat "$sha_file" 2>/dev/null || true)"; fi',
      '  if [ "$current_sha" = "$hash" ] && [ -f "$target" ] && [ -x "$command_file" ]; then',
      '    rm -f "$tmp" "$sha_tmp"',
      '    exit 0',
      '  fi',
      '  chmod +x "$tmp"',
      '  mv "$tmp" "$target"',
      '  printf "%s\\n" "$hash" > "$sha_tmp"',
      '  mv "$sha_tmp" "$sha_file"',
      '  if [ "$command_file" != "$target" ]; then',
      '    wrapper_tmp="${command_file}.tmp.$$"',
      '    {',
      "      echo '#!/usr/bin/env bash'",
      "      echo 'set -euo pipefail'",
      '      printf \'ENV_FILE="${LORA_TRAINER_ENV_FILE:-%s}"\\n\' "$env_file"',
      "      echo 'if [ -f \"$ENV_FILE\" ]; then'",
      "      echo '  set -a'",
      "      echo '  . \"$ENV_FILE\"'",
      "      echo '  set +a'",
      "      echo 'fi'",
      '      printf \'exec /usr/bin/python3 "%s" "$@"\\n\' "$target"',
      '    } > "$wrapper_tmp"',
      '    chmod +x "$wrapper_tmp"',
      '    mv "$wrapper_tmp" "$command_file"',
      '  fi',
      ') 9>"$lock_file"',
    ].join('\n'),
  );
}

async function scpToRemote(localPath: string, remotePath: string): Promise<void> {
  await spawnCollect('scp', [
    '-P',
    String(LORA_TRAINER_SSH_PORT),
    localPath,
    `${LORA_TRAINER_SSH_HOST}:${remotePath}`,
  ]);
}

async function runSsh(args: string[], stdin?: string): Promise<{
  stdout: string;
  stderr: string;
}> {
  return spawnCollect('ssh', [
    '-p',
    String(LORA_TRAINER_SSH_PORT),
    '-o',
    'BatchMode=yes',
    LORA_TRAINER_SSH_HOST,
    ...args,
  ], stdin);
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
        reject(new Error(`${command} failed with exit ${code}: ${stderrText || stdoutText}`.slice(0, 1200)));
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
