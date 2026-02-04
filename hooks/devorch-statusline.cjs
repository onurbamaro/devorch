#!/usr/bin/env node
// devorch statusline for Claude Code
// Shows: model | current task | phase progress | directory | context usage

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const model = data.model?.display_name || 'Claude';
    const dir = data.workspace?.current_dir || process.cwd();
    const session = data.session_id || '';
    const remaining = data.context_window?.remaining_percentage;

    const dirname = path.basename(dir);
    const parts = [];

    // Model (dim)
    parts.push(`\x1b[2m${model}\x1b[0m`);

    // Active task from todos
    const task = getActiveTask(session);
    if (task) {
      parts.push(`\x1b[1m${task}\x1b[0m`);
    }

    // Phase progress from .devorch/state.md
    const phase = getPhaseProgress(dir);
    if (phase) {
      parts.push(phase);
    }

    // Directory (dim)
    parts.push(`\x1b[2m${dirname}\x1b[0m`);

    // Context bar
    const ctx = contextBar(remaining);
    if (ctx) {
      parts.push(ctx);
    }

    process.stdout.write(parts.join(' \x1b[2m|\x1b[0m '));
  } catch (e) {
    // silent fail
  }
});

function getActiveTask(session) {
  try {
    const homeDir = require('os').homedir();
    const todosDir = path.join(homeDir, '.claude', 'todos');
    if (!session || !fs.existsSync(todosDir)) return null;

    const files = fs.readdirSync(todosDir)
      .filter(f => f.startsWith(session) && f.includes('-agent-') && f.endsWith('.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(todosDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;

    const todos = JSON.parse(fs.readFileSync(path.join(todosDir, files[0].name), 'utf8'));
    const active = todos.find(t => t.status === 'in_progress');
    return active ? (active.activeForm || active.subject || null) : null;
  } catch (e) {
    return null;
  }
}

function getPhaseProgress(dir) {
  try {
    const statePath = path.join(dir, '.devorch', 'state.md');
    if (!fs.existsSync(statePath)) return null;

    const content = fs.readFileSync(statePath, 'utf8');

    const lastMatch = content.match(/Last completed phase:\s*(\d+)/i);
    const last = lastMatch ? parseInt(lastMatch[1], 10) : 0;

    // Count total phases from the plan
    const planMatch = content.match(/Plan:\s*(.+)/i);
    let total = 0;
    if (planMatch) {
      const planPath = path.join(dir, planMatch[1].trim());
      if (fs.existsSync(planPath)) {
        const plan = fs.readFileSync(planPath, 'utf8');
        const phases = plan.match(/^##\s+Phase\s+\d+/gim);
        if (phases) total = phases.length;
      }
    }

    const statusMatch = content.match(/Status:\s*(.+)/i);
    const status = statusMatch ? statusMatch[1].trim().toLowerCase() : '';

    if (total > 0) {
      const pct = Math.round((last / total) * 100);
      const filled = Math.floor(pct / 10);
      const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);

      if (status.includes('complete') || status.includes('done')) {
        return `\x1b[32m${bar} ${last}/${total}\x1b[0m`;
      } else if (last === 0) {
        return `\x1b[2m${bar} 0/${total}\x1b[0m`;
      } else {
        return `\x1b[36m${bar} ${last}/${total}\x1b[0m`;
      }
    } else if (last > 0) {
      return `\x1b[36mphase ${last}\x1b[0m`;
    }

    return null;
  } catch (e) {
    return null;
  }
}

function contextBar(remaining) {
  if (remaining == null) return null;

  const rem = Math.round(remaining);
  const rawUsed = Math.max(0, Math.min(100, 100 - rem));
  // Scale to 80% limit (Claude Code caps at 80%)
  const used = Math.min(100, Math.round((rawUsed / 80) * 100));

  const filled = Math.floor(used / 10);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);

  if (used < 60) {
    return `\x1b[32m${bar} ${used}%\x1b[0m`;
  } else if (used < 80) {
    return `\x1b[33m${bar} ${used}%\x1b[0m`;
  } else if (used < 95) {
    return `\x1b[38;5;208m${bar} ${used}%\x1b[0m`;
  } else {
    return `\x1b[5;31m${bar} ${used}%\x1b[0m`;
  }
}
