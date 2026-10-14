import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

/**
 * Populates process.env from .env files. Import this before anything that
 * reads configuration -- in practice, as the first import of src/index.ts.
 *
 * The backend is an npm workspace at <repo>/web/backend, so a plain
 * `import 'dotenv/config'` would look only in web/backend and miss the
 * repository-root .env where the Shopify CLI and docker-compose values live.
 * Both src/ and dist/ sit one level below the package directory, so the same
 * relative walk works under tsx and from the compiled build.
 *
 * Existing variables are never overwritten: whatever `shopify app dev` or CI
 * injects takes precedence over the file on disk.
 */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(moduleDir, '..', '..');
const repoRoot = path.resolve(packageDir, '..', '..');

loadDotenv({
  // Earlier entries win, so a backend-local .env can override the shared one.
  path: [path.join(packageDir, '.env'), path.join(repoRoot, '.env')],
  quiet: true,
});
