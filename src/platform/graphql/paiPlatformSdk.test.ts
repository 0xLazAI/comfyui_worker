import { describe, expect, it, vi } from 'vitest';
import { GraphQLClient } from 'graphql-request';
import {
  createPaiPlatformGraphqlClient,
  createPaiPlatformSdk,
  isPaiGraphqlEnabled,
  PaiGraphqlConfigError,
} from './paiPlatformSdk.js';

describe('paiPlatformSdk', () => {
  it('derives disabled + throws a config error when the platform base is unset (test env)', () => {
    // vitest sets PAI_PLATFORM_API_BASE='' so the derived GraphQL endpoint is empty.
    expect(isPaiGraphqlEnabled()).toBe(false);
    expect(() => createPaiPlatformGraphqlClient()).toThrow(PaiGraphqlConfigError);
  });

  it('builds a client bound to an explicit endpoint', () => {
    const client = createPaiPlatformGraphqlClient({ endpoint: 'https://example.test/graphql' });
    expect(client).toBeInstanceOf(GraphQLClient);
  });

  it('builds an SDK from an injected client without resolving an endpoint', () => {
    // Passing a client skips createPaiPlatformGraphqlClient entirely, so no
    // PAI_PLATFORM_GRAPH lookup happens — useful for tests and alternate transports.
    const fakeClient = { request: vi.fn() } as unknown as GraphQLClient;
    expect(() => createPaiPlatformSdk({ client: fakeClient })).not.toThrow();
  });

  it('routes generated SDK calls through the injected client', async () => {
    const request = vi.fn().mockResolvedValue({ viewer: { id: 'u1' } });
    const fakeClient = { request } as unknown as GraphQLClient;

    const sdk = createPaiPlatformSdk({ client: fakeClient });
    const result = await sdk.viewer_query({});

    expect(result).toEqual({ viewer: { id: 'u1' } });
    expect(request).toHaveBeenCalledTimes(1);
    const arg = request.mock.calls[0][0];
    expect(String(arg.document)).toContain('query viewer_query');
  });

  it('exports a typed config error class', () => {
    const error = new PaiGraphqlConfigError('boom');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PaiGraphqlConfigError');
  });
});
