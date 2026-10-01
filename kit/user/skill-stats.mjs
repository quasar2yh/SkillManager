// 스킬 사용 통계와 대시보드: 코딩 에이전트(Claude Code, Codex, CodeBuddy Code, Gemini CLI, Copilot CLI 등)의 대화 기록에서
// 스킬 호출과 토큰 사용량을 모아 ~/.claude/skill-policy/stats.json에 쌓고, 에이전트별 스킬 상태·토큰과 함께
// localhost 대시보드로 보여 준다. 기록 형식별 읽기는 skill-agents.mjs, 호출 방식 읽기·쓰기는 skill-modes.mjs에 있다.
// node skill-stats.mjs collect [--project <dir>] [--exact]
// node skill-stats.mjs serve [--port 4178] [--project <dir>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  HOME, USER_SKILLS, USER_SETTINGS, POLICY_DIR, STATE_FILE, PLUGINS_FILE, CLAUDE, DESC_CAP,
  exists, readJson, writeJson, fwd, samePath, estimateTokens, skillsIn, parseSkillMd, listingText, effectiveMode,
} from './skill-inventory.mjs';
import { AGENTS, CODEX_HOME, GEMINI_HOME, CODEBUDDY_HOME, AGENTS_SKILLS, SCAN_VERSION, dayKey, parseCodexListing } from './skill-agents.mjs';
import { loadPolicy, policyValue, modeReader, buildModes, resolveChange, planChanges, writePlan, undoLast } from './skill-modes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(POLICY_DIR, 'stats.json');
const DASHBOARD_HTML = path.join(HERE, 'skill-dashboard.html');
const META_FILE = path.join(HERE, 'skill-meta.json');
const META_LOCAL = path.join(POLICY_DIR, 'skill-meta.local.json');
// `npx skills` records where each skill came from here.
const SKILL_LOCK = path.join(HOME, '.agents', '.skill-lock.json');
const MARKETPLACES = path.join(CLAUDE, 'plugins', 'known_marketplaces.json');
const COUNT_MODEL = process.env.SKILL_STATS_MODEL || 'claude-sonnet-5';
// A key only for this tool, so setting it for good does not switch Claude Code itself to API billing.
const KEY_VARS = ['SKILL_STATS_API_KEY', 'ANTHROPIC_API_KEY'];
const DAY = 86400000;
const log = (msg) => console.log(msg);

function parseArgs(argv) {
  const opts = { project: null, port: 4178, exact: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') opts.project = path.resolve(argv[++i]);
    else if (argv[i] === '--port') opts.port = Number(argv[++i]);
    else if (argv[i] === '--exact') opts.exact = true;
  }
  return opts;
}

// ---------- categories and origins ----------

// Keyword score over name (x3) and description (x1); the highest wins, ties go to the earlier category.
// Labels live in the dashboard, which shows them in the viewer's language.
const CATEGORIES = [
  { id: 'plan', words: ['brainstorm', 'plan', 'spec', 'requirement', 'grill', 'domain', 'architecture', 'adr', 'roadmap', 'idea', 'interview', 'scope'] },
  { id: 'build', words: ['implement', 'tdd', 'refactor', 'codebase', 'module', 'subagent', 'feature', 'execute', 'executing'] },
  { id: 'debug', words: ['debug', 'debugging', 'investigate', 'investigation', 'bug', 'diagnose', 'diagnosing', 'root cause'] },
  { id: 'review', words: ['review', 'security', 'audit', 'owasp', 'verification', 'verify', 'quality', 'simplify', 'health', 'benchmark', 'performance'] },
  { id: 'test', words: ['qa', 'test', 'testing', 'browser', 'playwright', 'dogfood', 'screenshot', 'e2e'] },
  { id: 'ship', words: ['ship', 'deploy', 'deployment', 'canary', 'release', 'ci', 'pipeline', 'gitlab', 'merge', 'branch', 'changelog', 'worktree', 'git'] },
  { id: 'design', words: ['design', 'ui', 'ux', 'html', 'frontend', 'wireframe', 'prototype', 'css', 'visual', 'mockup', 'diagram', 'canvas', 'theme', 'art', 'gif', 'image', 'imagegen'] },
  { id: 'docs', words: ['docx', 'pdf', 'pptx', 'xlsx', 'word', 'powerpoint', 'spreadsheet', 'spreadsheets', 'document', 'slides', 'presentation'] },
  { id: 'data', words: ['data', 'csv', 'sql', 'postgres', 'chart', 'analytics', 'd3', 'dataset'] },
  { id: 'research', words: ['research', 'article', 'writing', 'writer', 'content', 'youtube', 'transcript', 'meeting', 'blog', 'summarize'] },
  { id: 'work', words: ['retro', 'retrospective', 'invoice', 'resume', 'organize', 'organizer', 'lead', 'brand', 'marketing', 'comms', 'communication'] },
  { id: 'agent', words: ['mcp', 'plugin', 'codex', 'hook', 'settings', 'config', 'handoff', 'checkpoint', 'session', 'freeze', 'guard', 'careful', 'upgrade', 'gstack', 'skill', 'installer'] },
  { id: 'other', words: [] },
];
const SET_CATEGORY = { documents: 'docs', frontend: 'design', 'dev-tools': 'agent', data: 'data', 'research-writing': 'research', business: 'work', creative: 'design', productivity: 'work' };
const WORD_RE = new Map(CATEGORIES.flatMap((c) => c.words.map((w) => [w, new RegExp(`\\b${w}(s|es|ed|ing)?\\b`, 'gi')])));

function loadMeta() {
  const base = readJson(META_FILE, {});
  const local = readJson(META_LOCAL, {});
  return {
    origins: { ...base.origins, ...local.origins },
    categories: { ...base.categories, ...local.categories },
  };
}

const metaLookup = (map, name) => map[name] ?? (name.includes(':') ? map[`${name.split(':')[0]}:*`] : undefined);

function categorize(name, description, set, meta) {
  const fixed = metaLookup(meta.categories, name) ?? SET_CATEGORY[set];
  if (fixed && CATEGORIES.some((c) => c.id === fixed)) return fixed;
  const nameText = name.replace(/[:_-]/g, ' ');
  let best = { id: 'other', score: 0 };
  for (const c of CATEGORIES) {
    const score = c.words.reduce((a, w) => a + 3 * (nameText.match(WORD_RE.get(w)) ?? []).length + (description.match(WORD_RE.get(w)) ?? []).length, 0);
    if (score > best.score) best = { id: c.id, score };
  }
  return best.id;
}

// "https://github.com/a/b.git", "git@github.com:a/b.git", or "a/b" → { label: "a/b", url }.
function repoRef(ref) {
  if (!ref) return null;
  const ssh = ref.match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (ssh) return { label: ssh[2], url: `https://${ssh[1]}/${ssh[2]}` };
  const http = ref.match(/^https?:\/\/[^/]+\/(.+?)(\.git)?\/?$/);
  if (http) return { label: http[1], url: ref.replace(/\.git$/, '') };
  if (/^[\w.-]+\/[\w.-]+$/.test(ref)) return { label: ref, url: `https://github.com/${ref}` };
  return { label: ref, url: '' };
}

function gitRemote(dir) {
  const config = path.join(dir, '.git', 'config');
  if (!exists(config)) return null;
  const m = fs.readFileSync(config, 'utf8').match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
  return m ? m[1] : null;
}

const realpath = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

// Where a skill came from, not where it is installed (that is scope + project). Language-neutral:
// `kind` says what `label` is, and the dashboard words it. `via` says how that was worked out.
function originOf(r, ctx) {
  const meta = metaLookup(ctx.meta.origins, r.name);
  if (meta) return { kind: 'repo', ...repoRef(meta), via: { kind: 'meta' } };
  if (r.scope === 'plugin') {
    const ref = repoRef(r.pluginSource);
    return { kind: 'plugin', label: r.plugin, url: ref?.url ?? '', via: { kind: 'marketplace', marketplace: r.marketplace, repo: ref?.label ?? '' } };
  }
  if (r.scope === 'system') return { kind: 'builtin', label: r.agentLabel, url: '', via: { kind: 'builtin' } };
  const inst = ctx.state.installed.find((i) => i.name === r.name && samePath(i.dir, r.path));
  if (inst) return { kind: 'repo', ...repoRef(inst.repo), via: { kind: 'set', set: inst.set } };
  const lock = r.scope === 'user' ? ctx.lock[r.dir] : null;
  if (lock) return { kind: 'repo', ...repoRef(lock.sourceUrl ?? lock.source), via: { kind: 'npx' } };
  // gstack-style packs: the pack's repo sits next to its skills, and descriptions end with "(pack)".
  const pack = (r.fm.description ?? '').match(/\(([\w.-]+)\)\s*$/)?.[1];
  const packRemote = pack && [r.packRoot, USER_SKILLS].filter(Boolean).map((root) => gitRemote(path.join(root, pack))).find(Boolean);
  if (packRemote) return { kind: 'repo', ...repoRef(packRemote), via: { kind: 'pack', pack } };
  if (r.scope === 'user') {
    const own = gitRemote(realpath(r.path));
    if (own) return { kind: 'repo', ...repoRef(own), via: { kind: 'git' } };
    return { kind: 'local', label: '', url: '', via: { kind: 'none' } };
  }
  return { kind: 'project', label: path.basename(r.project), url: '', via: { kind: 'inline' } };
}

const summarize = (desc) => {
  const first = desc.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '';
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
};

// ---------- inventory: every skill each agent can see, with its state ----------

function inventoryContext() {
  return {
    state: { installed: [], ...readJson(STATE_FILE) },
    policy: loadPolicy(),
    meta: loadMeta(),
    lock: readJson(SKILL_LOCK, { skills: {} }).skills ?? {},
    marketplaces: readJson(MARKETPLACES),
  };
}

// One dashboard row. `s` is a parsed skill folder ({ dir, path, fm, body }); `listing` is the text the agent
// puts in every request for it ('' when it is not listed).
function makeRow(ctx, s, { agent, name, mode, scope, project = '', listing, ...extra }) {
  const description = (`${s.fm.description ?? ''} ${s.fm.when_to_use ?? ''}`.trim() || extra.fallbackDescription) ?? '';
  const set = agent === 'claude' ? ctx.state.installed.find((i) => i.name === name)?.set ?? '' : '';
  // The baseline value from policy.json, shown in the row details.
  const key = extra.pathKey ? `path:${fwd(s.path)}` : name;
  const policy = policyValue(ctx.policy, agent, key) ?? (agent === 'claude' && ctx.policy.localOnlySkills?.includes(name) ? 'local-only' : '');
  const fm = s.fm['disable-model-invocation'] === 'true';
  const { fallbackDescription, pluginSource, marketplace, plugin, packRoot, pathKey, ...rest } = extra;
  return {
    agent,
    name,
    mode,
    summary: summarize(description),
    description: description.slice(0, 1200),
    category: categorize(name, description, set, ctx.meta),
    origin: originOf({ name, dir: s.dir, path: s.path, fm: s.fm, scope, project, plugin, marketplace, pluginSource, packRoot, agentLabel: AGENTS.find((a) => a.id === agent).label }, ctx),
    path: s.path,
    listingText: listing,
    listingTokens: listing ? estimateTokens(listing) : 0,
    // What the listing would cost if the skill were auto; the Invocation page shows the effect of a change with it.
    autoTokens: estimateTokens(listing || listingText(name, s.fm, 'on')),
    bodyTokens: estimateTokens(s.body ?? ''),
    set,
    policy,
    fm,
    scope,
    project,
    ...rest,
  };
}

// Claude Code, and CodeBuddy Code (a fork with the same settings under .codebuddy): skillOverrides merge
// user < project settings.json < project settings.local.json, name by name.
function inventorySettings(agent, projectDirs, ctx) {
  const { home, dir } = agent === 'claude' ? { home: CLAUDE, dir: '.claude' } : { home: CODEBUDDY_HOME, dir: '.codebuddy' };
  const userSettings = readJson(agent === 'claude' ? USER_SETTINGS : path.join(home, 'settings.json'));
  const rows = [];
  const push = (s, name, mode, extra) => rows.push(makeRow(ctx, s, { agent, name, mode, listing: listingText(name, s.fm, mode), ...extra }));

  const userOverrides = userSettings.skillOverrides ?? {};
  const userSkills = skillsIn(agent === 'claude' ? USER_SKILLS : path.join(home, 'skills'), 'user');
  for (const s of userSkills) {
    const name = s.fm.name || s.dir;
    push(s, name, effectiveMode(s.fm, userOverrides[name]), { scope: 'user' });
  }

  for (const proj of projectDirs) {
    const overrides = {
      ...userOverrides,
      ...readJson(path.join(proj, dir, 'settings.json')).skillOverrides,
      ...readJson(path.join(proj, dir, 'settings.local.json')).skillOverrides,
    };
    for (const s of skillsIn(path.join(proj, dir, 'skills'), 'project')) {
      const name = s.fm.name || s.dir;
      // Personal skills win over project skills of the same name.
      const shadowed = userSkills.some((u) => (u.fm.name || u.dir) === name);
      push(s, name, shadowed ? 'shadowed' : effectiveMode(s.fm, overrides[name]), { scope: 'project', project: fwd(proj) });
    }
  }
  if (agent !== 'claude') return rows;

  // Plugin skills ignore skillOverrides; they follow the plugin's enabledPlugins switch.
  for (const [id, installs] of Object.entries(readJson(PLUGINS_FILE, { plugins: {} }).plugins)) {
    const [plugin, marketplace] = id.split('@');
    const src = ctx.marketplaces[marketplace]?.source ?? {};
    for (const inst of installs) {
      if (inst.scope !== 'user' && (installs.some((i) => i.scope === 'user') || !projectDirs.some((p) => samePath(p, inst.projectPath)))) continue;
      const settings = inst.scope === 'user' ? userSettings : readJson(path.join(inst.projectPath, '.claude', 'settings.json'));
      const enabled = settings.enabledPlugins?.[id] === true;
      for (const s of skillsIn(path.join(inst.installPath, 'skills'), 'plugin')) {
        const name = `${plugin}:${s.fm.name || s.dir}`;
        push(s, name, enabled ? effectiveMode(s.fm) : 'plugin-off', {
          scope: 'plugin', pluginId: id, plugin, marketplace, pluginSource: src.repo ?? src.url, project: inst.scope === 'user' ? '' : fwd(inst.projectPath),
        });
      }
    }
  }
  return rows;
}

// [marketplaces.<name>] source = "<git url>" in $CODEX_HOME/config.toml, for plugin origins.
function codexMarketplaces() {
  const file = path.join(CODEX_HOME, 'config.toml');
  if (!exists(file)) return {};
  const out = {};
  let section = null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const head = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (head) section = head[1].match(/^marketplaces\.("?)(.+)\1$/)?.[2] ?? null;
    const src = section && line.match(/^\s*source\s*=\s*["'](.+)["']\s*$/)?.[1];
    if (src && /^(https?:|git@)/.test(src)) out[section] = src;
  }
  return out;
}

const under = (p, dir) => !!p && !!dir && (samePath(p, dir) || fwd(p).toLowerCase().startsWith(`${fwd(dir).replace(/\/$/, '').toLowerCase()}/`));

// Codex has no settings file that says which skills are listed, so read what it actually sent: the
// "<skills_instructions>" block of the newest session. Personal, built-in, and plugin skills come from the
// newest session anywhere; a project's own skills (<project>/.agents/skills) from its newest session.
function inventoryCodex(listings, ctx) {
  const parsed = Object.values(listings).map((l) => ({ ...l, ...parseCodexListing(l.text) })).sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const marketplaces = codexMarketplaces();
  const projectOf = (root) => {
    if (under(root, CODEX_HOME) || under(root, AGENTS_SKILLS)) return '';
    const m = fwd(root).match(/^(.*)\/\.(agents|codex)\/skills$/i);
    return m ? m[1] : '';
  };
  const scopeOf = (root) => (under(root, path.join(CODEX_HOME, 'skills', '.system')) ? 'system' : under(root, path.join(CODEX_HOME, 'plugins')) ? 'plugin' : 'user');
  const rows = [];
  const add = (x, project, dup) => {
    const dirPath = fwd(path.dirname(x.file));
    const file = exists(x.file) ? parseSkillMd(x.file) : { fm: {}, body: '' };
    const plugin = fwd(x.file).match(/\/plugins\/cache\/([^/]+)\/([^/]+)\//i);
    const scope = project ? 'project' : scopeOf(x.root);
    rows.push(makeRow(ctx, { dir: path.basename(dirPath), path: dirPath, ...file }, {
      agent: 'codex', name: x.name, mode: 'on', scope, project, listing: x.line, dup, pathKey: true,
      fallbackDescription: x.line.replace(/^- \S+?:\s?/, '').replace(/\s*\(file: .*\)$/, ''),
      plugin: plugin?.[2], marketplace: plugin?.[1], pluginSource: plugin && marketplaces[plugin[1]], packRoot: x.root,
    }));
  };
  const dups = (entries) => {
    const n = new Map();
    for (const x of entries) n.set(x.name, (n.get(x.name) ?? 0) + 1);
    return (x) => n.get(x.name) > 1;
  };
  if (parsed.length) {
    const common = parsed[0].entries.filter((x) => !projectOf(x.root));
    const isDup = dups(common);
    for (const x of common) add(x, '', isDup(x));
    const taken = new Set();
    for (const l of parsed) {
      const fresh = l.entries.filter((x) => projectOf(x.root) && !taken.has(projectOf(x.root).toLowerCase()));
      const isDupP = dups(fresh);
      for (const x of fresh) add(x, projectOf(x.root), isDupP(x));
      for (const x of fresh) taken.add(projectOf(x.root).toLowerCase());
    }
    return { rows, listingSource: 'transcript', listedAt: parsed[0].ts };
  }
  // No session has listed skills yet: estimate from the folders Codex reads, in its listing format.
  for (const dir of [path.join(CODEX_HOME, 'skills'), AGENTS_SKILLS, path.join(CODEX_HOME, 'skills', '.system')]) {
    for (const s of skillsIn(dir, 'user')) {
      const name = s.fm.name || s.dir;
      const desc = `${s.fm.description ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 100);
      add({ name, root: fwd(dir), file: `${s.path}/SKILL.md`, line: `- ${name}: ${desc} (file: r0/${s.dir}/SKILL.md)` }, '', false);
    }
  }
  return { rows, listingSource: 'estimate', listedAt: null };
}

// Agents that load skill folders on their own (Gemini CLI, Copilot CLI, Qwen Code, ZCode, Kimi Code), listed as
// "name: description" (an estimate). Qwen Code and ZCode settings come from skill-modes.mjs.
function inventoryFolders(agent, projectDirs, ctx) {
  let disabled = [];
  if (agent.id === 'gemini') {
    try {
      disabled = readJson(path.join(GEMINI_HOME, 'settings.json')).skills?.disabled ?? [];
    } catch {
      /* settings with comments: treat as nothing disabled */
    }
  }
  const settingsMode = modeReader(agent.id);
  const pathKey = ['zcode', 'kimi'].includes(agent.id);
  const rows = [];
  const push = (s, scope, project) => {
    const name = s.fm.name || s.dir;
    const mode = disabled.includes(name) ? 'off' : settingsMode({ name, path: s.path, fm: s.fm, project });
    rows.push(makeRow(ctx, s, { agent: agent.id, name, mode, scope, project, listing: listingText(name, s.fm, mode), packRoot: path.dirname(s.path), pathKey }));
  };
  for (const dir of agent.skillDirs ?? []) for (const s of skillsIn(dir, 'user')) push(s, 'user', '');
  for (const proj of projectDirs) {
    for (const rel of agent.projectSkills ?? []) for (const s of skillsIn(path.join(proj, rel), 'project')) push(s, 'project', fwd(proj));
  }
  return { rows, listingSource: 'estimate', listedAt: null };
}

// ---------- exact token counts (optional, Anthropic count_tokens API, Claude Code rows only) ----------

async function countTokens(text, key) {
  const r = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: COUNT_MODEL, messages: [{ role: 'user', content: text || '.' }] }),
  });
  if (!r.ok) throw new Error(`count_tokens ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).input_tokens;
}

// Results are cached by content hash, so only changed skills are sent again.
async function exactCounts(rows, store, key) {
  const hash = (t) => crypto.createHash('sha1').update(`${COUNT_MODEL}\n${t}`).digest('hex');
  const count = async (t) => {
    const h = hash(t);
    store.exact[h] ??= await countTokens(t, key);
    return store.exact[h];
  };
  // A one-character message still carries message framing; subtract it.
  const framing = await count('.');
  for (const r of rows) {
    if (r.listingText) r.listingExact = Math.max(0, (await count(r.listingText)) - framing);
    r.bodyExact = Math.max(0, (await count(fs.readFileSync(path.join(r.path, 'SKILL.md'), 'utf8'))) - framing);
  }
}

// ---------- collect ----------

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const apiKey = () => KEY_VARS.map((v) => [v, process.env[v]]).find(([, k]) => k) ?? [null, null];

// Only projects the agent can use: a session opened in the home folder would list personal skills a second time.
const projectsWith = (cwds, rel) => [...new Set(cwds.map(fwd))]
  .filter((p) => !samePath(p, HOME) && rel.some((r) => exists(path.join(p, r))))
  .filter((p, i, a) => a.findIndex((q) => samePath(p, q)) === i);

async function collect({ project, exact }) {
  const store = { version: 2, files: {}, exact: {}, listings: {}, snapshots: [], ...readJson(STORE) };
  store.listings ??= {};
  store.listings.codex ??= {};
  // Rescan anything changed or read by an older scanner. Transcripts the agent has since deleted keep their events.
  for (const agent of AGENTS) {
    for (const f of agent.files()) {
      const st = fs.statSync(f);
      const key = fwd(f);
      const prev = store.files[key];
      if (prev && prev.size === st.size && prev.mtime === st.mtimeMs && prev.v === SCAN_VERSION) continue;
      const { listing, ...scan } = agent.scan(f);
      store.files[key] = { v: SCAN_VERSION, agent: agent.id, size: st.size, mtime: st.mtimeMs, ...scan };
      if (listing) {
        const k = fwd(listing.cwd ?? '').toLowerCase();
        if (!store.listings.codex[k] || store.listings.codex[k].ts < listing.ts) store.listings.codex[k] = listing;
      }
    }
  }
  const files = Object.values(store.files).map((f) => ({ ...f, agent: f.agent ?? 'claude' }));

  // Forked Codex subagents repeat their parent's events under the same id; keep the parent's copy.
  const byId = new Map();
  for (const f of files) {
    for (const e of f.events ?? []) {
      const ev = { ...e, agent: f.agent };
      const prev = byId.get(ev.id);
      if (!prev || (prev.subagent && !ev.subagent)) byId.set(ev.id, ev);
    }
  }
  const events = [...byId.values()];

  const here = project ?? process.cwd();
  const cwdsOf = (id) => [here, ...files.filter((f) => f.agent === id).flatMap((f) => [f.cwd, ...(f.events ?? []).map((e) => e.project)]).filter(Boolean)];
  const ctx = inventoryContext();
  // Agents neither installed nor with collected history are left out (ZCode and Kimi Code would otherwise
  // list the shared ~/.agents/skills folder on PCs that never ran them).
  const present = (a) => exists(a.home) || files.some((f) => f.agent === a.id);
  // An agent without history yet: look for its project folders wherever any agent worked.
  const allCwds = [here, ...files.flatMap((f) => [f.cwd, ...(f.events ?? []).map((e) => e.project)]).filter(Boolean)];
  const cwdsFor = (a) => (files.some((f) => f.agent === a.id) ? cwdsOf(a.id) : allCwds);
  const inventories = {};
  for (const agent of AGENTS) {
    if (!present(agent)) inventories[agent.id] = { rows: [], listingSource: 'estimate', listedAt: null };
    else if (agent.id === 'claude' || agent.id === 'codebuddy') {
      const dir = agent.id === 'claude' ? '.claude' : '.codebuddy';
      inventories[agent.id] = { rows: inventorySettings(agent.id, projectsWith(cwdsFor(agent), [dir]), ctx), listingSource: 'settings', listedAt: null };
    } else if (agent.id === 'codex') inventories.codex = inventoryCodex(store.listings.codex, ctx);
    else inventories[agent.id] = inventoryFolders(agent, projectsWith(cwdsFor(agent), agent.projectSkills ?? []), ctx);
  }
  const skills = AGENTS.flatMap((a) => inventories[a.id].rows);

  const [keyVar, key] = apiKey();
  let exactError = null;
  if (exact) {
    if (!key) exactError = `${KEY_VARS.join(' / ')} is not set`;
    else {
      try {
        await exactCounts(skills.filter((s) => s.agent === 'claude'), store, key);
      } catch (e) {
        exactError = e.message;
      }
    }
  }

  // Match each event to one inventory row of its own agent: the copy whose SKILL.md was read when the log says so,
  // otherwise project skills only take events from their own project.
  const now = Date.now();
  const unmatched = new Map();
  for (const ev of events) {
    const own = skills.filter((s) => s.agent === ev.agent && s.name === ev.skill);
    const row = (ev.file && own.find((s) => samePath(`${s.path}/SKILL.md`, ev.file)))
      ?? own.find((s) => s.scope === 'project' && samePath(s.project, ev.project)) ?? own.find((s) => s.scope !== 'project') ?? own[0];
    if (row) (row.events ??= []).push(ev);
    else {
      const k = `${ev.agent}|${ev.skill}`;
      unmatched.set(k, [...(unmatched.get(k) ?? []), ev]);
    }
  }
  for (const evs of unmatched.values()) {
    const { agent, skill: name } = evs[0];
    const origin = metaLookup(ctx.meta.origins, name);
    skills.push({
      agent, name, scope: 'other', mode: 'not-installed', events: evs, summary: '', description: '',
      category: categorize(name, '', '', ctx.meta),
      origin: origin ? { kind: 'repo', ...repoRef(origin), via: { kind: 'meta' } } : { kind: 'unknown', label: '', url: '', via: { kind: 'none' } },
      path: '', listingTokens: 0, bodyTokens: 0, set: '', policy: '', project: '',
    });
  }

  // "Last 30 days" is the same 30 calendar days everywhere: totals, per-skill counts, and charts.
  const days30 = [...Array(30)].map((_, i) => dayKey(now - (29 - i) * DAY));
  const in30 = new Set(days30);
  const isRecent = (e) => in30.has(dayKey(e.ts));
  for (const s of skills) {
    const evs = (s.events ?? []).sort((a, b) => (a.ts < b.ts ? -1 : 1));
    const recent = evs.filter(isRecent);
    const byProject = {};
    for (const e of evs) byProject[fwd(e.project ?? '?')] = (byProject[fwd(e.project ?? '?')] ?? 0) + 1;
    Object.assign(s, {
      uses: evs.length,
      uses30: recent.length,
      byModel: evs.filter((e) => e.via === 'model').length,
      byUser: evs.filter((e) => e.via === 'user').length,
      lastUsed: evs.at(-1)?.ts ?? null,
      loadTokens: median(evs.map((e) => e.loadTokens).filter(Boolean)),
      contextDelta: median(evs.map((e) => e.contextDelta).filter(Boolean)),
      byProject,
      daily: days30.map((d) => recent.filter((e) => dayKey(e.ts) === d).length),
    });
    delete s.events;
    delete s.listingText;
  }
  // Idle: listed on every request but not called for 30 days. A duplicate copy is not idle when another copy was used.
  const usedNames = new Set(skills.filter((s) => s.uses30).map((s) => `${s.agent}|${s.project}|${s.name}`));
  for (const s of skills) s.idle = s.listingTokens > 0 && s.uses30 === 0 && !(s.dup && usedNames.has(`${s.agent}|${s.project}|${s.name}`));

  const tokensOf = (s) => s.listingExact ?? s.listingTokens;
  const recent30 = events.filter(isRecent);
  const agentSummary = (agent) => {
    const rows = skills.filter((s) => s.agent === agent.id);
    const visible = rows.filter((s) => s.listingTokens > 0);
    const idle = visible.filter((s) => s.idle);
    const projectDirs = [...new Set(visible.filter((s) => s.project).map((s) => s.project))];
    const own = files.filter((f) => f.agent === agent.id);
    const evs = events.filter((e) => e.agent === agent.id);
    const evs30 = recent30.filter((e) => e.agent === agent.id);
    const usage30 = { requests: 0, input: 0, output: 0, cached: 0 };
    const sessions = new Set();
    for (const f of own) {
      for (const [d, u] of Object.entries(f.usage ?? {})) {
        if (!in30.has(d)) continue;
        for (const k of Object.keys(usage30)) usage30[k] += u[k] ?? 0;
        if (!f.subagent && f.session) sessions.add(f.session);
      }
    }
    const inv = inventories[agent.id];
    // A name listed n times wastes n - 1 copies; keep the biggest one.
    const dupGroups = new Map();
    for (const s of visible.filter((x) => x.dup)) dupGroups.set(`${s.project}|${s.name}`, [...(dupGroups.get(`${s.project}|${s.name}`) ?? []), tokensOf(s)]);
    const groups = [...dupGroups.values()];
    return {
      id: agent.id,
      label: agent.label,
      experimental: !!agent.experimental,
      noLogs: !!agent.noLogs,
      found: exists(agent.home),
      home: fwd(agent.home),
      logs: agent.logs.map(fwd),
      transcripts: own.length,
      firstEvent: evs.map((e) => e.ts).sort()[0] ?? null,
      listingSource: inv.listingSource,
      listedAt: inv.listedAt,
      totals: {
        skills: rows.filter((s) => s.scope !== 'other').length,
        visible: visible.length,
        globalListing: visible.filter((s) => !s.project).reduce((a, s) => a + tokensOf(s), 0),
        projectListing: Object.fromEntries(projectDirs.map((p) => [p, visible.filter((s) => s.project === p).reduce((a, s) => a + tokensOf(s), 0)])),
        dup: {
          count: groups.reduce((a, g) => a + g.length - 1, 0),
          tokens: groups.reduce((a, g) => a + g.reduce((x, y) => x + y, 0) - Math.max(...g), 0),
        },
        uses: evs.length,
        uses30: evs30.length,
        uses30ByModel: evs30.filter((e) => e.via === 'model').length,
        uses30ByUser: evs30.filter((e) => e.via === 'user').length,
        idle: idle.length,
        idleTokens: idle.reduce((a, s) => a + tokensOf(s), 0),
      },
      usage30: { ...usage30, sessions: sessions.size },
    };
  };
  const agents = AGENTS.map(agentSummary);
  const usageByDay = (d, id) => files.filter((f) => f.agent === id).reduce((a, f) => {
    const u = f.usage?.[d];
    return u ? { input: a.input + u.input, output: a.output + u.output } : a;
  }, { input: 0, output: 0 });

  const today = dayKey(now);
  const claude = agents.find((a) => a.id === 'claude').totals;
  store.version = 2;
  store.snapshots = [...store.snapshots.filter((s) => s.date !== today), {
    date: today, globalListing: claude.globalListing, visible: claude.visible, total: claude.skills,
    byAgent: Object.fromEntries(agents.map((a) => [a.id, a.totals.globalListing])),
  }].slice(-365);
  writeJson(STORE, store);

  // Folders any agent worked in, newest first: where the Invocation page offers project exceptions.
  const dirs = new Map();
  const seen = (p, last) => {
    const dir = fwd(p).replace(/\/$/, '');
    if ((dirs.get(dir.toLowerCase())?.last ?? -1) < last) dirs.set(dir.toLowerCase(), { dir, last });
  };
  for (const f of files) for (const p of [f.cwd, ...(f.events ?? []).map((e) => e.project)]) if (p) seen(p, f.mtime ?? 0);
  if (!dirs.has(fwd(here).toLowerCase())) seen(here, now);
  const isDir = (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  // Scratch folders under the temp dir and ~/.claude come from tools, not projects; the folder this runs for stays.
  const projects = [...dirs.values()]
    .filter((p) => samePath(p.dir, here) || (!samePath(p.dir, HOME) && !under(p.dir, os.tmpdir()) && !under(p.dir, CLAUDE)))
    .filter((p) => isDir(p.dir))
    .sort((a, b) => b.last - a.last)
    .map((p) => ({ dir: p.dir, last: new Date(p.last).toISOString() }));

  const allVisible = skills.filter((s) => s.listingTokens > 0);
  const allIdle = allVisible.filter((s) => s.idle);
  return {
    generatedAt: new Date(now).toISOString(),
    store: fwd(STORE),
    countModel: COUNT_MODEL,
    exactAvailable: !!key,
    exactKeyVar: keyVar,
    keyVars: KEY_VARS,
    exactError,
    descCap: DESC_CAP,
    transcripts: files.length,
    firstEvent: events.map((e) => e.ts).sort()[0] ?? null,
    agents,
    totals: {
      skills: skills.filter((s) => s.scope !== 'other').length,
      visible: allVisible.length,
      uses: events.length,
      uses30: recent30.length,
      uses30ByModel: recent30.filter((e) => e.via === 'model').length,
      uses30ByUser: recent30.filter((e) => e.via === 'user').length,
      idle: allIdle.length,
      idleTokens: allIdle.reduce((a, s) => a + tokensOf(s), 0),
    },
    categories: CATEGORIES.map((c) => c.id),
    daily: days30.map((d) => {
      const day = recent30.filter((e) => dayKey(e.ts) === d);
      return {
        date: d,
        count: day.length,
        byAgent: Object.fromEntries(AGENTS.map((a) => [a.id, day.filter((e) => e.agent === a.id).length])),
        tokens: Object.fromEntries(AGENTS.map((a) => [a.id, usageByDay(d, a.id)])),
      };
    }),
    snapshots: store.snapshots,
    projects,
    skills,
  };
}

// ---------- commands ----------

const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

async function printSummary(opts) {
  const r = await collect(opts);
  const t = r.totals;
  log(`transcripts scanned: ${r.transcripts}, skill loads: ${t.uses} (last 30 days: ${t.uses30})`);
  log(`\n${'agent'.padEnd(20)}${'skills'.padStart(8)}${'listed/request'.padStart(16)}${'uses 30d'.padStart(10)}${'requests 30d'.padStart(14)}${'input 30d'.padStart(11)}`);
  for (const a of r.agents.filter((x) => x.found || x.transcripts)) {
    const listed = `${a.totals.globalListing}${a.listingSource === 'estimate' ? '~' : ''}`;
    log(`${a.label.padEnd(20)}${String(a.totals.skills).padStart(8)}${listed.padStart(16)}${String(a.totals.uses30).padStart(10)}${String(a.usage30.requests).padStart(14)}${compact(a.usage30.input).padStart(11)}`);
  }
  if (r.exactError) log(`\nexact counts skipped: ${r.exactError}`);
  const top = r.skills.filter((s) => s.uses30).sort((a, b) => b.uses30 - a.uses30).slice(0, 15);
  if (top.length) {
    log(`\n${'most used (30 days)'.padEnd(44)}${'agent'.padEnd(10)}${'uses'.padStart(6)}${'load ~tok'.padStart(11)}`);
    for (const s of top) log(`${s.name.padEnd(44)}${s.agent.padEnd(10)}${String(s.uses30).padStart(6)}${String(s.contextDelta ?? s.loadTokens ?? '-').padStart(11)}`);
  }
  log(`\nidle for 30 days but listed every request: ${t.idle} skills ≈ ${t.idleTokens} tokens`);
  log(`saved to ${r.store}`);
}

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > 1e6) reject(Object.assign(new Error('request too large'), { status: 413 }));
    else chunks.push(c);
  });
  req.on('end', () => {
    try {
      resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
    } catch {
      reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
    }
  });
  req.on('error', reject);
});

// The Invocation page writes settings files, so its requests must come from this page only:
//   - Host must be localhost or 127.0.0.1 (a DNS-rebound site sends its own host name),
//   - a random token made at start-up is put in the page and required in the X-Skill-Dash-Token header,
//   - writes take JSON only, and the page may not be framed by another site.
function serve({ port, project }) {
  const token = crypto.randomBytes(24).toString('hex');
  const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  let running = null;
  let stats = null;
  let modes = null;
  const collectOnce = async (exact) => {
    running ??= collect({ project, exact }).finally(() => (running = null));
    stats = await running;
    return stats;
  };
  const freshModes = async () => {
    if (!stats) await collectOnce(false);
    modes = buildModes(stats);
    return modes;
  };
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  // A request from the page names skills by the ids it was shown; each is checked against the last /api/modes.
  const resolveAll = (list) => {
    const changes = [];
    const rejected = [];
    for (const r of Array.isArray(list) ? list : []) {
      const [c, reason] = resolveChange(modes, r);
      if (c) changes.push(c);
      else rejected.push({ ...r, reason });
    }
    return { changes, rejected };
  };
  const fileView = (f) => ({ file: fwd(f.file), role: f.role, created: f.created, lines: f.lines, project: f.project, layer: f.layer });

  const server = http.createServer(async (req, res) => {
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(req.headers.host ?? '')) return res.writeHead(403).end();
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'", 'referrer-policy': 'no-referrer',
      });
      return res.end(fs.readFileSync(DASHBOARD_HTML, 'utf8').replace('__SKILL_DASH_TOKEN__', token));
    }
    if (url.pathname === '/api/stats') {
      try {
        const data = await collectOnce(url.searchParams.has('exact'));
        if (modes) modes = buildModes(data);
        return send(res, 200, data);
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }
    if (!url.pathname.startsWith('/api/modes')) return res.writeHead(404).end();
    if (req.headers['x-skill-dash-token'] !== token || (req.headers.origin && !origins.has(req.headers.origin))) return send(res, 403, { error: 'forbidden' });
    try {
      if (url.pathname === '/api/modes' && req.method === 'GET') {
        if (url.searchParams.has('refresh')) await collectOnce(false);
        return send(res, 200, await freshModes());
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return send(res, 415, { error: 'JSON only' });
      const body = await readBody(req);
      if (!modes) await freshModes();
      if (url.pathname === '/api/modes/undo') {
        const r = undoLast();
        return send(res, 200, { ok: true, files: r.files, modes: await freshModes() });
      }
      const { changes, rejected } = resolveAll(body.changes);
      if (rejected.length) return send(res, 400, { error: 'rejected', rejected });
      // Planned from the files as they are now; apply plans again, so it writes on top of the latest contents.
      const plan = planChanges(changes);
      if (url.pathname === '/api/modes/preview') return send(res, 200, { files: plan.files.map(fileView), errors: plan.errors.map((e) => ({ ...e, file: fwd(e.file) })) });
      if (url.pathname === '/api/modes/apply') {
        const r = writePlan(plan);
        return send(res, 200, { ok: true, files: r.files.map(fileView), backupDir: r.backupDir, modes: await freshModes() });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      const status = e.status ?? (['changed', 'conflict', 'comments', 'parse', 'inline-toml', 'no-undo'].includes(e.code) ? 409 : 500);
      return send(res, status, { error: e.message, code: e.code ?? null, file: e.file ?? null, files: e.files ?? null });
    }
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `port ${port} is in use. Try --port <other>` : e.message);
    process.exitCode = 1;
  });
  // Bound to loopback only: the data includes local paths and project names.
  server.listen(port, '127.0.0.1', () => log(`skill dashboard: http://localhost:${port}  (Ctrl+C to stop)`));
}

const [command, ...rest] = process.argv.slice(2);
const opts = parseArgs(rest);
if (command === 'collect') printSummary(opts).catch((e) => ((process.exitCode = 1), console.error(e.message)));
else if (command === 'serve') serve(opts);
else {
  log('usage:\n  collect [--project <dir>] [--exact]\n  serve [--port 4178] [--project <dir>]');
  process.exitCode = 1;
}
