import 'dotenv/config';
import type { CodegenConfig } from '@graphql-codegen/cli';

/**
 * Schema-pull config — `npm run graphql:schema`.
 *
 * Introspects the live PAI Platform GraphQL endpoint (PAI_PLATFORM_API_BASE +
 * /api/graphql/) and writes the SDL to disk. This is the *only* step that touches
 * the network; SDK generation (codegen.ts) then runs fully offline against the SDL.
 */
const base = process.env.PAI_PLATFORM_API_BASE;
if (!base) {
  throw new Error('PAI_PLATFORM_API_BASE is not set — add it to .env before pulling the schema.');
}
const endpoint = `${base.replace(/\/+$/, '')}/api/graphql/`;

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
