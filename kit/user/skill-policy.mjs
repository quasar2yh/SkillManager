// 스킬 정책 점검·재적용기. 업그레이드(gstack, 플러그인, npx skills, BrowserOS)나 /skills 화면처럼 대시보드 밖에서
// 바뀐 설정을 찾는다. 호출 방식은 모든 에이전트의 설정을 기준값(policy.json의 modes)과 비교한다(skill-modes.mjs).
// Usage: node skill-policy.mjs          -> SessionStart hook output (silent when compliant)
//        node skill-policy.mjs --check  -> human-readable report
//        node skill-policy.mjs --apply  -> put the baseline back
//        node skill-policy.mjs --adopt  -> keep the current invocation settings and write them into the baseline
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadPolicy, modeDrift, driftChanges, planChanges, writePlan } from './skill-modes.mjs';

const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const USER_SKILLS = path.join(CLAUDE, 'skills');
const USER_SETTINGS = path.join(CLAUDE, 'settings.json');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.join(HERE, 'skill-policy.mjs').replace(/\\/g, '/');
// Windows PowerShell writes UTF-8 with a BOM.
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
// Moves a v1 policy (manualSkills / offSkills) to v2 on first read.
const POLICY = loadPolicy();

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

// Everything except invocation modes: reinstalled folders, local-only skills, the superpowers bootstrap, plugins.
function collectDrift() {
  const drift = [];

  for (const name of POLICY.removeIfReinstalled) {
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

  const settings = exists(USER_SETTINGS) ? readJson(USER_SETTINGS) : {};
  for (const id of POLICY.userPlugins.disable ?? []) {
    if (settings.enabledPlugins?.[id] === true) {
      drift.push({ msg: `${id} re-enabled at user scope`, fix: (s) => { s.user.enabledPlugins[id] = false; s.userTouched = true; } });
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

const MODE_WORD = { auto: 'auto', manual: 'manual only', off: 'off', 'name-only': 'name only' };
const modeMsg = (d) => `${d.label}: '${d.key.replace(/^path:/, '')}' is ${MODE_WORD[d.have] ?? d.have ?? 'not set'}, baseline says ${MODE_WORD[d.want] ?? d.want}`
  + (d.layer === 'mine' ? ` (only-me exception in ${d.project})` : '');

function apply(drift) {
  const projectCache = new Map();
  const ctx = {
    user: exists(USER_SETTINGS) ? readJson(USER_SETTINGS) : {},
    userTouched: false,
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
  if (ctx.userTouched) writeJson(USER_SETTINGS, ctx.user);
  for (const [p, obj] of projectCache) writeJson(p, obj);
  return results;
}

// Mode drift goes through skill-modes.mjs, which writes each agent's own format and backs files up.
function applyModes(modes, kind) {
  if (!modes.length) return [];
  try {
    writePlan(planChanges(driftChanges(modes, kind)));
    return modes.map((d) => `${kind === 'adopt' ? 'adopted' : 'fixed'}: ${modeMsg(d)}`);
  } catch (e) {
    return [`FAILED: invocation settings (${e.file ? `${e.file}: ` : ''}${e.message})`];
  }
}

const mode = process.argv[2];
const drift = collectDrift();
const modes = modeDrift(POLICY);
const count = drift.length + modes.length;

if (mode === '--apply') {
  // Other fixes first: they rewrite settings.json from what they read, and skill-modes.mjs reads it again after.
  const out = [...(drift.length ? apply(drift) : []), ...applyModes(modes, 'revert')];
  console.log(count === 0 ? 'Skill policy already applied. Nothing to do.' : out.join('\n'));
} else if (mode === '--adopt') {
  const out = applyModes(modes, 'adopt');
  if (drift.length) out.push(`not changed (only --apply fixes these):\n${drift.map((d) => `- ${d.msg}`).join('\n')}`);
  console.log(count === 0 ? 'Skill policy OK. Nothing to adopt.' : out.join('\n'));
} else if (mode === '--check') {
  console.log(count === 0 ? 'Skill policy OK.' : [...drift.map((d) => `- ${d.msg}`), ...modes.map((d) => `- ${modeMsg(d)}`)].join('\n'));
} else if (count > 0) {
  const list = [...drift.map((d) => `- ${d.msg}`), ...modes.map((d) => `- ${modeMsg(d)}`)].join('\n');
  const adopt = modes.length
    ? ` If they want to keep the current invocation settings instead, run: node "${SELF}" --adopt  (it only takes the invocation items into the baseline; the other items stay as they are).`
    : '';
  process.stdout.write(JSON.stringify({
    systemMessage: `Skill settings differ from your baseline (${count} item(s)), probably from an upgrade or a change outside the dashboard.`,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext:
        `The user's saved skill baseline (~/.claude/skill-policy/policy.json) and the current settings differ, most likely after an upgrade ` +
        `(gstack, plugin update, npx skills, BrowserOS) or a change made in an agent's /skills screen:\n${list}\n\n` +
        `Before starting the user's first request, ask them with AskUserQuestion (in Korean) what to do, listing the items above. ` +
        `To put the baseline back, run: node "${SELF}" --apply  and report the result.${adopt} ` +
        'If they decline, do not ask again this session.',
    },
  }));
}
