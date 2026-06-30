import 'dotenv/config';
import type { CodegenConfig } from '@graphql-codegen/cli';

/**
 * Schema-pull config — `npm run graphql:schema`.
 *
 * Introspects the live PAI Platform GraphQL endpoint (PAI_PLATFORM_GRAPH) and writes the
 * SDL to disk. This is the *only* step that touches the network; SDK generation
 * (codegen.ts) then runs fully offline against the downloaded SDL.
 *
 * Adding a second GraphQL source later: give it its own `PAI_<NAME>_GRAPH` env,
 * a sibling `schema/<name>.graphql` output, and a matching block in codegen.ts.
 */
const endpoint = process.env.PAI_PLATFORM_GRAPH;
if (!endpoint) {
  throw new Error('PAI_PLATFORM_GRAPH is not set — add it to .env before pulling the schema.');
}

const config: CodegenConfig = {
  overwrite: true,
  schema: endpoint,
  generates: {
    'src/platform/graphql/schema/paiPlatform.graphql': {
      plugins: ['schema-ast'],
      config: {
        includeDirectives: true,
      },
    },
  },
};

export default config;
