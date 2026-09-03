import { afterEach, describe, expect, it, vi } from 'vitest';

import { submitModelingJob } from './hunyuan3dClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('submitModelingJob metric policy', () => {
  it('forwards bbox and articulated-height policy to PAILang modeling', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ job_id: 'model-job-1', status_url: '/status/1' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await submitModelingJob({
      viewPaths: { front: '/tmp/front.png' },
      preset: 'standard',
      seed: null,
      maxFaces: null,
      bboxM: [0.6, 0.4, 1.8],
      scalePolicy: 'articulated_height',
    });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.params.bbox_m).toEqual([0.6, 0.4, 1.8]);
    expect(body.params.scale_policy).toBe('articulated_height');
  });
});
