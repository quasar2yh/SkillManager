// 스킬 호출 방식: 내 기준값(policy.json v2)과 에이전트 설정 파일(적용값)을 읽고, 둘을 한 번에 바꾼다.
// 대시보드의 호출 방식 페이지(skill-stats.mjs), 세션 시작 점검(skill-policy.mjs), `skills on/off`(skill-sets.mjs)가 함께 쓴다.
//   값: auto(자동) · manual(/명시 전용) · off(꺼짐). inherit(따름)은 그 층에 값을 두지 않는다는 뜻이다.
//   층: global(전역) · mine(프로젝트 · 나만, 이 PC) · team(프로젝트 · 팀 공유, 저장소에 커밋).
//   기준값에는 global과 mine만 들어간다. team 파일의 기준은 저장소의 git 기록이다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOME, CLAUDE, USER_SETTINGS, POLICY_DIR, POLICY_FILE, STATE_FILE, exists, readJson, fwd, samePath } from './skill-inventory.mjs';
import { CODEX_HOME, CODEBUDDY_HOME, QWEN_HOME, ZCODE_HOME, KIMI_HOME, AGENTS_SKILLS } from './skill-agents.mjs';

export const POLICY_V1_FILE = path.join(POLICY_DIR, 'policy.v1.json');
const UNDO_FILE = path.join(POLICY_DIR, 'modes-undo.json');
const BACKUPS = path.join(POLICY_DIR, 'backups');
const KEEP_BACKUPS = 20;
export const VALUES = ['auto', 'manual', 'off'];

// ---------- files: read, parse, write ----------

export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
}

// Drops // and /* */ comments outside strings. Only for reading: a file with comments is never rewritten.
function stripComments(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return out;
}

function parseJsonText(text) {
  const body = (text ?? '').replace(/^\uFEFF/, '');
  if (!body.trim()) return { obj: {}, comments: false };
  let obj;
  let comments = false;
  try {
    obj = JSON.parse(body);
  } catch {
    obj = JSON.parse(stripComments(body).replace(/,(\s*[}\]])/g, '$1'));
    comments = true;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not a JSON object');
  return { obj, comments };
}

// Keep the file's own indentation, line endings, BOM, and final newline when rewriting it.
function jsonStyle(text) {
  if (!text) return { indent: 2, eol: '\n', bom: false, final: true };
  const indent = text.match(/^[{[][ \t]*\r?\n([ \t]+)\S/)?.[1] ?? 2;
  return { indent, eol: text.includes('\r\n') ? '\r\n' : '\n', bom: text.startsWith('\uFEFF'), final: /\n$/.test(text) };
}

function formatJson(obj, style = jsonStyle(null)) {
  let s = JSON.stringify(obj, null, style.indent);
  if (style.eol === '\r\n') s = s.replace(/\n/g, '\r\n');
  return `${style.bom ? '\uFEFF' : ''}${s}${style.final ? style.eol : ''}`;
}

// Temp file + rename, so a crash never leaves half a settings file.
export function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.skill-dash.tmp`;
  fs.writeFileSync(tmp, text);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

const expandHome = (p) => (/^~[\\/]/.test(p) ? path.join(HOME, p.slice(2)) : p);
const folderOf = (p) => fwd(expandHome(p)).replace(/\/SKILL\.md$/i, '').replace(/\/$/, '');

// ---------- policy.json v2 (my baseline) ----------

const COMMENT = 'Your skill baseline. The skill dashboard (Invocation page) and `setup.mjs skills on|off` write it; the SessionStart hook compares every agent\'s settings with it. modes.<agent>.global and .projects["<dir>"] (only-me exceptions) map a skill name, or "path:<skill folder>" for one copy, to auto | manual | off.';

const emptyPolicy = () => ({
  $comment: COMMENT,
  version: 2,
  modes: {},
  removeIfReinstalled: [],
  localOnlySkills: [],
  localSkillProjects: [],
  stripSuperpowersBootstrap: false,
  userPlugins: { enable: {}, disable: [] },
  projectPluginRemovals: {},
});

// v1: "manualSkills" and "offSkills" name lists, plus `skills off` names in state.json.
// "off" no longer deletes the folder; the old offSkills become removeIfReinstalled so that still happens.
export function migrateV1(v1 = {}, state = {}) {
  const global = {};
  for (const n of v1.manualSkills ?? []) global[n] = 'manual';
  for (const n of [...(v1.offSkills ?? []), ...(state.disabled ?? [])]) global[n] = 'off';
  const { $comment, version, offSkills, manualSkills, ...rest } = v1;
  return { ...emptyPolicy(), modes: { claude: { global, projects: {} } }, removeIfReinstalled: [...(offSkills ?? [])], ...rest };
}

// Reading a v1 file moves it to v2 once: the original stays as policy.v1.json, and state.json keeps only install records.
export function loadPolicy() {
  const raw = readJson(POLICY_FILE, null);
  if (!raw) return emptyPolicy();
  if (raw.version >= 2) {
    // Missing keys go at the end, so rewriting the file keeps the user's key order.
    const p = { ...raw };
    for (const [k, v] of Object.entries(emptyPolicy())) if (!(k in p)) p[k] = v;
    return p;
  }
  const state = readJson(STATE_FILE, {});
  const v2 = migrateV1(raw, state);
  if (!exists(POLICY_V1_FILE)) fs.copyFileSync(POLICY_FILE, POLICY_V1_FILE);
  writeFileAtomic(POLICY_FILE, formatJson(v2));
  if (state.disabled) {
    const { disabled, ...keep } = state;
    writeFileAtomic(STATE_FILE, formatJson(keep));
  }
  return v2;
}

export const savePolicy = (policy) => writeFileAtomic(POLICY_FILE, formatJson(policy, jsonStyle(readText(POLICY_FILE))));

const projectKey = (m, dir) => Object.keys(m?.projects ?? {}).find((p) => samePath(p, dir));
const findKey = (map, key, caseless) => (key in map ? key : Object.keys(map).find((k) => keyEq(k, key, caseless)));
const keyEq = (a, b, caseless) => a === b
  || (a.startsWith('path:') && b.startsWith('path:') ? samePath(a.slice(5), b.slice(5)) : !!caseless && a.toLowerCase() === b.toLowerCase());

export function policyValue(policy, agent, key, project) {
  const m = policy.modes?.[agent];
  const map = project ? m?.projects?.[projectKey(m, project)] : m?.global;
  const k = map && findKey(map, key, agentDef(agent)?.caseless);
  return k === undefined ? undefined : map[k];
}

export function setPolicyValue(policy, agent, key, project, value) {
  const m = ((policy.modes ??= {})[agent] ??= { global: {}, projects: {} });
  m.global ??= {};
  m.projects ??= {};
  const pk = project ? projectKey(m, project) ?? fwd(project) : null;
  const map = project ? (m.projects[pk] ??= {}) : m.global;
  const k = findKey(map, key, agentDef(agent)?.caseless) ?? key;
  if (value === undefined) delete map[k];
  else map[k] = value;
  if (project && !Object.keys(map).length) delete m.projects[pk];
}

// ---------- agent settings formats ----------
// read(doc) → { values: Map<key, value>, hard?: Set<name> }. edit(doc, key, value, layer, alt) changes doc and returns
// preview lines [{ field, from, to }] (null = absent), or [] when nothing changes.

const TO_OVERRIDE = { auto: 'on', manual: 'user-invocable-only', off: 'off', 'name-only': 'name-only' };
const FROM_OVERRIDE = { on: 'auto', 'user-invocable-only': 'manual', off: 'off', 'name-only': 'name-only' };
const q = (v) => (v === undefined ? null : JSON.stringify(v));

// Claude Code and CodeBuddy Code: "skillOverrides": { "<name>": "on" | "user-invocable-only" | "off" | "name-only" }.
const overridesFormat = {
  kind: 'json',
  read(doc) {
    const values = new Map();
    for (const [k, v] of Object.entries(doc.obj.skillOverrides ?? {})) if (FROM_OVERRIDE[v]) values.set(k, FROM_OVERRIDE[v]);
    return { values };
  },
  edit(doc, key, value, layer) {
    const map = doc.obj.skillOverrides ?? {};
    const k = findKey(map, key) ?? key;
    const before = map[k];
    // Global auto is "no override", so upgrades that turn it off show up as a difference.
    const after = value === undefined || (layer === 'global' && value === 'auto') ? undefined : TO_OVERRIDE[value];
    if (before === after) return [];
    if (after === undefined) {
      delete map[k];
      if (!Object.keys(map).length) delete doc.obj.skillOverrides;
    } else (doc.obj.skillOverrides ??= {})[k] = after;
    return [{ field: `skillOverrides["${k}"]`, from: q(before), to: q(after) }];
  },
};

// Qwen Code: skills.disabled (forced off, cannot be undone elsewhere), skills.defaultDisabled (off unless enabled),
// skills.enabled (cancels defaultDisabled). Lists merge across scopes; names match case-insensitively.
const qwenFormat = {
  kind: 'json',
  read(doc) {
    const sk = doc.obj.skills ?? {};
    const list = (xs) => (Array.isArray(xs) ? xs.filter((x) => typeof x === 'string') : []);
    const values = new Map();
    const enabled = new Set(list(sk.enabled).map((x) => x.toLowerCase()));
    for (const n of list(sk.enabled)) values.set(n, 'auto');
    for (const n of list(sk.defaultDisabled)) if (!enabled.has(n.toLowerCase())) values.set(n, 'off');
    const hard = new Set(list(sk.disabled).map((x) => x.toLowerCase()));
    for (const n of list(sk.disabled)) values.set(n, 'off');
    return { values, hard };
  },
  edit(doc, key, value, layer) {
    const lines = [];
    const same = (x) => typeof x === 'string' && x.toLowerCase() === key.toLowerCase();
    const has = (list) => (doc.obj.skills?.[list] ?? []).some(same);
    const put = (list, on) => {
      if (has(list) === on) return;
      if (on) ((doc.obj.skills ??= {})[list] ??= []).push(key);
      else {
        const sk = doc.obj.skills;
        sk[list] = sk[list].filter((x) => !same(x));
        if (!sk[list].length) delete sk[list];
        if (!Object.keys(sk).length) delete doc.obj.skills;
      }
      lines.push({ field: `skills.${list}`, from: on ? null : q(key), to: on ? q(key) : null });
    };
    // Global auto just leaves both lists, so a project can still turn it off.
    put('defaultDisabled', value === 'off');
    put('enabled', value === 'auto' && layer !== 'global');
    return lines;
  },
};

// Codex: [[skills.config]] blocks in config.toml with a path (the SKILL.md) or name selector and `enabled`.
// Only these blocks are added or removed; the rest of the file is kept as it is.
const TOML_HEADER = /^\s*\[\[?\s*[\w"'.\- ]+?\s*\]\]?\s*(#.*)?$/;
function tomlString(raw) {
  const s = raw.trim();
  if (s.startsWith("'")) return s.slice(1, s.indexOf("'", 1));
  if (!s.startsWith('"')) return s.replace(/\s*#.*$/, '');
  let out = '';
  for (let i = 1; i < s.length && s[i] !== '"'; i++) {
    if (s[i] !== '\\') {
      out += s[i];
      continue;
    }
    const n = s[++i];
    if (n === 'u') {
      out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16));
      i += 4;
    } else out += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }[n] ?? n;
  }
  return out;
}
const tomlLiteral = (s) => (s.includes("'") ? JSON.stringify(s) : `'${s}'`);

function codexBlocks(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text === '' ? [] : text.split(/\r?\n/);
  const blocks = [];
  let cur = null;
  let section = '';
  let inline = false;
  lines.forEach((line, i) => {
    if (TOML_HEADER.test(line)) {
      if (cur) cur.end = i;
      section = line.trim().replace(/^\[+\s*|\s*\]+.*$/g, '');
      cur = /^\s*\[\[\s*skills\.config\s*\]\]/.test(line) ? { start: i, end: lines.length, sel: {} } : null;
      if (cur) blocks.push(cur);
      return;
    }
    if (/^\s*skills\.config\s*=/.test(line) || (section === 'skills' && /^\s*config\s*=/.test(line))) inline = true;
    const kv = cur && line.match(/^\s*(path|name|enabled)\s*=\s*(.*)$/);
    if (!kv) return;
    if (kv[1] === 'enabled') cur.enabled = /^true\b/.test(kv[2].trim());
    else cur.sel[kv[1]] = tomlString(kv[2]);
  });
  return { lines, blocks, eol, inline };
}
const codexKey = (b) => (b.sel.path ? `path:${folderOf(b.sel.path)}` : b.sel.name ?? null);

const codexFormat = {
  kind: 'toml',
  read(doc) {
    const values = new Map();
    for (const b of codexBlocks(doc.text).blocks) {
      const key = codexKey(b);
      if (key && b.enabled !== undefined) values.set(key, b.enabled ? 'auto' : 'off');
    }
    return { values };
  },
  edit(doc, key, value) {
    const { lines, blocks, eol, inline } = codexBlocks(doc.text);
    if (inline) throw Object.assign(new Error('skills.config is written inline; edit it by hand'), { code: 'inline-toml' });
    const mine = blocks.filter((b) => codexKey(b) && keyEq(codexKey(b), key));
    const before = mine.length ? mine.at(-1).enabled : undefined;
    const after = value === 'off' ? false : undefined;
    if (before === after && mine.length <= 1) return [];
    // Remove our blocks, but not the blank or comment lines after them (those lead into the next table),
    // then append one block if the skill stays off.
    const drop = new Set();
    for (const b of mine) {
      let end = b.end;
      while (end > b.start + 1 && (!lines[end - 1].trim() || /^\s*#/.test(lines[end - 1]))) end--;
      for (let i = b.start; i < end; i++) drop.add(i);
      if ((b.start === 0 || !lines[b.start - 1].trim()) && end < b.end && !lines[end].trim()) drop.add(end);
    }
    const out = lines.filter((_, i) => !drop.has(i));
    const selector = key.startsWith('path:') ? `path = ${tomlLiteral(path.join(path.normalize(key.slice(5)), 'SKILL.md'))}` : `name = ${JSON.stringify(key)}`;
    if (after === false) {
      while (out.length && !out.at(-1).trim()) out.pop();
      if (out.length) out.push('');
      out.push('[[skills.config]]', selector, 'enabled = false');
    }
    doc.text = out.length ? `${out.join(eol).replace(/\s+$/, '')}${eol}` : '';
    const state = (v) => (v === undefined ? null : `enabled = ${v}`);
    return [{ field: `[[skills.config]] ${selector}`, from: state(before), to: state(after) }];
  },
};

// ZCode: "skillOverrides": { "<skill folder>": { "enable": false } }.
const zcodeFormat = {
  kind: 'json',
  read(doc) {
    const values = new Map();
    for (const [k, v] of Object.entries(doc.obj.skillOverrides ?? {})) {
      if (v?.enable === false) values.set(`path:${folderOf(k)}`, 'off');
      else if (v?.enable === true) values.set(`path:${folderOf(k)}`, 'auto');
    }
    return { values };
  },
  edit(doc, key, value, layer) {
    const map = doc.obj.skillOverrides ?? {};
    const k = Object.keys(map).find((x) => samePath(folderOf(x), key.slice(5))) ?? path.normalize(key.slice(5));
    const before = map[k];
    const after = value === 'off' ? { enable: false } : value === 'auto' && layer !== 'global' ? { enable: true } : undefined;
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    if (after === undefined) {
      delete map[k];
      if (!Object.keys(map).length) delete doc.obj.skillOverrides;
    } else (doc.obj.skillOverrides ??= {})[k] = after;
    return [{ field: `skillOverrides["${fwd(k)}"]`, from: q(before), to: q(after) }];
  },
};

// ---------- agents ----------
// modes: values the settings can hold. layers: project layers the agent reads. key: how a skill is addressed.
// Files are absolute for global, and relative to the project for team and mine.

const MANAGED_SETTINGS = process.platform === 'win32'
  ? ['C:\\Program Files\\ClaudeCode\\managed-settings.json', 'C:\\ProgramData\\ClaudeCode\\managed-settings.json']
  : process.platform === 'darwin' ? ['/Library/Application Support/ClaudeCode/managed-settings.json'] : ['/etc/claude-code/managed-settings.json'];

export const MODE_AGENTS = [
  {
    id: 'claude', label: 'Claude Code', home: CLAUDE, format: overridesFormat, modes: VALUES, layers: ['mine', 'team'], key: 'name',
    global: USER_SETTINGS, team: '.claude/settings.json', mine: '.claude/settings.local.json', managed: MANAGED_SETTINGS,
  },
  {
    id: 'codebuddy', label: 'CodeBuddy Code', home: CODEBUDDY_HOME, format: overridesFormat, modes: VALUES, layers: ['mine', 'team'], key: 'name',
    global: path.join(CODEBUDDY_HOME, 'settings.json'), team: '.codebuddy/settings.json', mine: '.codebuddy/settings.local.json',
  },
  {
    id: 'qwen', label: 'Qwen Code', home: QWEN_HOME, format: qwenFormat, modes: ['auto', 'off'], layers: ['team'], key: 'name', caseless: true,
    global: path.join(QWEN_HOME, 'settings.json'), team: '.qwen/settings.json',
  },
  // Project exceptions wait for a test that Codex merges <project>/.codex/config.toml with the global file.
  {
    id: 'codex', label: 'Codex', home: CODEX_HOME, format: codexFormat, modes: ['auto', 'off'], layers: [], key: 'path', trial: true,
    global: path.join(CODEX_HOME, 'config.toml'),
  },
  {
    id: 'zcode', label: 'ZCode', home: ZCODE_HOME, format: zcodeFormat, modes: ['auto', 'off'], layers: ['team'], key: 'path',
    global: path.join(ZCODE_HOME, 'cli', 'config.json'), team: '.zcode/config.json',
  },
  { id: 'kimi', label: 'Kimi Code', home: KIMI_HOME, format: null, modes: [], layers: [], key: 'path', readOnly: 'kimi' },
];
export const agentDef = (id) => MODE_AGENTS.find((a) => a.id === id);

export function fileOf(def, layer, project) {
  if (layer === 'global') return def.global;
  return path.join(project, ...def[layer].split('/'));
}

function loadDoc(file, kind) {
  const text = readText(file);
  if (kind === 'toml') return { kind, file, text: text ?? '', original: text };
  const { obj, comments } = parseJsonText(text);
  return { kind, file, obj, comments, style: jsonStyle(text), original: text };
}
const serialize = (doc) => (doc.kind === 'toml' ? doc.text : formatJson(doc.obj, doc.style));

export function readValues(def, layer, project) {
  const file = fileOf(def, layer, project);
  try {
    const doc = loadDoc(file, def.format.kind);
    return { file, exists: doc.original != null, comments: !!doc.comments, ...def.format.read(doc) };
  } catch (e) {
    return { file, exists: exists(file), values: new Map(), error: e.message };
  }
}

// A value for `key`; path-keyed rows also match a name selector (Codex `name = "…"`).
export function lookup(def, values, key, altName) {
  for (const [k, v] of values) if (keyEq(k, key, def.caseless)) return v;
  if (altName) for (const [k, v] of values) if (keyEq(k, altName, def.caseless)) return v;
  return undefined;
}

function readManaged(def) {
  const values = new Map();
  for (const file of def.managed ?? []) {
    try {
      for (const [k, v] of Object.entries(parseJsonText(readText(file)).obj.skillOverrides ?? {})) if (FROM_OVERRIDE[v]) values.set(k, FROM_OVERRIDE[v]);
    } catch {
      /* unreadable managed settings: nothing is locked from it */
    }
  }
  return values;
}

// Every layer this agent has in these projects, for the dashboard.
export function readAgentValues(def, projects) {
  const out = { global: readValues(def, 'global'), mine: {}, team: {}, managed: readManaged(def) };
  for (const p of projects) {
    for (const layer of def.layers) {
      const v = readValues(def, layer, p);
      if (v.exists) out[layer][p] = v;
    }
  }
  return out;
}

// The mode an agent actually uses for one skill in one project (or anywhere), for the overview's "Invocation" column.
// Returns the Claude Code vocabulary: on | user-invocable-only | off | name-only.
export function modeReader(agentId) {
  const def = agentDef(agentId);
  if (!def?.format) return (s) => (s.fm?.['disable-model-invocation'] === 'true' ? 'user-invocable-only' : 'on');
  const cache = new Map();
  const values = (layer, p) => {
    const k = `${layer}|${p ?? ''}`;
    if (!cache.has(k)) cache.set(k, readValues(def, layer, p).values);
    return cache.get(k);
  };
  return ({ name, path: dir, fm, project }) => {
    const key = def.key === 'path' ? `path:${fwd(dir)}` : name;
    let v;
    if (project) for (const layer of ['mine', 'team']) if (v === undefined && def.layers.includes(layer)) v = lookup(def, values(layer, project), key, name);
    v ??= lookup(def, values('global'), key, name) ?? 'auto';
    if (fm?.['disable-model-invocation'] === 'true' && v !== 'off') v = 'manual';
    return TO_OVERRIDE[v] ?? 'on';
  };
}

// ---------- plan: resolved changes → files before and after ----------
// A change: { agent, key, name?, project?, layer: 'global'|'mine'|'team', kind: 'set'|'revert'|'adopt', value? }.
//   set    - write the value to the agent file and (except team) to the baseline. 'inherit' removes it.
//   revert - write the baseline value to the agent file.
//   adopt  - copy the agent file's value into the baseline.

export function planChanges(changes, policy = loadPolicy()) {
  const policyText = readText(POLICY_FILE);
  const policyDoc = { kind: 'json', file: POLICY_FILE, obj: structuredClone(policy), style: jsonStyle(policyText), original: policyText };
  const docs = new Map();
  const lines = new Map();
  const roles = new Map([[POLICY_FILE, 'policy']]);
  const errors = [];
  const add = (file, role, ls) => {
    if (!ls.length) return;
    lines.set(file, [...(lines.get(file) ?? []), ...ls]);
    roles.set(file, role);
  };
  for (const c of changes) {
    const def = agentDef(c.agent);
    const file = fileOf(def, c.layer, c.project);
    let doc = docs.get(file);
    try {
      if (!doc) docs.set(file, (doc = loadDoc(file, def.format.kind)));
    } catch (e) {
      errors.push({ file, code: 'parse', message: e.message });
      continue;
    }
    if (doc.comments) {
      errors.push({ file, code: 'comments', message: 'the file has comments, which would be lost' });
      continue;
    }
    const now = lookup(def, def.format.read(doc).values, c.key, c.name);
    const base = c.layer === 'team' ? undefined : policyValue(policyDoc.obj, def.id, c.key, c.project);
    // Nothing to go back to: an unmanaged value stays as it is.
    if (c.kind === 'revert' && base === undefined) continue;
    let actual;
    let baseline;
    let touchActual = false;
    let touchBase = false;
    if (c.kind === 'set') {
      actual = baseline = c.value === 'inherit' ? undefined : c.value;
      touchActual = true;
      touchBase = c.layer !== 'team';
    } else if (c.kind === 'revert') {
      actual = base;
      touchActual = true;
    } else if (c.kind === 'adopt') {
      baseline = c.layer === 'global' ? now ?? 'auto' : now;
      touchBase = true;
    }
    try {
      if (touchActual) add(file, c.layer === 'team' ? 'team' : 'mine', def.format.edit(doc, c.key, actual, c.layer, c.name));
    } catch (e) {
      errors.push({ file, code: e.code ?? 'edit', message: e.message });
      continue;
    }
    if (touchBase && base !== baseline) {
      setPolicyValue(policyDoc.obj, def.id, c.key, c.project, baseline);
      const where = c.project ? `projects["${fwd(c.project)}"]` : 'global';
      add(POLICY_FILE, 'policy', [{ field: `modes.${def.id}.${where}["${c.key}"]`, from: q(base), to: q(baseline) }]);
    }
  }
  const files = [];
  for (const doc of [policyDoc, ...docs.values()]) {
    if (!lines.has(doc.file)) continue;
    const after = serialize(doc);
    if (after === doc.original) continue;
    const layer = changes.find((c) => fileOf(agentDef(c.agent), c.layer, c.project) === doc.file);
    files.push({
      file: doc.file, role: roles.get(doc.file), created: doc.original == null, before: doc.original, after, lines: lines.get(doc.file),
      project: layer?.project ?? null, layer: doc.file === POLICY_FILE ? null : layer?.layer ?? null,
    });
  }
  // Baseline first, then my files, then team files: the order the preview shows them in.
  const order = { policy: 0, mine: 1, team: 2 };
  files.sort((a, b) => order[a.role] - order[b.role]);
  return { files, errors };
}

// ---------- write, back up, undo ----------

function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 8000, windowsHide: true });
  return { ok: r.status === 0, status: r.status, out: (r.stdout ?? '').trim() };
}

// A personal file this tool created must never be committed by accident.
function ensureExcluded(file) {
  const dir = path.dirname(file);
  if (!exists(dir)) return;
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  if (!top.ok || git(dir, ['check-ignore', '-q', file]).status === 0) return;
  const ex = git(dir, ['rev-parse', '--git-path', 'info/exclude']);
  if (!ex.ok) return;
  const excludeFile = path.resolve(dir, ex.out);
  const line = `/${fwd(path.relative(top.out, file))}`;
  const current = readText(excludeFile) ?? '';
  if (current.split(/\r?\n/).includes(line)) return;
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  fs.appendFileSync(excludeFile, `${current === '' || current.endsWith('\n') ? '' : '\n'}${line}\n`);
}

// Team files with changes git has not committed (modified or untracked).
export function uncommitted(files) {
  const dirty = new Set();
  for (const file of files) {
    if (!exists(file)) continue;
    const r = git(path.dirname(file), ['status', '--porcelain', '--', file]);
    if (r.ok && r.out) dirty.add(fwd(file));
  }
  return dirty;
}

function backup(files, stamp) {
  const dir = path.join(BACKUPS, stamp);
  const manifest = [];
  files.filter((f) => f.before != null).forEach((f, i) => {
    const name = `${String(i + 1).padStart(2, '0')}-${path.basename(f.file)}`;
    writeFileAtomic(path.join(dir, name), f.before);
    manifest.push({ file: fwd(f.file), backup: name });
  });
  if (manifest.length) writeFileAtomic(path.join(dir, 'manifest.json'), formatJson({ files: manifest }));
  const old = exists(BACKUPS) ? fs.readdirSync(BACKUPS).sort() : [];
  for (const d of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) fs.rmSync(path.join(BACKUPS, d), { recursive: true, force: true });
  return manifest.length ? fwd(dir) : null;
}

function restore(files) {
  for (const f of [...files].reverse()) {
    try {
      if (f.before == null) fs.rmSync(f.file, { force: true });
      else writeFileAtomic(f.file, f.before);
    } catch {
      /* best effort: the backup folder still has the original */
    }
  }
}

// All files or none: each file is read again right before writing, and a failure puts back the ones already written.
export function writePlan(plan) {
  if (plan.errors.length) throw Object.assign(new Error(plan.errors[0].message), { code: plan.errors[0].code, file: plan.errors[0].file });
  if (!plan.files.length) return { files: [], backupDir: null };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = backup(plan.files, stamp);
  const done = [];
  for (const f of plan.files) {
    try {
      if (readText(f.file) !== f.before) throw Object.assign(new Error('changed since the preview'), { code: 'changed' });
      writeFileAtomic(f.file, f.after);
      done.push(f);
    } catch (e) {
      restore(done);
      throw Object.assign(e, { file: fwd(f.file), code: e.code ?? 'write' });
    }
  }
  for (const f of plan.files) if (f.created && f.layer === 'mine') ensureExcluded(f.file);
  writeFileAtomic(UNDO_FILE, formatJson({ at: new Date().toISOString(), backupDir, files: plan.files.map(({ file, before, after }) => ({ file: fwd(file), before, after })) }));
  return { files: plan.files, backupDir };
}

export function lastApply() {
  const u = readJson(UNDO_FILE, null);
  return u ? { at: u.at, files: u.files.length, backupDir: u.backupDir } : null;
}

// Puts back the last apply, unless one of its files was changed again since.
export function undoLast() {
  const u = readJson(UNDO_FILE, null);
  if (!u) throw Object.assign(new Error('nothing to undo'), { code: 'no-undo' });
  const changed = u.files.filter((f) => readText(f.file) !== f.after).map((f) => f.file);
  if (changed.length) throw Object.assign(new Error(`changed since the apply: ${changed.join(', ')}`), { code: 'conflict', files: changed });
  const done = [];
  for (const f of [...u.files].reverse()) {
    try {
      if (f.before == null) fs.rmSync(f.file, { force: true });
      else writeFileAtomic(f.file, f.before);
      done.push({ file: f.file, before: f.after });
    } catch (e) {
      restore(done);
      throw Object.assign(e, { file: f.file, code: e.code ?? 'write' });
    }
  }
  fs.rmSync(UNDO_FILE, { force: true });
  return { files: u.files.map((f) => f.file) };
}

// ---------- drift: baseline vs agent settings (global and only-me layers; team files are git's business) ----------

export function modeDrift(policy = loadPolicy()) {
  const out = [];
  for (const def of MODE_AGENTS) {
    const m = policy.modes?.[def.id];
    if (!m || !def.format || !exists(def.home)) continue;
    const g = readValues(def, 'global');
    if (!g.error) {
      for (const [key, want] of Object.entries(m.global ?? {})) {
        if (key.startsWith('path:') && !exists(key.slice(5))) continue;
        const have = lookup(def, g.values, key) ?? 'auto';
        if (have !== want) out.push({ agent: def.id, label: def.label, key, layer: 'global', want, have, file: fwd(g.file) });
      }
    }
    if (!def.layers.includes('mine')) continue;
    for (const [p, map] of Object.entries(m.projects ?? {})) {
      if (!exists(p)) continue;
      const v = readValues(def, 'mine', p);
      if (v.error) continue;
      for (const [key, want] of Object.entries(map)) {
        const have = lookup(def, v.values, key);
        if (have !== want) out.push({ agent: def.id, label: def.label, key, layer: 'mine', project: p, want, have, file: fwd(v.file) });
      }
    }
  }
  return out;
}

export const driftChanges = (drift, kind) => drift.map((d) => ({ agent: d.agent, key: d.key, project: d.project, layer: d.layer, kind }));

// ---------- the dashboard's view: skills per agent with baseline and actual values ----------

const under = (p, dir) => !!p && (samePath(p, dir) || fwd(p).toLowerCase().startsWith(`${fwd(dir).toLowerCase()}/`));

// Inventory rows (skill-stats.mjs) → one row per skill name (name-keyed agents) or per copy (path-keyed agents).
function modeRows(def, rows) {
  const out = [];
  const autoTokens = (s) => (s.listingTokens ? s.listingExact ?? s.listingTokens : s.autoTokens ?? 0);
  const base = (s) => ({
    path: s.path, category: s.category, summary: s.summary, origin: s.origin, tokens: autoTokens(s), uses30: s.uses30 ?? 0,
    plugin: s.scope === 'plugin', pluginId: s.pluginId ?? null, pluginOn: s.mode !== 'plugin-off', fm: !!s.fm,
    shared: under(s.path, AGENTS_SKILLS), system: s.scope === 'system',
  });
  if (def.key === 'name') {
    const byName = new Map();
    for (const s of rows) byName.set(s.name, [...(byName.get(s.name) ?? []), s]);
    for (const [name, list] of byName) {
      const rep = ['user', 'plugin', 'system'].map((sc) => list.find((s) => s.scope === sc)).find(Boolean) ?? list[0];
      const only = list.every((s) => s.scope === 'project') ? [...new Set(list.map((s) => s.project))] : null;
      out.push({ id: name, key: name, name, ...base(rep), uses30: list.reduce((a, s) => a + (s.uses30 ?? 0), 0), only });
    }
    return out;
  }
  const seen = new Set();
  for (const s of rows) {
    const dupKey = `${s.project}|${s.name}`;
    out.push({ id: `path:${fwd(s.path)}`, key: `path:${fwd(s.path)}`, name: s.name, ...base(s), only: s.project ? [s.project] : null, dup: !!s.dup, extra: !!s.dup && seen.has(dupKey) });
    seen.add(dupKey);
  }
  return out;
}

// stats: the collect() result. Returns the shape the Invocation page reads, plus an index to check requests against.
export function buildModes(stats) {
  const policy = loadPolicy();
  const projects = [...(stats.projects ?? [])];
  for (const m of Object.values(policy.modes ?? {})) {
    for (const p of Object.keys(m.projects ?? {})) if (exists(p) && !projects.some((x) => samePath(x.dir, p))) projects.push({ dir: fwd(p), last: null });
  }
  const dirs = projects.map((p) => p.dir);
  const canon = (p) => dirs.find((d) => samePath(d, p)) ?? fwd(p);
  const agents = [];
  const missing = [];
  const teamFiles = [];
  for (const def of MODE_AGENTS) {
    const sa = stats.agents.find((a) => a.id === def.id);
    const found = exists(def.home);
    if (!found && !sa?.transcripts) {
      missing.push({ id: def.id, label: def.label });
      continue;
    }
    const rows = modeRows(def, stats.skills.filter((s) => s.agent === def.id && s.scope !== 'other'));
    const vals = def.format ? readAgentValues(def, dirs) : null;
    // Codex leaves turned-off skills out of the listing it sends, so add them back from config.toml.
    if (def.id === 'codex' && vals) {
      for (const [key, v] of vals.global.values) {
        if (v !== 'off' || !key.startsWith('path:') || rows.some((r) => samePath(r.key.slice(5), key.slice(5)))) continue;
        const dir = key.slice(5);
        if (!exists(path.join(dir, 'SKILL.md'))) continue;
        rows.push({ id: key, key, name: path.basename(dir), path: fwd(dir), category: 'other', summary: '', origin: { kind: 'unknown', label: '', url: '', via: { kind: 'none' } }, tokens: 0, uses30: 0, only: null, plugin: false, fm: false, shared: under(dir, AGENTS_SKILLS), dup: false, extra: false });
      }
    }
    for (const r of rows) {
      r.policy = { global: policyValue(policy, def.id, r.key), mine: {} };
      r.actual = { global: undefined, mine: {}, team: {} };
      if (!vals) continue;
      r.actual.global = lookup(def, vals.global.values, r.key, r.name);
      for (const layer of def.layers) {
        for (const [p, v] of Object.entries(vals[layer])) {
          const val = lookup(def, v.values, r.key, r.name);
          if (val !== undefined) r.actual[layer][p] = val;
        }
      }
      const pol = policy.modes?.[def.id]?.projects ?? {};
      for (const [p, map] of Object.entries(pol)) {
        const k = findKey(map, r.key, def.caseless);
        if (k !== undefined) r.policy.mine[canon(p)] = map[k];
      }
      const managed = lookup(def, vals.managed, r.key);
      if (managed !== undefined) Object.assign(r, { lock: 'managed', lockValue: managed });
      else if (vals.global.hard?.has(r.name.toLowerCase())) r.lock = 'hard';
    }
    const files = vals ? [vals.global, ...def.layers.flatMap((l) => Object.values(vals[l]))] : [];
    if (vals) teamFiles.push(...Object.values(vals.team).map((v) => v.file));
    agents.push({
      id: def.id, label: def.label, found, transcripts: sa?.transcripts ?? 0, noLogs: !!sa?.noLogs,
      modes: def.modes, layers: def.layers, key: def.key, trial: !!def.trial,
      readOnly: def.readOnly ?? (!found ? 'missing' : null),
      files: { global: def.global ? fwd(def.global) : null, team: def.team ?? null, mine: def.mine ?? null },
      problems: files.filter((f) => f.error || f.comments).map((f) => ({ file: fwd(f.file), code: f.error ? 'parse' : 'comments', message: f.error ?? '' })),
      skills: rows,
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    policyFile: fwd(POLICY_FILE),
    migrated: exists(POLICY_V1_FILE),
    projects: projects.map((p) => ({ dir: p.dir, name: path.basename(p.dir), last: p.last })),
    agents,
    missing,
    teamDirty: [...uncommitted(teamFiles)],
    lastApply: lastApply(),
  };
}

// Checks one request from the page against what the page was shown, and resolves it to a change planChanges takes.
// Returns [change, null] or [null, reason].
export function resolveChange(modes, req) {
  const a = modes.agents.find((x) => x.id === req?.agent);
  if (!a) return [null, 'agent'];
  const def = agentDef(a.id);
  if (a.readOnly || !def.format) return [null, 'read-only'];
  const row = a.skills.find((s) => s.id === req.id);
  if (!row) return [null, 'skill'];
  if (row.plugin) return [null, 'plugin'];
  if (row.lock) return [null, row.lock];
  const kind = req.kind ?? 'set';
  if (!['set', 'revert', 'adopt'].includes(kind)) return [null, 'kind'];
  let layer = 'global';
  let project = null;
  if (req.scope !== 'global') {
    const i = String(req.scope ?? '').lastIndexOf('|');
    layer = String(req.scope).slice(i + 1);
    project = modes.projects.find((p) => samePath(p.dir, String(req.scope).slice(0, i)))?.dir;
    if (!project) return [null, 'project'];
    if (!a.layers.includes(layer)) return [null, 'layer'];
    if (row.only && !row.only.some((p) => samePath(p, project))) return [null, 'not-in-project'];
  }
  if (kind === 'set') {
    if (req.value === 'inherit' ? layer === 'global' : !a.modes.includes(req.value)) return [null, 'value'];
    if (req.value === 'auto' && row.fm) return [null, 'fm'];
  } else if (layer === 'team') return [null, 'layer'];
  return [{ agent: a.id, key: row.key, name: row.name, project, layer, kind, value: req.value }, null];
}
