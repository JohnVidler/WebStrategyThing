import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** Short git hash of the game build: GIT_HASH (Docker builds have no .git) or `git rev-parse`. */
function gitHash(): string {
  if (process.env.GIT_HASH) return process.env.GIT_HASH.trim().slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

/** Git branch of the build: GIT_BRANCH (Docker builds have no .git) or the checked-out branch. */
function gitBranch(): string {
  if (process.env.GIT_BRANCH) return process.env.GIT_BRANCH.trim();
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  define: { __GIT_HASH__: JSON.stringify(gitHash()), __GIT_BRANCH__: JSON.stringify(gitBranch()) },
  server: {
    port: 5173,
    proxy: {
      '/api/v1': { target: 'http://localhost:8080', changeOrigin: true, ws: true },
    },
  },
  build: {
    target: 'es2024',
    // Two pages: the game and the script API docs (opened in a new tab or as an overlay).
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        docs: resolve(import.meta.dirname, 'docs.html'),
      },
    },
  },
});
