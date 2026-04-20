import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import pkg from './package.json' assert { type: 'json' };

// Bake build identity into the bundle so the QC harness (and anything else)
// can display exactly which commit + build time is loaded. Reach for this
// whenever you need to confirm "is my browser actually on the latest code."
function gitSha() {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return 'nogit'; }
}
function gitDirty() {
  try { return execSync('git status --porcelain').toString().trim().length > 0; }
  catch { return false; }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__:   JSON.stringify(gitSha() + (gitDirty() ? '-dirty' : '')),
    __BUILD_TIME__:  JSON.stringify(new Date().toISOString()),
  },
});
