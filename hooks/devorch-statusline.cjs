#!/usr/bin/env node
// devorch statusline for Claude Code
// Shows: project name | model | effort | context usage bar

const path = require('path');
const fs = require('fs');
const os = require('os');

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

    // Model name (cyan, short form)
    const modelName = shortModel(data.model?.display_name || data.model?.id);
    if (modelName) {
      parts.push(`\x1b[36m${modelName}\x1b[0m`);
    }

    // Effort level (yellow for high, dim for others)
    const effort = getEffort(data);
    if (effort) {
      const effortColor = effort === 'high' ? '33' : '2;37';
      parts.push(`\x1b[${effortColor}m${effort}\x1b[0m`);
    }

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

function shortModel(name) {
  if (!name) return null;
  // "Claude Opus 4.6 (1M context)" -> "Opus 4.6 1M"
  // "Claude Sonnet 4.6" -> "Sonnet 4.6"
  let short = name.replace(/^Claude\s+/i, '');
  const ctxMatch = short.match(/\((\d+[KkMm])\s*context\)/);
  short = short.replace(/\s*\(.*?\)/, '');
  if (ctxMatch) short += ' ' + ctxMatch[1];
  return short;
}

function getEffort(data) {
  // Try from stdin JSON first
  if (data.effortLevel) return data.effortLevel;
  if (data.effort_level) return data.effort_level;
  // Fallback: read from settings.json
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return settings.effortLevel || null;
  } catch {
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
