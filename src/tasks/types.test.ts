import { expect, test } from 'vitest';

import { isTerminalWorkerTaskStatus, mapWorkerTaskStatusToPublicStatus } from './types.js';

test('mapWorkerTaskStatusToPublicStatus keeps worker lifecycle grouped into public states', () => {
  expect(mapWorkerTaskStatusToPublicStatus('accepted')).toBe('queued');
  expect(mapWorkerTaskStatusToPublicStatus('queued')).toBe('queued');
  expect(mapWorkerTaskStatusToPublicStatus('retry_waiting')).toBe('queued');
  expect(mapWorkerTaskStatusToPublicStatus('running')).toBe('running');
  expect(mapWorkerTaskStatusToPublicStatus('cancel_requested')).toBe('running');
  expect(mapWorkerTaskStatusToPublicStatus('succeeded')).toBe('done');
  expect(mapWorkerTaskStatusToPublicStatus('rejected')).toBe('rejected');
  expect(mapWorkerTaskStatusToPublicStatus('failed')).toBe('failed');
  expect(mapWorkerTaskStatusToPublicStatus('cancelled')).toBe('canceled');
});

test('isTerminalWorkerTaskStatus only marks completed worker outcomes as terminal', () => {
  expect(isTerminalWorkerTaskStatus('accepted')).toBe(false);
  expect(isTerminalWorkerTaskStatus('queued')).toBe(false);
  expect(isTerminalWorkerTaskStatus('retry_waiting')).toBe(false);
  expect(isTerminalWorkerTaskStatus('running')).toBe(false);
  expect(isTerminalWorkerTaskStatus('cancel_requested')).toBe(false);
  expect(isTerminalWorkerTaskStatus('succeeded')).toBe(true);
  expect(isTerminalWorkerTaskStatus('rejected')).toBe(true);
  expect(isTerminalWorkerTaskStatus('failed')).toBe(true);
  expect(isTerminalWorkerTaskStatus('cancelled')).toBe(true);
});
