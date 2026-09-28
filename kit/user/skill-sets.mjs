// 스킬 세트 관리기: 카탈로그(skill-sets.json)의 세트를 설치·제거하고, 스킬과 플러그인을 켜고 끈다.
// node skill-sets.mjs list
// node skill-sets.mjs add <set|skill>... [--project <dir>] [--force]
// node skill-sets.mjs remove <set|skill>... [--project <dir>]
// node skill-sets.mjs off <set|skill|plugin:<name>|all>...
// node skill-sets.mjs on  <set|skill|plugin:<name>|all>...
// node skill-sets.mjs status [--project <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CLAUDE, USER_SKILLS, USER_SETTINGS, POLICY_DIR, POLICY_FILE, STATE_FILE,
  exists, readJson, writeJson, fwd, estimateTokens, skillsIn, listingText, effectiveMode,
} from './skill-inventory.mjs';

// STATE_FILE — installed: skills this tool copied. disabled / disabledPlugins: what `off` turned off.
const CACHE = path.join(POLICY_DIR, 'cache');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(HERE, 'skill-sets.json');
const log = (msg) => console.log(msg);

const catalog = readJson(CATALOG, { sets: {} }).sets;
const policy = readJson(POLICY_FILE, {});
const state = { installed: [], disabled: [], disabledPlugins: [], ...readJson(STATE_FILE) };
const saveState = () => writeJson(STATE_FILE, state);

function parseArgs(argv) {
  const opts = { names: [], project: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') opts.project = path.resolve(argv[++i]);
    else if (argv[i] === '--force') opts.force = true;
    else opts.names.push(argv[i]);
  }
  return opts;
}

// ---------- catalog lookup ----------

function catalogEntries(names) {
  const entries = [];
  for (const n of names) {
    if (catalog[n]) {
      entries.push(...catalog[n].skills.map((s) => ({ ...s, set: n })));
      continue;
    }
    const found = Object.entries(catalog).flatMap(([set, s]) => s.skills.filter((k) => k.name === n).map((k) => ({ ...k, set })));
    if (!found.length) throw new Error(`'${n}' is not a set or skill in the catalog. See: list`);
    entries.push(found[0]);
  }
  return entries;
}

// Names for on/off: sets and `all` expand to skills this tool installed; anything else is taken as a skill name.
function toggleTargets(names) {
  const skills = new Set();
  const plugins = [];
  for (const n of names) {
    if (n === 'all') state.installed.forEach((i) => skills.add(i.name));
    else if (n.startsWith('plugin:')) plugins.push(n.slice('plugin:'.length));
    else if (catalog[n]) {
      const installed = catalog[n].skills.filter((s) => state.installed.some((i) => i.name === s.name));
      if (!installed.length) log(`note: nothing from set '${n}' is installed`);
      installed.forEach((s) => skills.add(s.name));
    } else if (n.includes(':')) {
      log(`skip '${n}': plugin skills ignore skillOverrides. Toggle the whole plugin instead: plugin:${n.split(':')[0]}`);
    } else skills.add(n);
  }
  return { skills: [...skills], plugins };
}

// ---------- git cache ----------

function git(args, cwd) {
  // Some skills (docx, pptx, xlsx) nest paths past the Windows 260-char limit.
  const r = spawnSync('git', ['-c', 'core.longpaths=true', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.error?.message || '').trim()}`);
  return r.stdout.trim();
}

// Shallow, sparse clone per repo, refreshed on every add.
function syncRepo(repo, paths) {
  const dir = path.join(CACHE, repo.replace('/', '__'));
  if (!exists(dir)) {
    fs.mkdirSync(CACHE, { recursive: true });
    git(['clone', '--quiet', '--depth', '1', '--filter=blob:none', '--sparse', `https://github.com/${repo}.git`, dir]);
  } else {
    git(['fetch', '--quiet', '--depth', '1', 'origin', 'HEAD'], dir);
    git(['reset', '--quiet', '--hard', 'FETCH_HEAD'], dir);
  }
  if (paths.some((p) => !p)) git(['sparse-checkout', 'disable'], dir);
  else git(['sparse-checkout', 'add', ...paths], dir);
  return { dir, commit: git(['rev-parse', '--short', 'HEAD'], dir) };
}

// ---------- settings ----------

function expectedOverride(name) {
  if (state.disabled.includes(name) || policy.offSkills?.includes(name)) return 'off';
  if (policy.manualSkills?.includes(name)) return 'user-invocable-only';
  return undefined;
}

function setSkills(names, on) {
  const settings = readJson(USER_SETTINGS);
  settings.skillOverrides ??= {};
  for (const name of names) {
    state.disabled = state.disabled.filter((n) => n !== name);
    if (!on) state.disabled.push(name);
    const value = expectedOverride(name);
    if (value) settings.skillOverrides[name] = value;
    else delete settings.skillOverrides[name];
    let shown = on ? 'on' : 'off';
    if (on && value === 'off') shown = 'still off (policy.json offSkills)';
    if (on && value === 'user-invocable-only') shown = 'on, /name only (policy.json manualSkills)';
    log(`${name}: ${shown}`);
  }
  if (Object.keys(settings.skillOverrides).length === 0) delete settings.skillOverrides;
  writeJson(USER_SETTINGS, settings);
}

function setPlugins(names, on) {
  const settings = readJson(USER_SETTINGS);
  const installed = Object.keys(readJson(path.join(CLAUDE, 'plugins', 'installed_plugins.json'), { plugins: {} }).plugins);
  const known = [...new Set([...Object.keys(settings.enabledPlugins ?? {}), ...installed])];
  for (const n of names) {
    const ids = known.filter((id) => id === n || id.split('@')[0] === n);
    if (!ids.length) {
      log(`plugin '${n}' not found. Known: ${known.join(', ') || '(none)'}`);
      continue;
    }
    for (const id of ids) {
      (settings.enabledPlugins ??= {})[id] = on;
      state.disabledPlugins = state.disabledPlugins.filter((p) => p !== id);
      if (!on) state.disabledPlugins.push(id);
      log(`plugin ${id}: ${on ? 'on' : 'off'}`);
      if (on && policy.userPlugins?.disable?.includes(id)) log('  note: policy.json disables this plugin; the next session start will ask to turn it off again');
    }
  }
  writeJson(USER_SETTINGS, settings);
}

// ---------- commands ----------

function add({ names, project, force }) {
  if (!names.length) throw new Error('usage: add <set|skill>... [--project <dir>] [--force]');
  if (project && !exists(project)) throw new Error(`${project} does not exist`);
  const target = project ? path.join(project, '.claude', 'skills') : USER_SKILLS;
  const entries = catalogEntries(names);
  const byRepo = groupBy(entries, (e) => e.repo);
  for (const [repo, list] of byRepo) {
    let cache;
    try {
      log(`fetching ${repo} ...`);
      cache = syncRepo(repo, [...new Set(list.map((e) => e.path))]);
    } catch (e) {
      log(`  FAILED: ${e.message}`);
      continue;
    }
    for (const e of list) {
      const src = path.join(cache.dir, e.path);
      const dest = path.join(target, e.name);
      const mine = state.installed.find((i) => i.name === e.name && i.dir === fwd(dest));
      if (!exists(path.join(src, 'SKILL.md'))) {
        log(`  ${e.name}: FAILED, no SKILL.md at ${repo}/${e.path}`);
        continue;
      }
      if (exists(dest) && !force) {
        log(`  ${e.name}: skipped, ${fwd(dest)} exists${mine ? ' (installed; --force updates it)' : ' and was not installed by skill sets (--force overwrites)'}`);
        continue;
      }
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(target, { recursive: true });
      fs.cpSync(src, dest, { recursive: true, filter: (s) => path.basename(s) !== '.git' });
      state.installed = state.installed.filter((i) => i !== mine);
      state.installed.push({ name: e.name, set: e.set, repo, path: e.path, commit: cache.commit, dir: fwd(dest) });
      const other = project ? path.join(USER_SKILLS, e.name) : null;
      log(`  ${e.name}: installed (${e.set})${other && exists(other) ? ' — note: ~/.claude/skills has the same name and wins' : ''}`);
    }
  }
  saveState();
  if (project && exists(path.join(project, '.claude', 'hooks', 'post_edit.py'))) {
    spawnSync('python', [path.join(project, '.claude', 'hooks', 'post_edit.py'), '--sync'], { cwd: project });
  }
  log('Third-party skills can run scripts. Read their SKILL.md before use.');
}

function groupBy(items, key) {
  const m = new Map();
  for (const it of items) m.set(key(it), [...(m.get(key(it)) ?? []), it]);
  return m;
}

function remove({ names, project }) {
  if (!names.length) throw new Error('usage: remove <set|skill>... [--project <dir>]');
  const wanted = new Set(names.flatMap((n) => (n === 'all' ? state.installed.map((i) => i.name) : catalog[n] ? catalog[n].skills.map((s) => s.name) : [n])));
  const where = project ? fwd(path.join(project, '.claude', 'skills')) : null;
  const gone = state.installed.filter((i) => wanted.has(i.name) && (!where || i.dir.startsWith(where + '/')));
  if (!gone.length) log('nothing to remove (only skills installed by `add` can be removed here)');
  for (const i of gone) {
    fs.rmSync(i.dir, { recursive: true, force: true });
    log(`removed ${i.name} (${i.dir})`);
  }
  state.installed = state.installed.filter((i) => !gone.includes(i));
  const leftover = [...new Set(gone.map((i) => i.name))].filter((n) => !state.installed.some((i) => i.name === n) && state.disabled.includes(n));
  if (leftover.length) setSkills(leftover, true);
  saveState();
}

function toggle({ names }, on) {
  if (!names.length) throw new Error(`usage: ${on ? 'on' : 'off'} <set|skill|plugin:<name>|all>...`);
  const { skills, plugins } = toggleTargets(names);
  if (skills.length) setSkills(skills, on);
  if (plugins.length) setPlugins(plugins, on);
  saveState();
  log('Start a new Claude Code session to use the change, and to compare token use fairly (/context, /cost).');
}

function list() {
  for (const [set, s] of Object.entries(catalog)) {
    log(`\n${set} — ${s.description}`);
    for (const k of s.skills) {
      const inst = state.installed.filter((i) => i.name === k.name);
      const where = inst.map((i) => (i.dir.startsWith(fwd(USER_SKILLS)) ? 'user' : i.dir.replace(/\/\.claude\/skills\/.*$/, ''))).join(', ');
      const mark = inst.length ? `[installed: ${where}${state.disabled.includes(k.name) ? ', off' : ''}]` : '';
      log(`  ${k.name.padEnd(28)} ${k.repo}${mark ? '  ' + mark : ''}`);
    }
  }
  log('\nadd <set|skill>... [--project <dir>]   off|on <set|skill|all>   status');
}

// ---------- status: estimated skill listing cost ----------

function status({ project }) {
  const proj = project ?? process.cwd();
  const overrides = {
    ...readJson(USER_SETTINGS).skillOverrides,
    ...readJson(path.join(proj, '.claude', 'settings.json')).skillOverrides,
    ...readJson(path.join(proj, '.claude', 'settings.local.json')).skillOverrides,
  };
  const seen = new Set();
  const rows = [];
  // Personal skills win over project skills of the same name.
  for (const s of [...skillsIn(USER_SKILLS, 'user'), ...skillsIn(path.join(proj, '.claude', 'skills'), 'project')]) {
    const name = s.fm.name || s.dir;
    if (seen.has(name)) continue;
    seen.add(name);
    const mode = effectiveMode(s.fm, overrides[name]);
    const managed = state.installed.find((i) => i.name === name);
    rows.push({ name, scope: s.scope, mode, tokens: estimateTokens(listingText(name, s.fm, mode)), set: managed?.set ?? '' });
  }
  rows.sort((a, b) => b.tokens - a.tokens);
  log(`project: ${fwd(proj)}\n`);
  log(`${'skill'.padEnd(30)}${'scope'.padEnd(9)}${'state'.padEnd(21)}${'~tokens'.padStart(8)}  set`);
  for (const r of rows) log(`${r.name.padEnd(30)}${r.scope.padEnd(9)}${r.mode.padEnd(21)}${String(r.tokens).padStart(8)}  ${r.set}`);
  const visible = rows.filter((r) => r.tokens > 0);
  log(`\nmodel-visible skills: ${visible.length}/${rows.length}, skill listing ≈ ${visible.reduce((a, r) => a + r.tokens, 0)} tokens per request (estimate: ASCII/4 + 1 per Hangul/CJK char)`);
  const setTokens = rows.filter((r) => r.set);
  if (setTokens.length) log(`  of which skill sets: ≈ ${setTokens.reduce((a, r) => a + r.tokens, 0)} tokens`);
  if (state.disabledPlugins.length) log(`plugins turned off: ${state.disabledPlugins.join(', ')}`);
  log('Plugin skills are not counted here. Exact numbers: /context (Skills row) or /skill-doctor inside Claude Code.');
  log('Usage frequency and plugin skills: node ~/.claude/skill-policy/skill-stats.mjs serve (localhost dashboard).');
}

// ---------- main ----------

const [command, ...rest] = process.argv.slice(2);
const opts = parseArgs(rest);
try {
  if (command === 'list') list();
  else if (command === 'add') add(opts);
  else if (command === 'remove') remove(opts);
  else if (command === 'off') toggle(opts, false);
  else if (command === 'on') toggle(opts, true);
  else if (command === 'status') status(opts);
  else {
    log('usage:\n  list\n  add <set|skill>... [--project <dir>] [--force]\n  remove <set|skill|all>... [--project <dir>]\n  off <set|skill|plugin:<name>|all>...\n  on  <set|skill|plugin:<name>|all>...\n  status [--project <dir>]');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
