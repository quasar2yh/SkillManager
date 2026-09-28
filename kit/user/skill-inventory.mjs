// 스킬 목록과 토큰 추정: skill-sets.mjs(status)와 skill-stats.mjs(대시보드)가 함께 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const HOME = os.homedir();
export const CLAUDE = path.join(HOME, '.claude');
export const USER_SKILLS = path.join(CLAUDE, 'skills');
export const USER_SETTINGS = path.join(CLAUDE, 'settings.json');
export const POLICY_DIR = path.join(CLAUDE, 'skill-policy');
export const POLICY_FILE = path.join(POLICY_DIR, 'policy.json');
export const STATE_FILE = path.join(POLICY_DIR, 'state.json');
export const PLUGINS_FILE = path.join(CLAUDE, 'plugins', 'installed_plugins.json');
// Claude Code truncates description + when_to_use at this length in the skill listing.
export const DESC_CAP = 1536;

export const exists = (p) => fs.existsSync(p);
// Windows PowerShell writes UTF-8 with a BOM.
export const readJson = (p, fallback = {}) => (exists(p) ? JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) : fallback);
export const writeJson = (p, obj) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
};
export const fwd = (p) => p.replace(/\\/g, '/');
// Paths compared case-insensitively: transcripts write `e:\...` and `E:\...` for the same folder.
export const samePath = (a, b) => !!a && !!b && fwd(a).replace(/\/$/, '').toLowerCase() === fwd(b).replace(/\/$/, '').toLowerCase();

// About 4 ASCII chars per token, and about 1 token per Hangul/CJK char. Use --exact for real counts.
export function estimateTokens(text) {
  let ascii = 0;
  let other = 0;
  for (const ch of text) (ch.charCodeAt(0) < 128 ? ascii++ : other++);
  return Math.ceil(ascii / 4 + other);
}

export function parseSkillMd(skillMd) {
  const text = fs.readFileSync(skillMd, 'utf8').replace(/^﻿/, '');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const fm = {};
  if (!m) return { fm, body: text };
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^[|>][-+]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1] === '')) block.push(lines[++i].trim());
      value = block.join(' ').trim();
    }
    fm[kv[1]] = value.replace(/^(["'])([\s\S]*)\1$/, '$2');
  }
  return { fm, body: text.slice(m[0].length) };
}

// Installers like `npx skills` link skill folders (symlinks, or junctions on Windows); exists() follows them.
export function skillsIn(dir, scope) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && exists(path.join(dir, d.name, 'SKILL.md')))
    .map((d) => ({ dir: d.name, scope, path: fwd(path.join(dir, d.name)), ...parseSkillMd(path.join(dir, d.name, 'SKILL.md')) }));
}

// What the model sees in the skill listing on every request.
export function listingText(name, fm, mode) {
  if (mode === 'on') return `${name}: ${`${fm.description ?? ''} ${fm.when_to_use ?? ''}`.trim().slice(0, DESC_CAP)}`;
  if (mode === 'name-only') return name;
  return '';
}

export function effectiveMode(fm, override) {
  const mode = override ?? 'on';
  if (fm['disable-model-invocation'] === 'true' && mode !== 'off') return 'user-invocable-only';
  return mode;
}
