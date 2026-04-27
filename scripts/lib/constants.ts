/**
 * Shared constants used by multiple scripts.
 */

// mtime threshold (ms) for considering `.devorch/cache/project-map.md` fresh.
// Read by setup-worktree.ts (cache pre-warm) and init-phase.ts (resume-path fallback).
export const CACHE_FRESHNESS_MS = 5 * 60 * 1000;
