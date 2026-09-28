// 스킬 정책 점검·재적용기. 업그레이드(gstack, 플러그인, npx skills, BrowserOS)로 되돌아간 설정을 찾는다.
// Usage: node skill-policy.mjs          -> SessionStart hook output (silent when compliant)
//        node skill-policy.mjs --check  -> human-readable report
//        node skill-policy.mjs --apply  -> reapply policy
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const USER_SKILLS = path.join(CLAUDE, 'skills');
const USER_SETTINGS = path.join(CLAUDE, 'settings.json');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.join(HERE, 'skill-policy.mjs').replace(/\\/g, '/');
// Windows PowerShell writes UTF-8 with a BOM.
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const POLICY = readJson(path.join(HERE, 'policy.json'));
// Skills turned off with skill-sets.mjs `off`. They must stay "off" even if policy.json says manual.
const STATE_FILE = path.join(HERE, 'state.json');
const DISABLED = fs.existsSync(STATE_FILE) ? readJson(STATE_FILE).disabled ?? [] : [];

const SUPERPOWERS_CACHES = [
  path.join(CLAUDE, 'plugins', 'cache', 'superpowers-dev', 'superpowers'),
  path.join(CLAUDE, 'plugins', 'cache', 'claude-plugins-official', 'superpowers'),
];

const exists = (p) => fs.existsSync(p);
const writeJson = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });

function hasManualFlag(skillMd) {
  const m = fs.readFileSync(skillMd, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return !!m && /^disable-model-invocation:\s*true\s*$/m.test(m[1]);
}

function addManualFlag(skillMd) {
  if (hasManualFlag(skillMd)) return;
  const text = fs.readFileSync(skillMd, 'utf8');
  fs.writeFileSync(skillMd, text.replace(/^(name:.*)$/m, '$1\ndisable-model-invocation: true'));
}

function findLocalSkillSource(name) {
  const candidates = [
    path.join(USER_SKILLS, name, 'SKILL.md'),
    path.join(HOME, '.agents', 'skills', name, 'SKILL.md'),
    ...POLICY.localSkillProjects.map((p) => path.join(p, '.claude', 'skills', name, 'SKILL.md')),
  ];
  return candidates.find(exists);
}

// .agents/skills is where projects mirror .claude/skills for Codex.
const excludeLines = (name) => [`/.claude/skills/${name}/`, `/.agents/skills/${name}/`];

function missingGitExclude(project, name) {
  const exclude = path.join(project, '.git', 'info', 'exclude');
  if (!exists(path.dirname(exclude))) return false;
  const lines = exists(exclude) ? fs.readFileSync(exclude, 'utf8').split(/\r?\n/) : [];
  return !excludeLines(name).every((l) => lines.includes(l));
}

function ensureGitExclude(project, name) {
  const exclude = path.join(project, '.git', 'info', 'exclude');
  if (!exists(path.dirname(exclude))) return;
  for (const line of excludeLines(name)) {
    const current = exists(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    if (!current.split(/\r?\n/).includes(line)) {
      fs.appendFileSync(exclude, (current.endsWith('\n') || current === '' ? '' : '\n') + line + '\n');
    }
  }
}

function collectDrift() {
  const drift = [];

  for (const name of POLICY.offSkills) {
    const dir = path.join(USER_SKILLS, name);
    if (exists(dir)) drift.push({ msg: `'${name}' skill reinstalled in ~/.claude/skills`, fix: () => rm(dir) });
  }

  for (const name of POLICY.localOnlySkills) {
    for (const project of POLICY.localSkillProjects) {
      if (!exists(project)) continue;
      const md = path.join(project, '.claude', 'skills', name, 'SKILL.md');
      if (!exists(md) || !hasManualFlag(md) || missingGitExclude(project, name)) {
        drift.push({
          msg: `'${name}' missing, auto-invocable, or not git-excluded in ${project}`,
          fix: () => {
            if (!exists(md)) {
              const src = findLocalSkillSource(name);
              if (!src) throw new Error(`no source found for ${name}`);
              fs.mkdirSync(path.dirname(md), { recursive: true });
              fs.copyFileSync(src, md);
            }
            addManualFlag(md);
            ensureGitExclude(project, name);
          },
        });
      }
    }
    const globalDir = path.join(USER_SKILLS, name);
    if (POLICY.localSkillProjects.length > 0 && exists(globalDir)) {
      drift.push({ msg: `'${name}' reinstalled globally in ~/.claude/skills`, fix: () => rm(globalDir), last: true });
    }
  }

  if (POLICY.stripSuperpowersBootstrap) {
    for (const cache of SUPERPOWERS_CACHES) {
      if (!exists(cache)) continue;
      const origin = path.basename(path.dirname(cache));
      for (const ver of fs.readdirSync(cache)) {
        const skill = path.join(cache, ver, 'skills', 'using-superpowers');
        const hooks = path.join(cache, ver, 'hooks', 'hooks.json');
        if (exists(skill)) drift.push({ msg: `using-superpowers restored (${origin} ${ver})`, fix: () => rm(skill) });
        if (exists(hooks)) drift.push({ msg: `superpowers SessionStart hook restored (${origin} ${ver})`, fix: () => rm(hooks) });
      }
    }
  }

  const settings = readJson(USER_SETTINGS);
  for (const id of POLICY.userPlugins.disable) {
    if (settings.enabledPlugins?.[id] === true) {
      drift.push({ msg: `${id} re-enabled at user scope`, fix: (s) => { s.user.enabledPlugins[id] = false; } });
    }
  }
  const overrides = settings.skillOverrides ?? {};
  for (const name of [...POLICY.offSkills, ...DISABLED.filter((n) => !POLICY.offSkills.includes(n))]) {
    if (overrides[name] !== 'off') drift.push({ msg: `skillOverrides.${name} is not "off"`, fix: (s) => { (s.user.skillOverrides ??= {})[name] = 'off'; } });
  }
  for (const name of POLICY.manualSkills.filter((n) => !DISABLED.includes(n))) {
    if (overrides[name] !== 'user-invocable-only') {
      drift.push({ msg: `skillOverrides.${name} is not "user-invocable-only"`, fix: (s) => { (s.user.skillOverrides ??= {})[name] = 'user-invocable-only'; } });
    }
  }

  for (const [file, ids] of Object.entries(POLICY.projectPluginRemovals)) {
    if (!exists(file)) continue;
    const ps = readJson(file);
    for (const id of ids) {
      if (ps.enabledPlugins && id in ps.enabledPlugins) {
        drift.push({ msg: `${id} re-added in ${file}`, fix: (s) => { delete s.project(file).enabledPlugins[id]; } });
      }
    }
  }

  return drift;
}

function apply(drift) {
  const projectCache = new Map();
  const ctx = {
    user: readJson(USER_SETTINGS),
    project: (p) => {
      if (!projectCache.has(p)) projectCache.set(p, readJson(p));
      return projectCache.get(p);
    },
  };
  const ordered = [...drift.filter((d) => !d.last), ...drift.filter((d) => d.last)];
  const results = [];
  for (const d of ordered) {
    try {
      d.fix(ctx);
      results.push(`fixed: ${d.msg}`);
    } catch (e) {
      results.push(`FAILED: ${d.msg} (${e.message})`);
    }
  }
  writeJson(USER_SETTINGS, ctx.user);
  for (const [p, obj] of projectCache) writeJson(p, obj);
  return results;
}

const mode = process.argv[2];
const drift = collectDrift();

if (mode === '--apply') {
  console.log(drift.length === 0 ? 'Skill policy already applied. Nothing to do.' : apply(drift).join('\n'));
} else if (mode === '--check') {
  console.log(drift.length === 0 ? 'Skill policy OK.' : drift.map((d) => `- ${d.msg}`).join('\n'));
} else if (drift.length > 0) {
  const list = drift.map((d) => `- ${d.msg}`).join('\n');
  process.stdout.write(JSON.stringify({
    systemMessage: `Skill policy drift detected (${drift.length} item(s)), probably from an upgrade.`,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext:
        `The user's saved skill policy was reverted, most likely by an upgrade (gstack, plugin update, npx skills, or BrowserOS):\n${list}\n\n` +
        `Before starting the user's first request, ask them with AskUserQuestion (in Korean) whether to restore the saved skill settings, listing the items above. ` +
        `If they agree, run: node "${SELF}" --apply  and report the result. If they decline, do not ask again this session.`,
    },
  }));
}
