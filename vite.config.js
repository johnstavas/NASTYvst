import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { writeFileSync, copyFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
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

// Dev-only middleware: POST /__dev/save-ledger writes the request body
// (a verification ledger JSON) to public/verification_ledger.json. This is
// how the QC view's "Save" button persists in-browser Listen ticks back to
// disk so they survive a page reload. Backs up the previous ledger to
// verification_ledger.bak.json before overwriting.
function saveLedgerPlugin() {
  return {
    name: 'save-ledger',
    configureServer(server) {
      const ledgerPath = resolve(server.config.root, 'public/verification_ledger.json');
      const backupPath = resolve(server.config.root, 'public/verification_ledger.bak.json');

      server.middlewares.use('/__dev/save-ledger', (req, res, next) => {
        if (req.method !== 'POST') { next(); return; }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (!parsed || !Array.isArray(parsed.ops)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: 'expected { ops: [...] }' }));
              return;
            }
            // Backup the existing ledger before overwriting.
            if (existsSync(ledgerPath)) {
              try { copyFileSync(ledgerPath, backupPath); } catch {}
            }
            // ── MONOTONIC MERGE ────────────────────────────────────
            // Read disk's current ledger and merge it WITH the incoming
            // POST. Auto-gates (worklet/cpp/smoke/t1_t7/parity/behavioral)
            // can only go false→true, never true→false. This protects
            // generator-only gate promotions (e.g. when generate_verification_
            // ledger.mjs picks up new behavioral specs) from being
            // clobbered by a stale-browser-state Save.
            // Listen gate is the only one the UI is allowed to write
            // independently — it can be set or cleared by the user.
            let merged = parsed;
            if (existsSync(ledgerPath)) {
              try {
                const onDisk = JSON.parse(readFileSync(ledgerPath, 'utf8'));
                if (onDisk && Array.isArray(onDisk.ops)) {
                  const diskById = new Map(onDisk.ops.map(o => [o.id, o]));
                  merged = {
                    ...parsed,
                    ops: parsed.ops.map(incoming => {
                      const onDiskOp = diskById.get(incoming.id);
                      if (!onDiskOp) return incoming;
                      const dg = onDiskOp.gates || {};
                      const ig = incoming.gates || {};
                      const auto = ['worklet','cpp','smoke','t1_t7','parity','behavioral'];
                      const mergedGates = { ...ig };
                      for (const k of auto) {
                        // Monotonic: keep whichever side is true.
                        mergedGates[k] = !!(dg[k] || ig[k]);
                      }
                      // Listen gate is UI-authoritative — incoming wins.
                      mergedGates.listen = ig.listen ?? null;
                      // Recompute autoPassed from merged gates.
                      const autoPassed = auto.filter(k => mergedGates[k]).length;
                      return { ...incoming, gates: mergedGates, autoPassed };
                    }),
                  };
                }
              } catch (err) {
                // If merge fails, fall back to parsed-as-is so a corrupt
                // disk file doesn't block saves.
                console.warn('[save-ledger] merge failed, writing as-is:', err.message);
              }
            }
            // Stamp savedAt so we can tell live writes from generator writes.
            const out = { ...merged, savedAt: new Date().toISOString() };
            writeFileSync(ledgerPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              ok: true,
              path: 'public/verification_ledger.json',
              backup: 'public/verification_ledger.bak.json',
              savedAt: out.savedAt,
              opCount: out.ops.length,
            }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), saveLedgerPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__:   JSON.stringify(gitSha() + (gitDirty() ? '-dirty' : '')),
    __BUILD_TIME__:  JSON.stringify(new Date().toISOString()),
  },
});
