// src/qc-harness/knowledge/earLessonsFlag.js
//
// Knowledge Phase B gate — feature flag for rendering Ear Lessons in the
// Repair Drawer / QcStrip.
//
// Phase A (invisible plumbing) attaches `knowledgeId` + `knowledgeSource`
// to every finding unconditionally. Phase B turns on the render path for
// dogfooding on the ManChild hot path. Phase C (future) adds the
// searchable drawer.
//
// Default: OFF. We keep this off in production until the knowledge pack
// has been verified end-to-end against a real ManChild audit. Flipping
// this to true (or setting VITE_ENABLE_EAR_LESSONS=true in .env.local)
// renders the Ear Lesson beside the active finding in the repair UI.
//
// DO NOT read this flag to decide whether to attach knowledgeId to a
// finding. That attachment is always done. This flag ONLY gates render.

/**
 * Effective runtime value.
 *   - In Vite builds, VITE_ENABLE_EAR_LESSONS=true flips it on via env.
 *   - In Node/tests, process.env.ENABLE_EAR_LESSONS can flip it.
 *   - Otherwise defaults to false.
 */
function readFlag() {
  try {
    // eslint-disable-next-line no-undef
    const viteEnv = typeof import.meta !== 'undefined' ? import.meta.env : null;
    if (viteEnv && String(viteEnv.VITE_ENABLE_EAR_LESSONS).toLowerCase() === 'true') {
      return true;
    }
  } catch {
    // import.meta not available — ignore.
  }
  try {
    if (typeof process !== 'undefined' && process.env
        && String(process.env.ENABLE_EAR_LESSONS).toLowerCase() === 'true') {
      return true;
    }
  } catch {
    // process not available — ignore.
  }
  return false;
}

export const ENABLE_EAR_LESSONS = readFlag();

/**
 * Test helper — re-read the environment. Do not use in production paths.
 */
export function __refreshEarLessonsFlag() {
  return readFlag();
}
