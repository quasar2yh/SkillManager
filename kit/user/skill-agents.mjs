// 코딩 에이전트별 대화 기록 → 스킬 호출과 토큰 사용량. skill-stats.mjs가 쓴다.
// 기록 형식은 에이전트마다 달라도 scan()의 결과는 같은 모양이다:
//   { cwd, session, subagent,
//     events: [{ id, skill, via: 'model'|'user', ts, project, session, subagent, file?, loadTokens?, contextDelta? }],
//     (file: the SKILL.md that was read, when the log says; it tells two copies of one skill apart)
//     usage: { 'YYYY-MM-DD': { requests, input, output, cached } },
//     listing?: { ts, cwd, text } }   // Codex만: 그 세션이 실제로 보낸 스킬 목록
import fs from 'node:fs';
import path from 'node:path';
import { HOME, CLAUDE, exists, fwd, estimateTokens } from './skill-inventory.mjs';

export const CODEX_HOME = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(HOME, '.codex');
export const GEMINI_HOME = path.join(HOME, '.gemini');
export const COPILOT_HOME = path.join(HOME, '.copilot');
// `npx skills` and Codex share this folder.
export const AGENTS_SKILLS = path.join(HOME, '.agents', 'skills');
// Bump when a scanner's output changes; stored files scanned by an older version are read again.
export const SCAN_VERSION = 3;

// Local calendar day, so "today" and the 30-day window match the user's clock.
export const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function walkFiles(dir, test) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return walkFiles(p, test);
    return test(p) ? [p] : [];
  });
}
const isJsonl = (p) => p.endsWith('.jsonl');
const readLines = (file) => fs.readFileSync(file, 'utf8').split('\n');
const parseLine = (line) => {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

function addUsage(usage, ts, input, output, cached) {
  if (!ts || !(input || output)) return;
  const d = (usage[dayKey(ts)] ??= { requests: 0, input: 0, output: 0, cached: 0 });
  d.requests++;
  d.input += input || 0;
  d.output += output || 0;
  d.cached += cached || 0;
}

const SKILL_FILE = /[\\/]([^\\/]+)[\\/]SKILL\.md$/i;
const skillFromPath = (p) => (typeof p === 'string' ? p.match(SKILL_FILE)?.[1] ?? null : null);
const stripBefore = (events) => events.map(({ before, ...ev }) => ev);

// ---------- Claude Code: ~/.claude/projects/**/*.jsonl ----------

const SKILL_BODY = 'Base directory for this skill:';
const totalInput = (u) => (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : '');

// One event per skill load. The model calls the Skill tool (via: model), or the user types /name (via: user).
// Either way Claude Code injects the SKILL.md body as a meta user message starting with SKILL_BODY.
// contextDelta = context size on the next model call minus the one before the load: the measured cost of loading it.
function scanClaude(file) {
  const events = [];
  const byToolUse = new Map();
  // Streaming writes one line per content block with the same message id; the last line has the final usage.
  const usageById = new Map();
  let cwd = null;
  let session = null;
  let subagent = false;
  let lastTotal = 0;
  let command = null;
  let pending = [];
  for (const line of readLines(file)) {
    const e = parseLine(line);
    const msg = e?.message;
    if (!msg) continue;
    cwd ??= e.cwd ?? null;
    session ??= e.sessionId ?? null;
    subagent ||= !!e.isSidechain;
    const base = { ts: e.timestamp, project: e.cwd ?? cwd, session: e.sessionId, subagent: !!e.isSidechain };
    if (e.type === 'assistant') {
      if (msg.usage && msg.model !== '<synthetic>') usageById.set(msg.id ?? e.uuid, { ts: e.timestamp, u: msg.usage });
      const total = msg.usage ? totalInput(msg.usage) : 0;
      if (total && pending.length) {
        for (const ev of pending) if (ev.before && total > ev.before) ev.contextDelta = total - ev.before;
        pending = [];
      }
      if (total) lastTotal = total;
      for (const c of Array.isArray(msg.content) ? msg.content : []) {
        if (c.type !== 'tool_use' || c.name !== 'Skill' || !c.input?.skill) continue;
        const ev = { id: c.id, skill: c.input.skill.replace(/^\//, ''), via: 'model', ...base, before: lastTotal };
        byToolUse.set(c.id, ev);
        events.push(ev);
      }
    } else if (e.type === 'user') {
      const text = textOf(msg.content);
      const cmd = text.match(/<command-name>\/?([^<\s]+)<\/command-name>/);
      if (cmd) command = { name: cmd[1], before: lastTotal };
      else if (e.isMeta && text.startsWith(SKILL_BODY)) {
        let ev = byToolUse.get(e.sourceToolUseID);
        if (!ev) {
          const dir = text.slice(SKILL_BODY.length).split('\n')[0].trim();
          ev = { id: e.uuid, skill: command?.name ?? path.basename(dir), via: command ? 'user' : 'model', ...base, before: command?.before ?? lastTotal };
          events.push(ev);
        }
        ev.loadTokens = estimateTokens(text);
        pending.push(ev);
        command = null;
      } else if (!e.isMeta) command = null;
    }
  }
  const usage = {};
  for (const { ts, u } of usageById.values()) addUsage(usage, ts, totalInput(u), u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0);
  return { cwd, session, subagent, events: stripBefore(events), usage };
}

// ---------- Codex: $CODEX_HOME/sessions/**/rollout-*.jsonl ----------

// "<skills_instructions>" lists skills as "- name: description (file: r0/dir/SKILL.md)" with a roots table.
export function parseCodexListing(text) {
  const roots = {};
  const entries = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const root = line.match(/^- `(r\d+)` = `(.+)`$/);
    if (root) {
      roots[root[1]] = fwd(root[2]);
      continue;
    }
    // Greedy name: plugin skills are "plugin:skill: description".
    const m = line.match(/^- (\S+):\s*(.*?)\s*\(file: (r\d+)\/(.+?SKILL\.md)\)$/);
    if (!m) continue;
    const base = roots[m[3]];
    entries.push({ name: m[1], line, root: base ?? '', file: base ? `${base}/${m[4]}` : m[4] });
  }
  return { roots, entries };
}

function codexSkillName(p, byPath) {
  const f = fwd(p);
  const listed = byPath.get(f.toLowerCase());
  if (listed) return listed;
  const plugin = f.match(/\/plugins\/cache\/[^/]+\/([^/]+)\/[^/]+\/skills\/([^/]+)\/SKILL\.md$/i);
  return plugin ? `${plugin[1]}:${plugin[2]}` : skillFromPath(f);
}

// Skill use in Codex:
//   user  - "[$name](…/SKILL.md)" links from the app, or "$name" typed in the CLI, in the user's message.
//   model - Codex reads a SKILL.md with a shell command (parsed_cmd type "read"), or injects "<skill>…</skill>".
// One event per turn and skill: a $mention followed by a read is one use. Forked subagents replay the parent's
// history with the parent's turn ids, so their copies share the parent's event id and are dropped in collect().
// Guardian (auto-review) sessions quote the transcript they review; they add usage but no skill events.
function scanCodex(file) {
  const events = new Map();
  const usage = {};
  let cwd = null;
  let session = null;
  let subagent = false;
  let guardian = false;
  let turn = null;
  let listing = null;
  let byPath = new Map();
  let known = new Set();
  let lastCtx = 0;
  let lastSig = null;
  let pending = [];

  const measuring = new Set();
  // `read`: a shell read is issued by one request and its output lands in the one after, so compare those two.
  // Otherwise (a $mention or an injected <skill>) the next request carries it; compare with the one before.
  // A read after a $mention at the start of a session still gets measured, as there is no earlier request.
  const use = (skill, via, ts, turnId, { read = false, ...extra } = {}) => {
    if (!skill || guardian) return;
    const key = `${turnId ?? `${session}:${ts}`}|${skill}`;
    let ev = events.get(key);
    if (!ev) {
      ev = { id: `codex:${key}`, skill, via, ts, project: cwd, session, subagent };
      events.set(key, ev);
    } else if (via === 'user') ev.via = 'user';
    Object.assign(ev, extra);
    if (measuring.has(ev)) return;
    if (read) pending.push({ ev, before: null });
    else if (lastCtx) pending.push({ ev, before: lastCtx });
    else return;
    measuring.add(ev);
  };
  const mentions = (text, ts, turnId) => {
    const names = new Set([...text.matchAll(/\[\$([^\]\s]+)\]\(/g)].map((m) => m[1]));
    for (const m of text.matchAll(/(?:^|\s)\$([A-Za-z][\w.:-]*)/g)) if (known.has(m[1])) names.add(m[1]);
    for (const n of names) use(n, 'user', ts, turnId);
  };

  for (const line of readLines(file)) {
    const e = parseLine(line);
    if (!e) continue;
    const p = e.payload ?? {};
    const ts = e.timestamp;
    const turnOf = () => p.internal_chat_message_metadata_passthrough?.turn_id ?? p.turn_id ?? turn;
    if (e.type === 'session_meta') {
      if (session) continue;
      session = p.id ?? null;
      cwd = p.cwd ?? cwd;
      guardian = p.source?.subagent?.other === 'guardian' || p.thread_source === 'guardian_review';
      subagent = !!p.source?.subagent;
    } else if (e.type === 'turn_context') {
      cwd = p.cwd ?? cwd;
      turn = p.turn_id ?? turn;
    } else if (e.type === 'event_msg') {
      if (p.type === 'task_started') turn = p.turn_id ?? turn;
      else if (p.type === 'token_count' && p.info?.last_token_usage) {
        // The same totals are re-sent with rate-limit updates; count each response once.
        const sig = JSON.stringify(p.info.total_token_usage ?? p.info.last_token_usage);
        if (sig === lastSig) continue;
        lastSig = sig;
        const last = p.info.last_token_usage;
        const ctx = last.input_tokens ?? 0;
        addUsage(usage, ts, ctx, last.output_tokens ?? 0, last.cached_input_tokens ?? 0);
        pending = pending.filter((x) => {
          if (x.before == null) {
            x.before = ctx;
            return true;
          }
          if (ctx > x.before) x.ev.contextDelta = ctx - x.before;
          return false;
        });
        if (ctx) lastCtx = ctx;
      } else if (p.type === 'user_message' && typeof p.message === 'string') mentions(p.message, ts, turnOf());
      else {
        // item_completed (current) or exec_command_end (older) carry the parsed shell command.
        const parsed = p.item?.type === 'CommandExecution' ? p.item.parsed_cmd : p.type === 'exec_command_end' ? p.parsed_cmd : null;
        for (const c of Array.isArray(parsed) ? parsed : []) {
          if (c.type === 'read' && SKILL_FILE.test(c.path ?? '')) use(codexSkillName(c.path, byPath), 'model', ts, turnOf(), { read: true, file: fwd(c.path) });
        }
      }
    } else if (e.type === 'response_item' && p.type === 'message') {
      for (const c of Array.isArray(p.content) ? p.content : []) {
        const text = typeof c.text === 'string' ? c.text : '';
        if (p.role === 'developer' && text.startsWith('<skills_instructions>')) {
          listing = { ts, cwd, text };
          const parsedListing = parseCodexListing(text);
          byPath = new Map(parsedListing.entries.map((x) => [x.file.toLowerCase(), x.name]));
          known = new Set(parsedListing.entries.map((x) => x.name));
        } else if (p.role === 'user' && text.startsWith('<skill>')) {
          const name = text.match(/<name>([^<]+)<\/name>/)?.[1]?.trim();
          const file = text.match(/<path>([^<]+)<\/path>/)?.[1]?.trim();
          use(name, 'model', ts, turnOf(), { loadTokens: estimateTokens(text), ...(file ? { file: fwd(file) } : {}) });
        } else if (p.role === 'user' && !text.startsWith('<') && !text.startsWith('# AGENTS.md')) mentions(text, ts, turnOf());
      }
    }
    // "compacted" records replay earlier history; skipping them avoids counting a use twice.
  }
  return { cwd, session, subagent, events: [...events.values()], usage, listing };
}

// ---------- Gemini CLI: ~/.gemini/tmp/<project>/chats/session-*.json ----------

// The model loads a skill with the activate_skill tool, or reads its SKILL.md with read_file.
// The tool result reaches the model on the next request, so the next "gemini" message measures it.
function scanGemini(file) {
  let chat;
  try {
    chat = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { cwd: null, session: null, subagent: false, events: [], usage: {} };
  }
  const rootFile = path.join(path.dirname(path.dirname(file)), '.project_root');
  const cwd = exists(rootFile) ? fs.readFileSync(rootFile, 'utf8').trim() : null;
  const session = chat.sessionId ?? path.basename(file, '.json');
  const subagent = !!chat.kind && chat.kind !== 'main';
  const events = [];
  const usage = {};
  let pending = [];
  for (const m of chat.messages ?? []) {
    if (m.type !== 'gemini') continue;
    const input = m.tokens?.input ?? 0;
    if (m.tokens) addUsage(usage, m.timestamp, input, (m.tokens.output ?? 0) + (m.tokens.thoughts ?? 0), m.tokens.cached ?? 0);
    if (input) {
      for (const x of pending) if (input > x.before) x.ev.contextDelta = input - x.before;
      pending = [];
    }
    for (const tc of m.toolCalls ?? []) {
      const args = tc.args ?? {};
      const read = /read_file/.test(tc.name ?? '') ? args.file_path ?? args.absolute_path ?? args.path : null;
      const skill = tc.name === 'activate_skill' ? args.name : skillFromPath(read);
      if (!skill) continue;
      const ev = { id: `gemini:${session}:${tc.id}`, skill, via: 'model', ts: tc.timestamp ?? m.timestamp, project: cwd, session, subagent, ...(read ? { file: fwd(read) } : {}) };
      events.push(ev);
      if (input) pending.push({ ev, before: input });
    }
  }
  return { cwd, session, subagent, events, usage };
}

// ---------- Anything else with JSONL logs (GitHub Copilot CLI): best-effort ----------

// The format is not documented, so look for shapes rather than exact fields: a tool call whose name is a skill tool
// (skill, activate_skill) or a read of a SKILL.md, and token counts under a `usage` key or on a usage event.
function scanGeneric(agent) {
  return (file) => {
    const events = new Map();
    const usage = {};
    let cwd = null;
    let session = null;
    readLines(file).forEach((line, i) => {
      const e = parseLine(line);
      if (!e || typeof e !== 'object') return;
      const ts = e.timestamp ?? e.time ?? e.data?.timestamp ?? null;
      const usageLine = /usage/i.test(e.type ?? '');
      const visit = (o, key) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) return o.forEach((x) => visit(x, key));
        if (typeof o.cwd === 'string') cwd ??= o.cwd;
        if (typeof o.sessionId === 'string') session ??= o.sessionId;
        const tool = o.toolName ?? o.tool_name ?? (typeof o.name === 'string' && (o.arguments ?? o.args ?? o.input) ? o.name : null);
        if (typeof tool === 'string') {
          let args = o.arguments ?? o.args ?? o.input ?? {};
          if (typeof args === 'string') args = parseLine(args) ?? {};
          const read = /read|view|cat/i.test(tool) ? args.path ?? args.file_path ?? args.filePath : null;
          const skill = /^(skill|activate_skill|use_skill)$/i.test(tool) ? args.skill ?? args.name : skillFromPath(read);
          if (typeof skill === 'string' && skill) {
            const id = `${agent}:${o.toolCallId ?? o.tool_call_id ?? o.callId ?? `${fwd(file)}:${i}`}`;
            const at = typeof read === 'string' && SKILL_FILE.test(read) ? { file: fwd(read) } : {};
            if (!events.has(id)) events.set(id, { id, skill: skill.replace(/^\//, ''), via: 'model', ts, project: cwd, session, subagent: false, ...at });
          }
        }
        if (key === 'usage' || usageLine) {
          const input = o.inputTokens ?? o.input_tokens ?? o.promptTokens ?? o.prompt_tokens;
          const output = o.outputTokens ?? o.output_tokens ?? o.completionTokens ?? o.completion_tokens;
          if (typeof input === 'number' || typeof output === 'number') addUsage(usage, ts, input ?? 0, output ?? 0, o.cacheReadTokens ?? o.cached_tokens ?? 0);
        }
        for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') visit(v, k);
      };
      visit(e, '');
    });
    return { cwd, session: session ?? path.basename(file, '.jsonl'), subagent: false, events: [...events.values()], usage };
  };
}

// ---------- registry ----------

// `logs` is where transcripts are read from. `skillDirs` are the personal skill folders each agent loads
// on its own; project folders are added per project in skill-stats.mjs.
export const AGENTS = [
  {
    id: 'claude', label: 'Claude Code', home: CLAUDE, logs: [path.join(CLAUDE, 'projects')],
    files: () => walkFiles(path.join(CLAUDE, 'projects'), isJsonl), scan: scanClaude,
  },
  {
    id: 'codex', label: 'Codex', home: CODEX_HOME, logs: [path.join(CODEX_HOME, 'sessions'), path.join(CODEX_HOME, 'archived_sessions')],
    files: () => [...walkFiles(path.join(CODEX_HOME, 'sessions'), isJsonl), ...walkFiles(path.join(CODEX_HOME, 'archived_sessions'), isJsonl)],
    scan: scanCodex, projectSkills: ['.agents/skills'],
  },
  {
    id: 'gemini', label: 'Gemini CLI', home: GEMINI_HOME, logs: [path.join(GEMINI_HOME, 'tmp')],
    files: () => walkFiles(path.join(GEMINI_HOME, 'tmp'), (p) => /[\\/]chats[\\/]session-[^\\/]*\.json$/.test(p)),
    scan: scanGemini, skillDirs: [path.join(GEMINI_HOME, 'skills')], projectSkills: ['.gemini/skills'],
  },
  {
    id: 'copilot', label: 'GitHub Copilot CLI', home: COPILOT_HOME, logs: [path.join(COPILOT_HOME, 'session-state')],
    files: () => walkFiles(path.join(COPILOT_HOME, 'session-state'), isJsonl),
    scan: scanGeneric('copilot'), skillDirs: [path.join(COPILOT_HOME, 'skills')], projectSkills: ['.github/skills'], experimental: true,
  },
];
