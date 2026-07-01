import type { CodegenConfig } from '@graphql-codegen/cli';

/**
 * SDK-generation config — `npm run graphql:codegen`.
 *
 * Reads the locally-downloaded SDL (committed by `npm run graphql:schema`) plus
 * the hand-written operation documents under operations/, and emits a typed,
 * client-bound SDK via the graphql-request preset. Offline by design: no network
 * access here, so CI / other agents can regenerate without hitting the server.
 *
 * Output is the generated `getSdk(client)` factory; the runtime wrapper that
 * binds it to a configured client lives in paiPlatformSdk.ts.
 *
 * Per-source naming is deliberate (paiPlatform-prefixed, not generic graphql/sdk
 * names) so a second endpoint can be added side-by-side without colliding.
 * See docs/graphql-sdk.md.
 */
const config: CodegenConfig = {
  overwrite: true,
  generates: {
    'src/platform/graphql/generated/paiPlatform.ts': {
      schema: 'src/platform/graphql/schema/paiPlatform.graphql',
      documents: 'src/platform/graphql/operations/**/*.graphql',
      plugins: ['typescript', 'typescript-operations', 'typescript-graphql-request'],
      config: {
        // NodeNext-friendly: emit plain-string documents instead of a
        // `import gql from 'graphql-tag'` default import, which NodeNext's CJS
        // interop treats as non-callable. Also drops the graphql-tag runtime dep.
        documentMode: 'string',
        rawRequest: false,
        useTypeImports: true,
        scalars: {
          // Map common custom scalars to safe TS types; extend as the schema grows.
          DateTime: 'string',
          Date: 'string',
          JSON: 'unknown',
          JSONString: 'string',
          UUID: 'string',
          Decimal: 'string',
          BigInt: 'string',
        },
      },
    },
  },
};

export default config;
