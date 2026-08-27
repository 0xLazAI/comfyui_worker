import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../infra/logger.js', () => ({ logger: { warn: vi.fn() } }));
vi.mock('../platform/paiPlatformClient.js', () => {
  class MockPaiPlatformApiError extends Error {
    code: string;

    constructor(message: string, _statusCode = 409, code = 'pai_platform_request_failed') {
      super(message);
      this.code = code;
    }
  }
  return {
    PaiPlatformApiError: MockPaiPlatformApiError,
    paiPlatformClient: {
      isEnabled: vi.fn(),
      readPaceProjectRevision: vi.fn(),
      measureEntityDimensions: vi.fn(),
    },
  };
});

import {
  PaiPlatformApiError,
  paiPlatformClient,
} from '../platform/paiPlatformClient.js';
import { initializeGeneratedModelPlacement } from './threeView3dTaskExecution.js';

const input = {
  projectId: 'project-1',
  entityKind: 'prop' as const,
  entityId: 'prop_stage',
  versionId: 'asset_take_1',
  contentHash: 'a'.repeat(64),
};

const enabled = paiPlatformClient.isEnabled as unknown as ReturnType<typeof vi.fn>;
const revision = paiPlatformClient.readPaceProjectRevision as unknown as ReturnType<typeof vi.fn>;
const measure = paiPlatformClient.measureEntityDimensions as unknown as ReturnType<typeof vi.fn>;

describe('initializeGeneratedModelPlacement', () => {
  beforeEach(() => {
    enabled.mockReset();
    revision.mockReset();
    measure.mockReset();
  });

  it('does not make a Platform call when Platform integration is disabled', async () => {
    enabled.mockReturnValue(false);

    await expect(initializeGeneratedModelPlacement(input)).resolves.toEqual({
      status: 'not_configured',
    });
    expect(revision).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
  });

  it('initializes anchors against the newly registered model identity', async () => {
    enabled.mockReturnValue(true);
    revision.mockResolvedValue('revision-1');
    measure.mockResolvedValue({
      snapshotRevision: 'revision-2',
      changedPaths: ['entities/props.json'],
      affectedShotIds: ['hs001_sh001'],
      payload: {},
    });

    await expect(initializeGeneratedModelPlacement(input)).resolves.toEqual({
      status: 'initialized',
      revision: 'revision-2',
      changedPaths: ['entities/props.json'],
    });
    expect(measure).toHaveBeenCalledWith({
      ...input,
      expectedRevision: 'revision-1',
      initializeSupportAnchors: true,
    });
  });

  it('retries once when a concurrent PACE write makes the revision stale', async () => {
    enabled.mockReturnValue(true);
    revision.mockResolvedValueOnce('revision-1').mockResolvedValueOnce('revision-2');
    measure
      .mockRejectedValueOnce(
        new PaiPlatformApiError('stale', 409, 'pace_object_revision_stale'),
      )
      .mockResolvedValueOnce({
        snapshotRevision: 'revision-3',
        changedPaths: [],
        affectedShotIds: [],
        payload: {},
      });

    await expect(initializeGeneratedModelPlacement(input)).resolves.toMatchObject({
      status: 'initialized',
      revision: 'revision-3',
    });
    expect(revision).toHaveBeenCalledTimes(2);
    expect(measure).toHaveBeenNthCalledWith(2, {
      ...input,
      expectedRevision: 'revision-2',
      initializeSupportAnchors: true,
    });
  });

  it('preserves the completed model and reports a retryable pending state on failure', async () => {
    enabled.mockReturnValue(true);
    revision.mockResolvedValue('revision-1');
    measure.mockRejectedValue(new Error('Platform unavailable'));

    await expect(initializeGeneratedModelPlacement(input)).resolves.toEqual({
      status: 'pending',
      code: 'support_anchor_initialization_failed',
      message: 'Platform unavailable',
    });
  });
});
