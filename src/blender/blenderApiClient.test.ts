import { afterEach, expect, test, vi } from 'vitest';

import { EXPORT_EPILOGUE_BEGIN_MARKER } from './exportEpilogue.js';

const ONLINE_BASE_URL = 'http://127.0.0.1:8911';
const LOCAL_BASE_URL = 'http://127.0.0.1:3002';

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
  delete process.env.PAI_BLENDER_LOCAL_BASE_URL;
  delete process.env.PAI_BLENDER_JOB_TIMEOUT_SECONDS;
  delete process.env.BLENDER_API_POLL_INTERVAL_SECONDS;
  delete process.env.BLENDER_API_TIMEOUT_SECONDS;
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

test('submitBlenderRun routes runner_target=local to the local console mock', async () => {
  process.env.PAI_BLENDER_ONLINE_BASE_URL = ONLINE_BASE_URL;
  process.env.PAI_BLENDER_LOCAL_BASE_URL = LOCAL_BASE_URL;

  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ job_id: 'job_local', status: 'submitted' }));
  vi.stubGlobal('fetch', fetchMock);

  const { submitBlenderRun } = await import('./blenderApiClient.js');
  const result = await submitBlenderRun({ ...BASE_REQUEST, runner_target: 'local' });

  const [url] = fetchMock.mock.calls[0] as [URL];
  expect(String(url)).toBe(`${LOCAL_BASE_URL}/api/blender/jobs/export`);
  expect(result.pailang_base_url).toBe(LOCAL_BASE_URL);
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
  process.env.BLENDER_API_POLL_INTERVAL_SECONDS = '3';
  process.env.BLENDER_API_TIMEOUT_SECONDS = '900';

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
  process.env.BLENDER_API_POLL_INTERVAL_SECONDS = '3';
  process.env.BLENDER_API_TIMEOUT_SECONDS = '5';

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
