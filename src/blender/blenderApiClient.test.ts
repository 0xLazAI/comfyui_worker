import { afterEach, expect, test, vi } from 'vitest';

const BASE_REQUEST = {
  task_id: 'task_123',
  workflow: 'blender-create-3d',
  project_id: 'project_456',
  scene_id: 'scene_001',
  shot_id: 'shot_010',
  model_id: 'model_abc',
  pace: {
    schema_version: 'pace-1',
    scene: {
      scene_id: 'scene_001',
      shot_id: 'shot_010',
    },
  },
  script: 'import bpy\nbpy.ops.object.select_all()\n',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.BLENDER_API_BASE_URL;
  delete process.env.BLENDER_API_TOKEN;
  delete process.env.BLENDER_API_POLL_INTERVAL_SECONDS;
  delete process.env.BLENDER_API_TIMEOUT_SECONDS;
});

test('submitBlenderRun posts to the blender api runs endpoint with a json body', async () => {
  process.env.BLENDER_API_BASE_URL = 'http://127.0.0.1:3030';

  const fetchMock = vi.fn().mockResolvedValue(
    jsonResponse({
      run_id: 'run_123',
      status: 'queued',
      status_url: '/runs/run_123',
    }, 202),
  );
  vi.stubGlobal('fetch', fetchMock);

  const { submitBlenderRun } = await import('./blenderApiClient.js');
  const result = await submitBlenderRun(BASE_REQUEST);

  expect(result).toEqual({
    run_id: 'run_123',
    status: 'queued',
    status_url: '/runs/run_123',
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
  expect(String(url)).toBe('http://127.0.0.1:3030/runs');
  expect(init.method).toBe('POST');
  expect(headerValue(init.headers, 'content-type')).toBe('application/json');
  expect(JSON.parse(String(init.body))).toEqual(BASE_REQUEST);
});

test('submitBlenderRun sends a bearer token when configured', async () => {
  process.env.BLENDER_API_BASE_URL = 'http://127.0.0.1:3030';
  process.env.BLENDER_API_TOKEN = 'test-token';

  const fetchMock = vi.fn().mockResolvedValue(
    jsonResponse({
      run_id: 'run_123',
      status: 'queued',
      status_url: '/runs/run_123',
    }, 202),
  );
  vi.stubGlobal('fetch', fetchMock);

  const { submitBlenderRun } = await import('./blenderApiClient.js');
  await submitBlenderRun(BASE_REQUEST);

  const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
  expect(headerValue(init.headers, 'authorization')).toBe('Bearer test-token');
});

test('submitBlenderRun maps 4xx responses to TaskRejectedError', async () => {
  process.env.BLENDER_API_BASE_URL = 'http://127.0.0.1:3030';

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse({ detail: 'invalid workflow' }, 422)),
  );

  const { submitBlenderRun } = await import('./blenderApiClient.js');
  const error = await captureError(() => submitBlenderRun(BASE_REQUEST));

  expect(error.constructor.name).toBe('TaskRejectedError');
  expect(error).toMatchObject({
    code: 'provider_rejected',
  });
  expect(error.message).toBe('invalid workflow');
});

test('submitBlenderRun maps 5xx responses to ProviderRequestError', async () => {
  process.env.BLENDER_API_BASE_URL = 'http://127.0.0.1:3030';

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse({ error: 'backend unavailable' }, 503)),
  );

  const { submitBlenderRun } = await import('./blenderApiClient.js');
  const error = await captureError(() => submitBlenderRun(BASE_REQUEST));

  expect(error.constructor.name).toBe('ProviderRequestError');
  expect(error).toMatchObject({
    statusCode: 503,
    code: 'provider_submit_failed',
  });
  expect(error.message).toBe('backend unavailable');
});

test('pollBlenderRunUntilTerminal stops when the run succeeds', async () => {
  process.env.BLENDER_API_BASE_URL = 'http://127.0.0.1:3030';
  process.env.BLENDER_API_POLL_INTERVAL_SECONDS = '3';
  process.env.BLENDER_API_TIMEOUT_SECONDS = '900';

  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ run_id: 'run_123', status: 'queued' }))
    .mockResolvedValueOnce(jsonResponse({ run_id: 'run_123', status: 'running' }))
    .mockResolvedValueOnce(
      jsonResponse({
        run_id: 'run_123',
        status: 'succeeded',
        artifacts: [{ artifact_id: 'artifact_001', filename: 'scene.blend', content_type: 'application/x-blender' }],
      }),
    );
  const sleep = vi.fn().mockResolvedValue(undefined);
  const onUpdate = vi.fn();

  vi.stubGlobal('fetch', fetchMock);

  const { pollBlenderRunUntilTerminal, setBlenderApiClientTestOverridesForTests } = await import('./blenderApiClient.js');
  setBlenderApiClientTestOverridesForTests({
    now: sequenceNow([0, 1_000, 2_000]),
    sleep,
  });

  const status = await pollBlenderRunUntilTerminal({ run_id: 'run_123', status_url: '/runs/run_123' }, onUpdate);

  expect(status).toMatchObject({
    run_id: 'run_123',
    status: 'succeeded',
  });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(sleep).toHaveBeenCalledTimes(2);
  expect(onUpdate).toHaveBeenCalledTimes(3);

  setBlenderApiClientTestOverridesForTests(undefined);
});

test('pollBlenderRunUntilTerminal rejects an absolute external status_url before fetching', async () => {
  process.env.BLENDER_API_BASE_URL = 'http://127.0.0.1:3030';

  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const { pollBlenderRunUntilTerminal } = await import('./blenderApiClient.js');
  const error = await captureError(() =>
    pollBlenderRunUntilTerminal({
      run_id: 'run_123',
      status_url: 'https://evil.example/runs/run_123',
    }),
  );

  expect(fetchMock).not.toHaveBeenCalled();
  expect(error.constructor.name).toBe('ProviderRequestError');
  expect(error).toMatchObject({
    statusCode: 502,
    code: 'provider_status_url_rejected',
    detail: {
      run_id: 'run_123',
      status_url: 'https://evil.example/runs/run_123',
    },
  });
});

test('pollBlenderRunUntilTerminal rejects a protocol-relative external status_url before fetching', async () => {
  process.env.BLENDER_API_BASE_URL = 'http://127.0.0.1:3030';

  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const { pollBlenderRunUntilTerminal } = await import('./blenderApiClient.js');
  const error = await captureError(() =>
    pollBlenderRunUntilTerminal({
      run_id: 'run_456',
      status_url: '//169.254.169.254/latest/meta-data',
    }),
  );

  expect(fetchMock).not.toHaveBeenCalled();
  expect(error.constructor.name).toBe('ProviderRequestError');
  expect(error).toMatchObject({
    statusCode: 502,
    code: 'provider_status_url_rejected',
    detail: {
      run_id: 'run_456',
      status_url: '//169.254.169.254/latest/meta-data',
    },
  });
});

test('pollBlenderRunUntilTerminal maps 4xx status responses to TaskRejectedError', async () => {
  process.env.BLENDER_API_BASE_URL = 'http://127.0.0.1:3030';

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse({ detail: 'run not found' }, 404)),
  );

  const { pollBlenderRunUntilTerminal } = await import('./blenderApiClient.js');
  const error = await captureError(() => pollBlenderRunUntilTerminal('run_404'));

  expect(error.constructor.name).toBe('TaskRejectedError');
  expect(error).toMatchObject({
    code: 'provider_status_rejected',
  });
  expect(error.message).toBe('run not found');
});

test('pollBlenderRunUntilTerminal maps 5xx status responses to ProviderRequestError', async () => {
  process.env.BLENDER_API_BASE_URL = 'http://127.0.0.1:3030';

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse({ error: 'status backend down' }, 502)),
  );

  const { pollBlenderRunUntilTerminal } = await import('./blenderApiClient.js');
  const error = await captureError(() => pollBlenderRunUntilTerminal('run_502'));

  expect(error.constructor.name).toBe('ProviderRequestError');
  expect(error).toMatchObject({
    statusCode: 502,
    code: 'provider_status_failed',
  });
  expect(error.message).toBe('status backend down');
});

test('pollBlenderRunUntilTerminal throws ProviderRequestError when the run fails', async () => {
  process.env.BLENDER_API_BASE_URL = 'http://127.0.0.1:3030';

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      jsonResponse({
        run_id: 'run_failed',
        status: 'failed',
        error: 'Blender crashed during bake',
      }),
    ),
  );

  const { pollBlenderRunUntilTerminal } = await import('./blenderApiClient.js');
  const error = await captureError(() => pollBlenderRunUntilTerminal('run_failed'));

  expect(error.constructor.name).toBe('ProviderRequestError');
  expect(error).toMatchObject({
    code: 'provider_run_failed',
    detail: {
      run_id: 'run_failed',
      status: 'failed',
      error: 'Blender crashed during bake',
    },
  });
  expect(error.message).toBe('Blender crashed during bake');
});

test('pollBlenderRunUntilTerminal throws TaskRejectedError when the run is rejected', async () => {
  process.env.BLENDER_API_BASE_URL = 'http://127.0.0.1:3030';

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      jsonResponse({
        run_id: 'run_rejected',
        status: 'rejected',
        error: 'Prompt is not allowed',
      }),
    ),
  );

  const { pollBlenderRunUntilTerminal } = await import('./blenderApiClient.js');
  const error = await captureError(() => pollBlenderRunUntilTerminal('run_rejected'));

  expect(error.constructor.name).toBe('TaskRejectedError');
  expect(error).toMatchObject({
    code: 'provider_rejected',
  });
  expect(error.message).toBe('Prompt is not allowed');
});

test('pollBlenderRunUntilTerminal times out on non-terminal statuses without real waiting', async () => {
  process.env.BLENDER_API_BASE_URL = 'http://127.0.0.1:3030';
  process.env.BLENDER_API_POLL_INTERVAL_SECONDS = '3';
  process.env.BLENDER_API_TIMEOUT_SECONDS = '5';

  const fetchMock = vi.fn().mockResolvedValue(
    jsonResponse({
      run_id: 'run_timeout',
      status: 'running',
    }),
  );
  const sleep = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', fetchMock);

  const { pollBlenderRunUntilTerminal, setBlenderApiClientTestOverridesForTests } = await import('./blenderApiClient.js');
  setBlenderApiClientTestOverridesForTests({
    now: sequenceNow([0, 5_000]),
    sleep,
  });

  const error = await captureError(() => pollBlenderRunUntilTerminal('run_timeout'));

  expect(error.constructor.name).toBe('ProviderRequestError');
  expect(error).toMatchObject({
    statusCode: 504,
    code: 'provider_poll_timeout',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();

  setBlenderApiClientTestOverridesForTests(undefined);
});

test('downloadBlenderRunArtifact downloads bytes and returns metadata', async () => {
  process.env.BLENDER_API_BASE_URL = 'http://127.0.0.1:3030';

  const fetchMock = vi.fn().mockResolvedValue(
    new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
      },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const { downloadBlenderRunArtifact } = await import('./blenderApiClient.js');
  const result = await downloadBlenderRunArtifact('run_123', {
    artifact_id: 'artifact_001',
    filename: 'scene-assets.zip',
    content_type: 'application/octet-stream',
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url] = fetchMock.mock.calls[0] as [URL];
  expect(String(url)).toBe('http://127.0.0.1:3030/runs/run_123/artifacts/artifact_001');
  expect(result.contentType).toBe('application/zip');
  expect(result.filename).toBe('scene-assets.zip');
  expect([...result.buffer]).toEqual([1, 2, 3, 4]);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function headerValue(headers: HeadersInit | undefined, key: string): string | null {
  return new Headers(headers).get(key);
}

function sequenceNow(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

async function captureError(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Expected promise to reject');
}
