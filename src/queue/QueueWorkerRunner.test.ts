import { expect, test, vi } from 'vitest';

import { QueueWorker, QueueWorkerExitError } from './QueueWorker.js';
import { QueueWorkerRunner } from './QueueWorkerRunner.js';

function createWorkerStub(runUntilStopped: () => Promise<number>): QueueWorker {
  return {
    runUntilStopped,
    stop: vi.fn(),
  } as unknown as QueueWorker;
}

test('runner restarts the worker loop after a transient driver error', async () => {
  const runUntilStopped = vi
    .fn<() => Promise<number>>()
    .mockRejectedValueOnce(new Error('Socket closed unexpectedly'))
    .mockResolvedValueOnce(0);
  const runner = new QueueWorkerRunner(createWorkerStub(runUntilStopped), {
    recoveryDelayMs: 1,
  });

  const exitCode = await runner.run();

  expect(exitCode).toBe(0);
  expect(runUntilStopped).toHaveBeenCalledTimes(2);
});

test('runner keeps retrying through repeated transient errors until the loop stops cleanly', async () => {
  const runUntilStopped = vi
    .fn<() => Promise<number>>()
    .mockRejectedValueOnce(new Error('read ECONNRESET'))
    .mockRejectedValueOnce(new Error('Socket closed unexpectedly'))
    .mockResolvedValueOnce(0);
  const runner = new QueueWorkerRunner(createWorkerStub(runUntilStopped), {
    recoveryDelayMs: 1,
  });

  const exitCode = await runner.run();

  expect(exitCode).toBe(0);
  expect(runUntilStopped).toHaveBeenCalledTimes(3);
});

test('runner preserves hard-exit semantics for queue worker exit errors', async () => {
  const exitHandler = vi.fn();
  const runUntilStopped = vi
    .fn<() => Promise<number>>()
    .mockRejectedValue(new QueueWorkerExitError('job timed out', 7, true, 300));
  const runner = new QueueWorkerRunner(createWorkerStub(runUntilStopped), {
    exitHandler,
    recoveryDelayMs: 1,
  });

  const exitCode = await runner.run();

  expect(exitCode).toBe(7);
  expect(runUntilStopped).toHaveBeenCalledTimes(1);
  expect(exitHandler).toHaveBeenCalledWith(7);
});
