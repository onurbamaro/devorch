#!/usr/bin/env node
// devorch statusline for Claude Code
// Shows: project name (bold) | context usage bar

const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const dir = data.workspace?.current_dir || process.cwd();
    const remaining = data.context_window?.remaining_percentage;

    const dirname = path.basename(dir);
    const parts = [];

    // Project name (bold bright white)
    parts.push(`\x1b[1;97m${dirname}\x1b[0m`);

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
