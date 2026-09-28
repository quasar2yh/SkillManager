# Project Template

여러 사람이 오래 끌고 가는 프로젝트에서 Claude Code(와 Codex)가 같은 작업 흐름을 쓰도록 하는
설정 모음. 스킬을 적게, 단계에 맞게만 쓰도록 묶어 두어 토큰 낭비와 엉뚱한 고정 결과를 줄인다.

- **사용자 범위** (PC마다 한 번): 플러그인, 스킬 정책(겹치는 스킬을 명시 전용으로), 업그레이드 뒤
  정책이 되돌아가면 적용 전에 물어보는 훅.
- **프로젝트 범위** (프로젝트마다): 작업 흐름 문서, 프로젝트 스킬, 상태 표시·동기화 훅, 기본 권한.

요구 사항: Node.js 18+, Python 3.9+, git, Claude Code CLI(`claude`).

## 빠른 시작

```bash
git clone <이 저장소> Project_Template
cd Project_Template

# 1) PC마다 한 번. 팀원도 각자 실행한다.
node setup.mjs user

# 2) 프로젝트마다. 기존 파일은 덮어쓰지 않고, settings.json은 병합한다.
node setup.mjs project ../my-project              # 기본
node setup.mjs project ../my-app --expo --frontend  # Expo 앱 + UI
node setup.mjs project ../my-svc --gitlab           # GitLab CI 스킬 포함

# 3) 확인
node setup.mjs check
```

설치 후 Claude Code를 새로 연다. 프로젝트에서는 `AGENTS.md`의 `<...>` 자리와
`docs/ROADMAP.md`를 채우고 커밋한다.

## 무엇이 설치되나

### `node setup.mjs user`

| 항목 | 위치 |
| --- | --- |
| Superpowers, Codex 플러그인 (사용자 범위) | `claude plugin install` |
| 스킬 정책 스크립트와 정책 파일 | `~/.claude/skill-policy/` |
| `skillOverrides` (겹치는 스킬을 명시 전용으로) | `~/.claude/settings.json` |
| 세션 시작 시 정책 점검 훅 | `~/.claude/settings.json` |

Superpowers의 `using-superpowers` 부트스트랩(매 세션 전문 주입)은 제거한다. 나머지 Superpowers
스킬은 설명만 보고 자동으로 걸린다.

gstack, BrowserOS 같은 개인 도구는 설치하지 않는다. 설치돼 있으면 정책이 적용될 뿐이다.

옵션 `--local-project <dir>`: 개인 전용 스킬(`policy.json`의 `localOnlySkills`)을 전역이 아니라 그
프로젝트에만 두고 명시 전용으로 만든다. `.git/info/exclude`로 팀 커밋에서 뺀다. 여러 번 줄 수 있다.

### `node setup.mjs project <dir>`

| 항목 | 설명 |
| --- | --- |
| `docs/WORKFLOW.md` | 단계별 스킬 순서, 출처, 자동/명시 구분 |
| `AGENTS.md` = `CLAUDE.md` | 에이전트 공통 지침 (한쪽을 고치면 훅이 다른 쪽을 맞춘다) |
| `CONTEXT.md`, `docs/adr/`, `docs/ROADMAP.md`, `docs/plans/{backlog,active,done}/` | 용어·결정·작업 상태 |
| `.claude/skills/` | `plan-board` + mattpocock/skills 8종 (`--gitlab`이면 `gitlab-ci-skill`) |
| `.claude/hooks/session_status.py` | 세션 시작 시 진행 중·다음 작업을 주입 |
| `.claude/hooks/post_edit.py` | `.claude/skills` → `.agents/skills`(Codex용) 복사, AGENTS/CLAUDE 동기화 |
| `.claude/settings.json` | 위 훅, `.env`·키 파일 읽기 금지 등 기본 권한 |

옵션: `--expo`(expo 플러그인), `--frontend`(frontend-design 플러그인), `--gitlab`, `--force`(기존 파일 덮어쓰기).

## 스킬 정책 바꾸기

`~/.claude/skill-policy/policy.json`을 고친 뒤:

```bash
node ~/.claude/skill-policy/skill-policy.mjs --apply
```

| 키 | 뜻 |
| --- | --- |
| `offSkills` | 완전히 끈다 (`skillOverrides: off`, 다시 설치돼도 지운다) |
| `manualSkills` | 명시 전용 (`/이름`으로만 호출) |
| `localOnlySkills`, `localSkillProjects` | 개인 스킬을 지정한 프로젝트에만 둔다 |
| `stripSuperpowersBootstrap` | 매 세션 주입되는 using-superpowers를 뺀다 |
| `userPlugins` | 사용자 범위에서 켤·끌 플러그인 |
| `projectPluginRemovals` | 특정 프로젝트 설정에서 빼야 할 플러그인 (`{"<settings.json 경로>": ["id"]}`) |

gstack 업그레이드, 플러그인 업데이트, `npx skills` 업데이트, BrowserOS가 설정을 되돌리면 다음 세션
시작 때 훅이 감지하고, Claude가 되돌릴지 먼저 묻는다. 자동으로 고치지 않는다.

## 이 템플릿 갱신하기

- 서드파티 스킬 갱신 절차는 `kit/project/.claude/skills/THIRD_PARTY_NOTICES.md`에 있다.
- 이미 설치한 프로젝트에 새 파일만 반영하려면 `node setup.mjs project <dir>`를 다시 실행한다.
  기존 파일은 그대로 두고, 없는 파일과 settings.json의 새 항목만 더한다.
