/**
 * PAI Platform GraphQL SDK — runtime entry point.
 *
 * Binds the codegen-generated, fully-typed `getSdk` factory (generated/) to a
 * `graphql-request` client pointed at the platform GraphQL endpoint (derived from
 * PAI_PLATFORM_API_BASE as <base>/api/graphql/), so callers can invoke any
 * query/mutation with end-to-end types:
 *
 *   import { paiPlatformSdk } from '../platform/graphql/paiPlatformSdk.js';
 *   const { viewer_query } = paiPlatformSdk;
 *   const { viewer } = await viewer_query({ ... });
 *
 * The SDK is built lazily on first use (a Proxy), so merely importing this module
 * never throws when the platform base is unset — only an actual call does, with a
 * clear message. Auth reuses the same platform credentials as the REST client.
 *
 * Naming note: this file is intentionally per-source (`paiPlatform`), not a
 * generic `graphqlSdk`. A second GraphQL endpoint gets its own
 * `<source>Sdk.ts` + generated module rather than overloading this one.
 * See docs/graphql-sdk.md.
 */
import { GraphQLClient } from 'graphql-request';
import { PAI_PLATFORM_GRAPH, PAI_PLATFORM_GRAPH_ENABLED, PLATFORM_API_KEY } from '../../infra/constants.js';
import { getSdk, type Sdk } from './generated/paiPlatform.js';

export class PaiGraphqlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaiGraphqlConfigError';
  }
}

export interface CreatePaiPlatformSdkOptions {
  /** Override the endpoint (defaults to the derived platform GraphQL endpoint). */
  endpoint?: string;
  /** Extra request headers merged over the credential-derived defaults. */
  headers?: Record<string, string>;
  /** Inject a pre-built client (tests, alternate transport). */
  client?: GraphQLClient;
}

/** Build the credential headers, mirroring the REST paiPlatformClient. */
function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (PLATFORM_API_KEY) {
    headers['x-api-key'] = PLATFORM_API_KEY;
  }
  if (PLATFORM_API_KEY) {
    headers.authorization = `Bearer ${PLATFORM_API_KEY}`;
  }
  return { ...headers, ...extra };
}

/** Build a graphql-request client bound to the configured endpoint. */
export function createPaiPlatformGraphqlClient(options: CreatePaiPlatformSdkOptions = {}): GraphQLClient {
  const endpoint = options.endpoint || PAI_PLATFORM_GRAPH;
  if (!endpoint) {
    throw new PaiGraphqlConfigError('PAI Platform GraphQL endpoint is not configured — set PAI_PLATFORM_API_BASE (the endpoint is derived as <base>/api/graphql/).');
  }
  return new GraphQLClient(endpoint, {
    headers: buildHeaders(options.headers),
    // Force Node's native fetch (undici). graphql-request v6 otherwise falls back
    // to bundled cross-fetch/node-fetch, which fails the TLS handshake to the PAI
    // host ("socket disconnected before secure TLS connection").
    fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  });
}

/** Build a fresh, fully-typed SDK. Prefer the shared `paiPlatformSdk` singleton. */
export function createPaiPlatformSdk(options: CreatePaiPlatformSdkOptions = {}): Sdk {
  const client = options.client || createPaiPlatformGraphqlClient(options);
  return getSdk(client);
}

/** True when the platform GraphQL endpoint is configured; lets callers skip GraphQL paths. */
export function isPaiGraphqlEnabled(): boolean {
  return PAI_PLATFORM_GRAPH_ENABLED;
}

let cachedSdk: Sdk | undefined;

function resolveSdk(): Sdk {
  if (!cachedSdk) {
    cachedSdk = createPaiPlatformSdk();
  }
  return cachedSdk;
}

/** Reset the memoized singleton (tests). */
export function resetPaiPlatformSdkForTests(): void {
  cachedSdk = undefined;
}

/**
 * Lazily-initialized shared SDK. Accessing any operation builds the client on
 * first use, so importing this module is always side-effect-free.
 */
export const paiPlatformSdk: Sdk = new Proxy({} as Sdk, {
  get(_target, property, receiver) {
    const sdk = resolveSdk();
    const value = Reflect.get(sdk as object, property, receiver);
    return typeof value === 'function' ? value.bind(sdk) : value;
  },
}) as Sdk;
