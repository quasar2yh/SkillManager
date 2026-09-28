// 프로젝트 템플릿 설치기: 사용자 범위 스킬 정책과 프로젝트 작업 흐름 키트를 적용한다.
// node setup.mjs user [--local-project <dir>]...        PC마다 한 번
// node setup.mjs project <dir> [--gitlab] [--expo] [--frontend] [--force]
// node setup.mjs check
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.join(ROOT, 'kit');
const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const USER_SETTINGS = path.join(CLAUDE, 'settings.json');
const POLICY_DIR = path.join(CLAUDE, 'skill-policy');
const POLICY_SCRIPT = path.join(POLICY_DIR, 'skill-policy.mjs');
const POLICY_FILE = path.join(POLICY_DIR, 'policy.json');

const exists = (p) => fs.existsSync(p);
// Windows PowerShell writes UTF-8 with a BOM.
const readJson = (p, fallback = {}) => (exists(p) ? JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) : fallback);
const writeJson = (p, obj) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
};
const fwd = (p) => p.replace(/\\/g, '/');
const log = (msg) => console.log(msg);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', ...opts });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

function parseArgs(argv) {
  const flags = new Set();
  const multi = { 'local-project': [] };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--local-project') multi['local-project'].push(path.resolve(argv[++i]));
    else if (a.startsWith('--')) flags.add(a.slice(2));
    else positional.push(a);
  }
  return { flags, multi, positional };
}

function unionArray(target = [], extra = []) {
  return [...target, ...extra.filter((x) => !target.includes(x))];
}

function mergeHooks(target = {}, extra = {}) {
  for (const [event, groups] of Object.entries(extra)) {
    target[event] ??= [];
    const known = new Set(target[event].flatMap((g) => g.hooks.map((h) => h.command)));
    for (const group of groups) {
      const fresh = group.hooks.filter((h) => !known.has(h.command));
      if (fresh.length) target[event].push({ ...group, hooks: fresh });
    }
  }
  return target;
}

// ---------- user ----------

function setupUser(multi) {
  fs.mkdirSync(POLICY_DIR, { recursive: true });
  fs.copyFileSync(path.join(KIT, 'user', 'skill-policy.mjs'), POLICY_SCRIPT);
  log(`installed ${POLICY_SCRIPT}`);

  const policy = exists(POLICY_FILE) ? readJson(POLICY_FILE) : readJson(path.join(KIT, 'user', 'policy.json'));
  if (!exists(POLICY_FILE)) log(`created ${POLICY_FILE} (edit it to change the policy)`);
  policy.localSkillProjects = unionArray(policy.localSkillProjects, multi['local-project'].map(fwd));
  writeJson(POLICY_FILE, policy);

  const settings = readJson(USER_SETTINGS);
  settings.enabledPlugins ??= {};
  settings.extraKnownMarketplaces ??= {};
  for (const [id, { marketplace, source }] of Object.entries(policy.userPlugins.enable)) {
    settings.enabledPlugins[id] = true;
    settings.extraKnownMarketplaces[marketplace] ??= {
      source: source.includes('://') ? { source: 'git', url: source } : { source: 'github', repo: source },
    };
  }
  for (const id of policy.userPlugins.disable) settings.enabledPlugins[id] = false;
  settings.hooks = mergeHooks(settings.hooks, {
    SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: `node "${fwd(POLICY_SCRIPT)}"`, timeout: 10 }] }],
  });
  writeJson(USER_SETTINGS, settings);
  log(`merged ${USER_SETTINGS} (plugins, skill-policy SessionStart hook)`);

  const installed = readJson(path.join(CLAUDE, 'plugins', 'installed_plugins.json'), { plugins: {} }).plugins;
  for (const [id, { source }] of Object.entries(policy.userPlugins.enable)) {
    if (installed[id]?.some((e) => e.scope === 'user')) continue;
    log(`installing plugin ${id} ...`);
    run('claude', ['plugin', 'marketplace', 'add', source]);
    const r = run('claude', ['plugin', 'install', id, '--scope', 'user']);
    log(r.ok ? `  installed ${id}` : `  could not install ${id}. Run by hand: claude plugin install ${id} --scope user\n  ${r.out}`);
  }

  const r = run('node', [POLICY_SCRIPT, '--apply'], { shell: false });
  log(r.out);
}

// ---------- project ----------

function copyTree(src, dst, force, report) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyTree(s, d, force, report);
    } else if (!exists(d) || force) {
      fs.copyFileSync(s, d);
      report.copied.push(d);
    } else {
      report.skipped.push(d);
    }
  }
}

function setupProject(dir, flags) {
  if (!dir) throw new Error('usage: node setup.mjs project <dir> [--gitlab] [--expo] [--frontend] [--force]');
  const target = path.resolve(dir);
  if (!exists(target)) throw new Error(`${target} does not exist`);
  const force = flags.has('force');
  const report = { copied: [], skipped: [] };
  const projectKit = path.join(KIT, 'project');

  const settingsPath = path.join(target, '.claude', 'settings.json');
  const hadSettings = exists(settingsPath);
  const before = readJson(settingsPath);

  // An existing CLAUDE.md must win over the template AGENTS.md, or the sync would overwrite it.
  const agents = path.join(target, 'AGENTS.md');
  const claudeMd = path.join(target, 'CLAUDE.md');
  if (exists(claudeMd) && !exists(agents)) fs.copyFileSync(claudeMd, agents);

  copyTree(projectKit, target, force, report);
  if (flags.has('gitlab')) {
    copyTree(path.join(KIT, 'optional', 'gitlab'), path.join(target, '.claude', 'skills'), force, report);
  }

  // settings.json is merged, never replaced.
  const kitSettings = readJson(path.join(projectKit, '.claude', 'settings.json'));
  const merged = hadSettings && !force ? before : kitSettings;
  if (hadSettings && !force) {
    merged.permissions ??= {};
    for (const key of ['allow', 'ask', 'deny']) {
      merged.permissions[key] = unionArray(merged.permissions[key], kitSettings.permissions[key]);
    }
    merged.hooks = mergeHooks(merged.hooks, kitSettings.hooks);
    report.skipped = report.skipped.filter((p) => p !== settingsPath);
  }
  merged.enabledPlugins ??= {};
  if (flags.has('expo')) merged.enabledPlugins['expo@claude-plugins-official'] = true;
  if (flags.has('frontend')) merged.enabledPlugins['frontend-design@claude-plugins-official'] = true;
  if (Object.keys(merged.enabledPlugins).length === 0) delete merged.enabledPlugins;
  writeJson(settingsPath, merged);

  const roadmap = path.join(target, 'docs', 'ROADMAP.md');
  if (!exists(roadmap)) {
    fs.copyFileSync(path.join(projectKit, '.claude', 'skills', 'plan-board', 'templates', 'roadmap.md'), roadmap);
    report.copied.push(roadmap);
  }
  for (const sub of ['plans/backlog', 'plans/active', 'plans/done', 'adr']) {
    const d = path.join(target, 'docs', sub);
    fs.mkdirSync(d, { recursive: true });
    if (fs.readdirSync(d).length === 0) fs.writeFileSync(path.join(d, '.gitkeep'), '');
  }
  if (!exists(claudeMd)) fs.copyFileSync(agents, claudeMd);

  const gitignore = path.join(target, '.gitignore');
  const ignored = exists(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
  if (!ignored.split(/\r?\n/).includes('.claude/settings.local.json')) {
    fs.appendFileSync(gitignore, `${ignored === '' || ignored.endsWith('\n') ? '' : '\n'}.claude/settings.local.json\n`);
  }

  const twinsDiffer = fs.readFileSync(agents, 'utf8') !== fs.readFileSync(claudeMd, 'utf8');
  if (twinsDiffer) {
    log('warning: AGENTS.md and CLAUDE.md differ. Merge them by hand; the next edit of either one overwrites the other.');
  }
  const sync = twinsDiffer
    ? { ok: false, out: 'skipped because AGENTS.md and CLAUDE.md differ' }
    : run('python', [path.join(target, '.claude', 'hooks', 'post_edit.py'), '--sync'], { cwd: target, shell: false });
  if (!sync.ok) log(`note: skill mirror sync not run (${sync.out || 'python not found'}). Run later: python .claude/hooks/post_edit.py --sync`);

  log(`merged ${settingsPath}`);
  log(`copied ${report.copied.length} file(s) into ${target}`);
  if (report.skipped.length) {
    log(`kept ${report.skipped.length} existing file(s) (use --force to overwrite):`);
    for (const p of report.skipped) log(`  ${path.relative(target, p)}`);
  }
  log('next: fill in AGENTS.md (it is copied to CLAUDE.md on edit) and docs/ROADMAP.md, then commit.');
}

// ---------- main ----------

const [command, ...rest] = process.argv.slice(2);
const { flags, multi, positional } = parseArgs(rest);
try {
  if (command === 'user') setupUser(multi);
  else if (command === 'project') setupProject(positional[0], flags);
  else if (command === 'check') log(run('node', [POLICY_SCRIPT, '--check'], { shell: false }).out);
  else {
    log('usage:\n  node setup.mjs user [--local-project <dir>]...\n  node setup.mjs project <dir> [--gitlab] [--expo] [--frontend] [--force]\n  node setup.mjs check');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
