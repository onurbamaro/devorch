# Satellite-repo builder cannot find phase-init detail in primary worktree's cache

**Timestamp**: 2026-04-28
**Severity**: nit

## Prompt
/devorch "in init-phase.ts, when the plan declares <secondary-repos> with satellite tasks, ALSO write a copy (or a symlink) of each satellite-task's detail file into the satellite worktree's `.devorch/cache/phase-init-N/<task-id>.md`. Currently the orchestrator passes an absolute path pointing into the PRIMARY worktree's cache (e.g., `/home/bruno/dev/dochron-mobile/.worktrees/<name>/.devorch/cache/phase-init-1/<task-id>.md`), but builders assigned to a satellite (Repo: <satellite-name>) have their Working directory set to `/home/bruno/dev/dochron/.worktrees/<name>/` and treat that absolute path as 'outside my workspace'. Result: builder reports 'Cache gaps: phase-init-N cache directory mentioned in the prompt didn't exist' and falls back to grepping for the spec elements in source. The build still succeeds because the orchestrator's curated explore findings + spec body cover the gap, but the curated phase context is silently underused. Either copy the detail files into the satellite worktree, OR have init-phase.ts emit a single JSON manifest with all detail-file paths and a note that they're shared."

## Context

- **Where**: Step 9c dispatch of a satellite-repo builder task (e.g., `Repo: dochron` in a multi-repo plan).
- **What happened**: Wave 3's `backend-feature-flag` task ran inside `/home/bruno/dev/dochron/.worktrees/classifier-divergence-observability/`. The orchestrator's prompt included `Read /home/bruno/dev/dochron-mobile/.worktrees/.../cache/phase-init-1/backend-feature-flag.md`. Builder reported "phase-init-1 cache directory mentioned in the prompt didn't exist; only `.devorch/GOTCHAS.md` and two e2e flag files were present" — it had searched its local working tree (the satellite worktree's `.devorch/cache/`) instead of resolving the absolute path. Builder fell back to grepping source (e.g., for T3's classifyTrack call) which worked but cost an extra exploration round.
- **Expected**: Builder receives the curated phase context regardless of repo assignment. Either (a) duplicate the detail file into both worktrees during `setup-worktree.ts --add-secondary` + `init-phase.ts`, (b) emit absolute paths the builder is explicitly told to read with the Read tool (current behavior — still failed), or (c) inline the detail content in the builder prompt rather than referencing it by path.
- **Workaround**: None needed for build success — builders are resilient enough to reconstruct context from grep + curated explore findings. But the curated cache file is silently underused for ~1 task per multi-repo phase.
