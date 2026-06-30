import { afterEach, expect, test, vi } from 'vitest';

import { EXPORT_EPILOGUE_BEGIN_MARKER } from './exportEpilogue.js';

const ONLINE_BASE_URL = 'http://127.0.0.1:8911';

const BASE_REQUEST = {
  task_id: 'task_123',
  workflow: 'blender-create-3d',
  project_id: 'project_456',
  scene_id: 'scene_001',
  shot_id: 'shot_010',
  model_id: 'model_abc',
  script: 'import bpy\nbpy.ops.object.select_all()\n',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.PAI_BLENDER_ONLINE_BASE_URL;
  delete process.env.PAI_BLENDER_JOB_TIMEOUT_SECONDS;
  delete process.env.PAI_BLENDER_POLL_INTERVAL_SECONDS;
  delete process.env.PAI_BLENDER_POLL_TIMEOUT_SECONDS;
});

test('submitBlenderRun posts a script export job and maps job_id to run_id', async () => {
  process.env.PAI_BLENDER_ONLINE_BASE_URL = ONLINE_BASE_URL;
  process.env.PAI_BLENDER_JOB_TIMEOUT_SECONDS = '600';

  const fetchMock = vi.fn().mockResolvedValue(
    jsonResponse({ job_id: 'job_123', status: 'submitted', status_url: '/api/blender/jobs/job_123' }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const { submitBlenderRun } = await import('./blenderApiClient.js');
  const result = await submitBlenderRun(BASE_REQUEST);

  expect(result).toMatchObject({
    run_id: 'job_123',
    status: 'queued',
    pailang_base_url: ONLINE_BASE_URL,
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
  expect(String(url)).toBe(`${ONLINE_BASE_URL}/api/blender/jobs/export`);
  expect(init.method).toBe('POST');

  const body = JSON.parse(String(init.body));
  expect(body).toMatchObject({ input_format: 'script', output_format: 'glb', timeout: 600 });
  const decoded = Buffer.from(body.script_b64, 'base64').toString('utf-8');
  expect(decoded.startsWith(BASE_REQUEST.script)).toBe(true);
  expect(decoded).toContain(EXPORT_EPILOGUE_BEGIN_MARKER);
  expect(decoded).toContain('export_scene.gltf');
});

test('submitBlenderRun maps 4xx responses to TaskRejectedError', async () => {
  process.env.PAI_BLENDER_ONLINE_BASE_URL = ONLINE_BASE_URL;

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'invalid input_format' }, 400)));

  const { submitBlenderRun } = await import('./blenderApiClient.js');
  const error = await captureError(() => submitBlenderRun(BASE_REQUEST));

  expect(error.constructor.name).toBe('TaskRejectedError');
  expect(error).toMatchObject({ code: 'provider_rejected' });
  expect(error.message).toBe('invalid input_format');
});

test('submitBlenderRun maps 5xx responses to ProviderRequestError', async () => {
  process.env.PAI_BLENDER_ONLINE_BASE_URL = ONLINE_BASE_URL;

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'backend unavailable' }, 503)));

  const { submitBlenderRun } = await import('./blenderApiClient.js');
  const error = await captureError(() => submitBlenderRun(BASE_REQUEST));

  expect(error.constructor.name).toBe('ProviderRequestError');
  expect(error).toMatchObject({ statusCode: 503, code: 'provider_submit_failed' });
});

test('pollBlenderRunUntilTerminal maps done -> succeeded and synthesizes the glb artifact', async () => {
  process.env.PAI_BLENDER_ONLINE_BASE_URL = ONLINE_BASE_URL;
  process.env.PAI_BLENDER_POLL_INTERVAL_SECONDS = '3';
  process.env.PAI_BLENDER_POLL_TIMEOUT_SECONDS = '900';

  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ job_id: 'job_123', status: 'running' }))
    .mockResolvedValueOnce(jsonResponse({ job_id: 'job_123', status: 'done', output_url: '/api/blender/jobs/job_123/output' }));
  const sleep = vi.fn().mockResolvedValue(undefined);
  const onUpdate = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const { pollBlenderRunUntilTerminal, setBlenderApiClientTestOverridesForTests } = await import('./blenderApiClient.js');
  setBlenderApiClientTestOverridesForTests({ now: sequenceNow([0, 1_000]), sleep });

  const status = await pollBlenderRunUntilTerminal(
    { run_id: 'job_123', status_url: '/api/blender/jobs/job_123', pailang_base_url: ONLINE_BASE_URL },
    onUpdate,
  );

  expect(status).toMatchObject({ run_id: 'job_123', status: 'succeeded' });
  expect(status.artifacts).toEqual([
    { artifact_id: 'model_glb', filename: 'model.glb', content_type: 'model/gltf-binary' },
  ]);
  const [statusUrl] = fetchMock.mock.calls[0] as [URL];
  expect(String(statusUrl)).toBe(`${ONLINE_BASE_URL}/api/blender/jobs/job_123`);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledTimes(1);
  expect(onUpdate).toHaveBeenCalledTimes(2);

  setBlenderApiClientTestOverridesForTests(undefined);
});

test('pollBlenderRunUntilTerminal throws ProviderRequestError when the job fails', async () => {
  process.env.PAI_BLENDER_ONLINE_BASE_URL = ONLINE_BASE_URL;

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse({ job_id: 'job_failed', status: 'failed', error: 'blender rc=1, no output' })),
  );

  const { pollBlenderRunUntilTerminal } = await import('./blenderApiClient.js');
  const error = await captureError(() => pollBlenderRunUntilTerminal('job_failed'));

  expect(error.constructor.name).toBe('ProviderRequestError');
  expect(error).toMatchObject({ code: 'provider_run_failed' });
  expect(error.message).toBe('blender rc=1, no output');
});

test('pollBlenderRunUntilTerminal times out on non-terminal statuses without real waiting', async () => {
  process.env.PAI_BLENDER_ONLINE_BASE_URL = ONLINE_BASE_URL;
  process.env.PAI_BLENDER_POLL_INTERVAL_SECONDS = '3';
  process.env.PAI_BLENDER_POLL_TIMEOUT_SECONDS = '5';

  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ job_id: 'job_timeout', status: 'running' }));
  const sleep = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', fetchMock);

  const { pollBlenderRunUntilTerminal, setBlenderApiClientTestOverridesForTests } = await import('./blenderApiClient.js');
  setBlenderApiClientTestOverridesForTests({ now: sequenceNow([0, 5_000]), sleep });

  const error = await captureError(() => pollBlenderRunUntilTerminal('job_timeout'));

  expect(error.constructor.name).toBe('ProviderRequestError');
  expect(error).toMatchObject({ statusCode: 504, code: 'provider_poll_timeout' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();

  setBlenderApiClientTestOverridesForTests(undefined);
});

test('downloadBlenderRunArtifact downloads the single job output', async () => {
  process.env.PAI_BLENDER_ONLINE_BASE_URL = ONLINE_BASE_URL;

  const fetchMock = vi.fn().mockResolvedValue(
    new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'model/gltf-binary' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const { downloadBlenderRunArtifact } = await import('./blenderApiClient.js');
  const result = await downloadBlenderRunArtifact(
    'job_123',
    { artifact_id: 'model_glb', filename: 'model.glb', content_type: 'model/gltf-binary' },
    { baseUrl: ONLINE_BASE_URL },
  );

  const [url] = fetchMock.mock.calls[0] as [URL];
  expect(String(url)).toBe(`${ONLINE_BASE_URL}/api/blender/jobs/job_123/output`);
  expect(result.contentType).toBe('model/gltf-binary');
  expect(result.filename).toBe('model.glb');
  expect([...result.buffer]).toEqual([1, 2, 3, 4]);
});

test('fetchBlenderRunLogs returns [] because PAILang exposes no logs endpoint', async () => {
  const { fetchBlenderRunLogs } = await import('./blenderApiClient.js');
  await expect(fetchBlenderRunLogs('job_123')).resolves.toEqual([]);
});

test('submitBlenderRunBatch posts all scripts as one batch and returns per-job ids', async () => {
  process.env.PAI_BLENDER_ONLINE_BASE_URL = ONLINE_BASE_URL;
  process.env.PAI_BLENDER_JOB_TIMEOUT_SECONDS = '600';

  const fetchMock = vi.fn().mockResolvedValue(
    jsonResponse({
      batch_id: 'batch_1',
      job_count: 2,
      jobs: [
        { job_id: 'job_a', status_url: '/api/blender/jobs/job_a', output_url: '/api/blender/jobs/job_a/output' },
        { job_id: 'job_b', status_url: '/api/blender/jobs/job_b', output_url: '/api/blender/jobs/job_b/output' },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const { submitBlenderRunBatch } = await import('./blenderApiClient.js');
  const result = await submitBlenderRunBatch([{ script: 'import bpy # a\n' }, { script: 'import bpy # b\n' }]);

  expect(result.batch_id).toBe('batch_1');
  expect(result.jobs.map((job) => job.run_id)).toEqual(['job_a', 'job_b']);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
  expect(url.pathname).toBe('/api/blender/jobs/export/batch');
  const body = JSON.parse(String(init.body)) as { jobs: Array<{ input_format: string; script_b64: string }> };
  expect(body.jobs).toHaveLength(2);
  expect(body.jobs[0].input_format).toBe('script');
  // The GLB export epilogue is appended before base64 encoding, same as the single path.
  const decoded = Buffer.from(body.jobs[0].script_b64, 'base64').toString('utf-8');
  expect(decoded).toContain(EXPORT_EPILOGUE_BEGIN_MARKER);
});

test('pollBlenderBatchUntilTerminal polls until no job is still running (done + failed)', async () => {
  process.env.PAI_BLENDER_ONLINE_BASE_URL = ONLINE_BASE_URL;

  const running = jsonResponse({
    batch_id: 'batch_1',
    status: 'running',
    jobs: [
      { job_id: 'job_a', status: 'running', error: null },
      { job_id: 'job_b', status: 'running', error: null },
    ],
  });
  const terminal = jsonResponse({
    batch_id: 'batch_1',
    status: 'partial',
    jobs: [
      { job_id: 'job_a', status: 'done', error: null },
      { job_id: 'job_b', status: 'failed', error: 'boom' },
    ],
  });
  const fetchMock = vi.fn().mockResolvedValueOnce(running).mockResolvedValueOnce(terminal);
  vi.stubGlobal('fetch', fetchMock);

  const { pollBlenderBatchUntilTerminal, setBlenderApiClientTestOverridesForTests } = await import('./blenderApiClient.js');
  setBlenderApiClientTestOverridesForTests({ now: sequenceNow([0, 1_000, 2_000]), sleep: async () => {} });
  try {
    const status = await pollBlenderBatchUntilTerminal('batch_1', ONLINE_BASE_URL);
    expect(status.status).toBe('partial');
    expect(status.jobs.map((job) => `${job.run_id}:${job.status}`)).toEqual(['job_a:succeeded', 'job_b:failed']);
    expect(status.jobs[1].error).toBe('boom');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.pathname).toBe('/api/blender/jobs/batch/batch_1');
  } finally {
    setBlenderApiClientTestOverridesForTests(undefined);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
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
