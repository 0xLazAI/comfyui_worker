# PAI Platform GraphQL SDK

This worker talks to the PAI Platform GraphQL API through a **codegen-generated,
fully-typed SDK**. You never hand-write GraphQL requests or response types — you
run two scripts and call typed methods.

This document is the source of truth for *how the generation pipeline works* and
*how to extend it*. If you are an agent modifying this area, read this first.

> Scope: this is **tooling + a runtime client only**. Wiring the SDK into the
> worker's functional flows (registration, heartbeat, PACE, assets, jobs) is a
> separate, deliberate follow-up — see [Migration notes](#migration-notes).

## TL;DR

```bash
# 1. Pull the live SDL from the endpoint (the only networked step)
npm run graphql:schema

# 2. Derive an operation document for every query & mutation
npm run graphql:operations

# 3. Generate the typed SDK from the local SDL + operations (offline)
npm run graphql:codegen

# …or all three at once:
npm run graphql:generate
```

Then call it:

```ts
import { paiPlatformSdk } from '../platform/graphql/paiPlatformSdk.js';

const { viewer } = await paiPlatformSdk.viewer_query({});
const result = await paiPlatformSdk.heartbeatWorker_mutation({
  workerName: 'comfyui-render-worker',
  input: { /* typed */ },
});
```

## Configuration

| Env | Purpose |
| --- | --- |
| `PAI_PLATFORM_GRAPH` | GraphQL endpoint, e.g. `https://pai-api-test.lazai.io/api/graphql/`. Used by `graphql:schema` (codegen) **and** the runtime client. |
| `PAI_PLATFORM_API_KEY` | Sent as `x-api-key` (and bearer fallback), reusing the REST client's credentials. |
| `PAI_PLATFORM_BEARER_TOKEN` | Sent as `Authorization: Bearer …`. |

`PAI_PLATFORM_GRAPH` is read in [`src/infra/constants.ts`](../src/infra/constants.ts) as
`PAI_PLATFORM_GRAPH` / `PAI_PLATFORM_GRAPH_ENABLED`. Keep the trailing slash the server publishes.

## Pipeline & layout

```
codegen.schema.ts                       # config: introspect PAI_PLATFORM_GRAPH → SDL (networked)
codegen.ts                              # config: SDL + operations → typed SDK (offline)
scripts/generateGraphqlOperations.mjs   # derives one operation doc per root field
src/platform/graphql/
  schema/paiPlatform.graphql            # downloaded SDL (committed)
  operations/
    generated/{query,mutation}/*.graphql  # auto, rebuilt each run — DO NOT EDIT
    custom/                               # hand-written operations (never auto-touched)
  generated/paiPlatform.ts              # codegen output: types + getSdk (committed, DO NOT EDIT)
  paiPlatformSdk.ts                     # runtime wrapper: client + bound SDK singleton
```

The three steps are intentionally separate:

1. **`graphql:schema`** is the *only* step that touches the network. It writes
   the SDL to disk so everything downstream is reproducible and offline.
2. **`graphql:operations`** turns the SDL into one operation document per root
   field using `@graphql-tools/utils` `buildOperationNodeForField`. This is why
   the SDK covers **all** queries and mutations without anyone hand-writing 41
   `.graphql` files. Each document is validated against the schema; if a field's
   default selection collides (e.g. duplicate variable names on deeply nested
   same-named args), the generator automatically retries at a shallower depth and
   notes the reduction in the file header. Truly ungeneratable fields are skipped
   with a warning rather than breaking the build.
3. **`graphql:codegen`** reads the local SDL + every operation document and emits
   the typed SDK via `@graphql-codegen/typescript-graphql-request`.

Generated artifacts (`schema/*.graphql`, `operations/generated/**`,
`generated/paiPlatform.ts`) are **committed** so CI and other agents don't need
network access to build. Regenerate whenever the schema changes.

## The runtime client (`paiPlatformSdk.ts`)

- `paiPlatformSdk` — a lazily-initialized, shared, typed SDK singleton. Importing
  the module is side-effect-free; the client is built on first call. Missing
  `PAI_PLATFORM_GRAPH` throws `PaiGraphqlConfigError` only when you actually call.
- `createPaiPlatformSdk(options)` — build a fresh SDK (override endpoint/headers,
  or inject a client for tests).
- `createPaiPlatformGraphqlClient(options)` — the underlying `graphql-request`
  client, if you need raw access.
- `isPaiGraphqlEnabled()` — `true` when `PAI_PLATFORM_GRAPH` is set; use to gate optional
  GraphQL paths.

Auth headers mirror the REST [`paiPlatformClient`](../src/platform/paiPlatformClient.ts).
The client is pinned to Node's native `fetch` (undici) because graphql-request
v6's bundled cross-fetch fails the TLS handshake against the PAI host.

### Method naming

Generated methods are `<field>_<kind>`, e.g. `viewer_query`,
`heartbeatWorker_mutation`. The `_query` / `_mutation` suffix comes from the
operation generator and prevents a query and mutation of the same field name
from colliding.

## Adding / changing operations

- **Schema changed upstream?** `npm run graphql:generate` and commit the diff.
- **Want a custom, hand-tuned selection set?** Add a `.graphql` file under
  `operations/custom/` and re-run `npm run graphql:codegen`. Files there are
  never overwritten by the operation generator.
- **Don't edit** anything under `operations/generated/**` or
  `generated/paiPlatform.ts` — your changes will be wiped on the next run.

## Adding a second GraphQL endpoint

Naming is deliberately per-source (`paiPlatform*`), never a generic `graphqlSdk`,
so a second API can live side-by-side. To add one (call it `acme`):

1. Add `ACME_GRAPH` to `src/infra/constants.ts` and `.env.example`.
2. In `codegen.schema.ts`, add a second `generates` entry →
   `src/platform/graphql/schema/acme.graphql`.
3. In `scripts/generateGraphqlOperations.mjs`, parametrize the schema/output
   paths (or add a sibling script) for `acme`.
4. In `codegen.ts`, add a `generates` entry →
   `src/platform/graphql/generated/acme.ts`.
5. Add `src/platform/graphql/acmeSdk.ts` modeled on `paiPlatformSdk.ts`.

## Migration notes

The worker currently calls the platform over REST via
[`src/platform/paiPlatformClient.ts`](../src/platform/paiPlatformClient.ts)
(register / heartbeat / PACE / assets). The GraphQL schema exposes equivalents
(`registerWorker`, `heartbeatWorker`, `readPaceFiles`/`writePaceFiles` ⇢
`paceFile`/`writePaceFiles`, `assetUrl`, …). Moving functional flows onto the
GraphQL SDK is intentionally **out of scope** for the initial tooling change;
do it deliberately, behind tests, when ready.
