**한국어** | [English](docs/README-EN.md) | [简体中文](docs/README-CN.md)

# Project Template

여러 사람이 오래 끌고 가는 프로젝트에서 Claude Code(와 Codex)가 같은 작업 흐름을 쓰도록 하는
설정 모음. 스킬을 적게, 단계에 맞게만 쓰도록 묶어 두어 토큰 낭비와 엉뚱한 고정 결과를 줄인다.

- **사용자 범위** (PC마다 한 번): 플러그인, 스킬 정책, 스킬 세트 관리기, 업그레이드 뒤 정책이
  되돌아가면 적용 전에 물어보는 훅.
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

# 4) (선택) 분야별 스킬 세트 설치
node setup.mjs skills list
node setup.mjs skills add documents
```

설치 후 Claude Code를 새로 연다. 프로젝트에서는 `AGENTS.md`의 `<...>` 자리와
`docs/ROADMAP.md`를 채우고 커밋한다.

## 무엇이 설치되나

### `node setup.mjs user`

| 항목 | 위치 |
| --- | --- |
| Superpowers, Codex 플러그인 (사용자 범위) | `claude plugin install` |
| 스킬 정책 스크립트와 정책 파일 | `~/.claude/skill-policy/` |
| 스킬 세트 관리기와 카탈로그 (`skill-sets.mjs`, `skill-sets.json`) | `~/.claude/skill-policy/` |
| 스킬 통계·대시보드 (`skill-stats.mjs`, `skill-agents.mjs`, `skill-inventory.mjs`, `skill-modes.mjs`, `skill-dashboard.html`, `skill-meta.json`) | `~/.claude/skill-policy/` |
| Claude에게 말로 세트를 설치·토글하게 하는 `skill-sets` 스킬 | `~/.claude/skills/skill-sets/` |
| `skillOverrides` (기준값에 적힌 스킬을 명시 전용·끔으로) | `~/.claude/settings.json` |
| 세션 시작 시 정책 점검 훅 | `~/.claude/settings.json` |

Superpowers의 `using-superpowers` 부트스트랩(매 세션 전문 주입)은 제거한다. 나머지 Superpowers
스킬은 설명만 보고 자동으로 걸린다.

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

## 스킬 정책은 기존 스킬에 어떻게 적용되나

핵심은 한 줄이다. **정책은 스킬을 설치하지 않는다. 기준값(`policy.json`)에 이름이 적힌 스킬이 이 PC에
있으면 그 스킬의 동작만 바꾼다.** 이름이 없는 스킬은 건드리지 않는다.

기준값은 `~/.claude/skill-policy/policy.json`의 `modes`에 에이전트별로 `"스킬 이름": "값"`으로 들어간다.
Claude Code에서는 `~/.claude/settings.json`의 `skillOverrides`로 옮겨 적용된다(적용값). Claude Code는 이
설정을 스킬이 어디 있든(`~/.claude/skills/`, 프로젝트 `.claude/skills/`) **이름이 같으면** 적용한다.
단, 플러그인 스킬(`superpowers:brainstorming`처럼 `플러그인:스킬` 이름)에는 적용되지 않는다.

| 기준값 | 설정값 (Claude Code) | 결과 |
| --- | --- | --- |
| `manual` | `user-invocable-only` | Claude가 알아서 부르지 않는다. `/이름`으로만 실행. 설명도 컨텍스트에서 빠져 토큰이 줄어든다 |
| `off` | `off` | 완전히 숨긴다. 폴더는 남는다 |
| `auto` | 없음 | 자동 호출. 업그레이드가 끄면 차이로 알려 준다 |
| (기준값에 없음) | 그대로 | 건드리지 않는다 (관리 안 함) |
| `removeIfReinstalled` 목록 | – | `~/.claude/skills/`에 다시 설치되면 폴더도 지운다 (세션 시작 때 물어본 뒤) |
| `localOnlySkills` 목록 | 폴더 이동 + `disable-model-invocation` | 전역에서 빼고 지정한 프로젝트에만 둔다 |

### 예시

기본 기준값에는 gstack 스킬 이름(`review`, `qa`, `ship` …)이 `manual`로 들어 있다.

1. **gstack을 설치하지 않은 팀원.** `settings.json`에 `"review": "user-invocable-only"` 줄만 생긴다.
   `review`라는 스킬이 없으니 아무 일도 일어나지 않는다. 설치를 강요하지 않는다는 뜻이 이것이다.
2. **gstack을 설치한 사람.** `~/.claude/skills/review/`가 생기면 곧바로 위 설정이 걸린다. "리뷰해줘"라고
   해도 Claude가 gstack `review`를 자동으로 부르지 않고, `/review`라고 쳐야 실행된다.
   나중에 gstack 업그레이드가 설정을 지우면, 다음 세션 시작 때 Claude가 "되돌릴까요?"라고 묻는다.
3. **내가 만든 개인 스킬 `~/.claude/skills/my-notes/`.** 기준값에 없으니 변화 없음. 계속 자동 호출된다.
   명시 전용으로 바꾸려면 대시보드 호출 방식 페이지에서 고르거나 `node setup.mjs skills manual my-notes`.
4. **프로젝트 스킬 `.claude/skills/grill-me/`** (이 템플릿이 넣는 것). 기준값에 없으니 변화 없음.
   이 스킬은 자기 `SKILL.md`에 `disable-model-invocation: true`가 있어 원래 명시 전용이다.
5. **이름이 겹치는 프로젝트 스킬.** 팀 저장소에 `.claude/skills/review/`가 있으면, 내 PC의 전역 기준값이
   이 스킬에도 걸려 **나에게만** `/review` 전용이 된다. 팀원 PC에는 영향이 없다. 원치 않으면 호출 방식
   페이지에서 그 프로젝트에 "나만" 예외를 두거나 프로젝트 스킬 이름을 바꾼다. (같은 이름이
   `~/.claude/skills/`에도 있으면 개인 스킬이 이기고 프로젝트 스킬은 가려진다.)
6. **`autoplan`** (기준값 `off`, `removeIfReinstalled`에도 있음). 프로젝트에 같은 이름이 있으면 숨겨지기만
   하고 파일은 남는다. `~/.claude/skills/autoplan/`은 다시 생길 때마다 지운다.
7. **`localOnlySkills`의 `browseros-neo`.** `node setup.mjs user --local-project ../blog`이면
   `~/.claude/skills/browseros-neo/`를 `../blog/.claude/skills/`로 옮기고 명시 전용으로 만든 뒤,
   `../blog/.git/info/exclude`에 넣어 팀 커밋에 섞이지 않게 한다. 다른 프로젝트에서는 보이지 않는다.

지금 내 PC에서 어떤 스킬이 어떤 상태인지는 `node setup.mjs skills status`로 본다.

### 정책 바꾸기

가장 쉬운 곳은 대시보드의 **호출 방식** 페이지다(`node setup.mjs dashboard`, 아래). 에이전트마다 전역
값과 프로젝트 예외를 고르고, 미리보기로 바뀌는 파일을 확인한 뒤 적용한다. 기준값과 각 에이전트 설정 파일을
함께 바꾸므로 둘이 어긋나지 않는다. 명령으로는 이렇게 한다(Claude Code 전역).

```bash
node setup.mjs skills manual review qa     # 명시 전용
node setup.mjs skills off docx             # 끄기
node setup.mjs skills on docx              # 자동
node setup.mjs check                       # 기준값과 다른 곳만 보기
```

`policy.json`을 손으로 고쳤으면 `node ~/.claude/skill-policy/skill-policy.mjs --apply`로 적용한다.

| 키 | 뜻 |
| --- | --- |
| `modes.<에이전트>.global` | 전역 기본값. `{ "스킬 이름": "auto" \| "manual" \| "off" }`. 사본 하나만 가리킬 때는 `"path:<스킬 폴더>"` |
| `modes.<에이전트>.projects["<폴더>"]` | 프로젝트 예외 중 "나만"(이 PC). "팀 공유"는 저장소의 설정 파일에 바로 쓰고 여기에는 넣지 않는다 |
| `removeIfReinstalled` | `~/.claude/skills`에 다시 설치되면 폴더를 지울 스킬 |
| `localOnlySkills`, `localSkillProjects` | 개인 스킬을 지정한 프로젝트에만 둔다 |
| `stripSuperpowersBootstrap` | 매 세션 주입되는 using-superpowers를 뺀다 |
| `userPlugins` | 사용자 범위에서 켤·끌 플러그인 |
| `projectPluginRemovals` | 특정 프로젝트 설정에서 빼야 할 플러그인 (`{"<settings.json 경로>": ["id"]}`) |

에이전트 키는 `claude`, `codebuddy`, `qwen`, `codex`, `zcode`다. 예전 형식(`manualSkills`, `offSkills`,
`state.json`의 `disabled`)은 처음 읽을 때 자동으로 옮기고 원본을 `policy.v1.json`으로 남긴다.

gstack 업그레이드, 플러그인 업데이트, `npx skills` 업데이트, BrowserOS, 에이전트의 `/skills` 화면이 설정을
바꾸면 다음 세션 시작 때 훅이 감지하고, Claude가 먼저 묻는다. 자동으로 고치지 않는다. 답에 따라
`--apply`(기준값대로 되돌리기) 또는 `--adopt`(지금 값을 기준값으로 가져오기)를 실행한다.

## 스킬 세트: 분야별로 골라 설치

[awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)에 모인 스킬 중 분야별로
쓸 만한 것을 세트로 묶었다. 목록은 `kit/user/skill-sets.json`이고, 고치면 `node setup.mjs user`로
반영한다.

| 세트 | 스킬 |
| --- | --- |
| `documents` | docx, pdf, pptx, xlsx, doc-coauthoring |
| `frontend` | frontend-design, web-artifacts-builder, webapp-testing, playwright-skill |
| `dev-tools` | mcp-builder, skill-creator, changelog-generator |
| `data` | csv-data-summarizer, d3-viz, postgres |
| `research-writing` | content-research-writer, article-extractor, youtube-transcript, meeting-insights-analyzer |
| `business` | brand-guidelines, internal-comms, competitive-ads-extractor, domain-name-brainstormer, lead-research-assistant |
| `creative` | canvas-design, algorithmic-art, slack-gif-creator, theme-factory, image-enhancer |
| `productivity` | file-organizer, invoice-organizer, tailored-resume-generator, raffle-winner-picker |

```bash
node setup.mjs skills list                        # 세트와 설치 상태
node setup.mjs skills add documents data          # 세트 설치 → ~/.claude/skills/ (모든 프로젝트)
node setup.mjs skills add pdf                     # 스킬 하나만
node setup.mjs skills add frontend --project .    # 이 프로젝트에만 (.claude/skills/, 팀과 공유)
node setup.mjs skills add documents --force       # 최신 버전으로 갱신
node setup.mjs skills remove data                 # 삭제 (이 도구로 설치한 것만 지운다)
```

- 원본 저장소는 `~/.claude/skill-policy/cache/`에 얕게 받아 두고 필요한 폴더만 복사한다.
- 같은 이름의 폴더가 이미 있으면 건너뛴다. 덮어쓰려면 `--force`.
- 서드파티 스킬은 스크립트를 실행할 수 있다. 설치 전후에 `SKILL.md`를 읽어 본다.
- `documents`, `skill-creator`는 `anthropic-skills` 플러그인에도 같은 기능이 있다. 둘 다 켜면 설명이
  두 번 들어가 토큰만 는다. 하나만 쓴다.

## 켜고 끄기, 토큰 비교

파일은 두고 `skillOverrides`만 바꿔 켜고 끈다. 세트 이름, 스킬 이름, `all`(이 도구로 설치한 전부),
`plugin:<이름>`(플러그인 통째로)을 받는다.

```bash
node setup.mjs skills off documents        # 세트 끄기
node setup.mjs skills off review qa        # 아무 스킬이나 이름으로 (gstack 스킬도 가능)
node setup.mjs skills off all              # 설치한 세트 전부 끄기
node setup.mjs skills off plugin:superpowers
node setup.mjs skills on all               # 다시 켜기 (자동)
node setup.mjs skills manual review        # 명시 전용 (/이름으로만)
node setup.mjs skills status               # 스킬별 상태와 예상 토큰
```

`on`·`off`·`manual`은 기준값(`policy.json`)과 `settings.json`을 함께 바꾸므로, 세션 시작 점검 훅이
"기준값과 다르다"고 되돌리지 않는다. 명시 전용이던 스킬도 `on` 하면 자동이 된다.

### 비교 절차 (예: `documents` 세트가 값을 하는지)

1. `node setup.mjs skills status` → 스킬 목록이 매 요청마다 먹는 토큰 추정치를 적어 둔다. 세트 안
   스킬이 실제로 얼마나 불리는지는 `node setup.mjs dashboard`에서 먼저 본다.
2. 새 세션에서 같은 작업(예: "이 PDF 표를 xlsx로 정리해줘")을 시키고 `/context`의 Skills 줄과
   `/cost`를 기록, 결과물을 저장한다.
3. `node setup.mjs skills off documents` → 새 세션을 열고 같은 작업을 반복한다.
4. 토큰·비용·결과물을 나란히 비교하고, 값을 못 하는 세트는 `remove`한다.

설정은 세션을 시작할 때 읽으므로 비교는 항상 새 세션에서 한다. `status`의 숫자는 추정치(ASCII 4자 =
1토큰, 한글·CJK 1자 = 1토큰)이며 플러그인 스킬은 포함하지 않는다. 플러그인까지 포함한 전체 상태와
사용 빈도는 아래 대시보드로 본다.

### Claude에게 말로 시키기

`setup.mjs user`가 설치한 `skill-sets` 스킬 덕분에 명령어 대신 이렇게 말해도 된다.

- "문서 작업 스킬 세트 설치해줘" → `add documents`
- "이 프로젝트에만 프론트엔드 세트 넣어줘" → `add frontend --project .`
- "설치한 스킬 다 끄고 토큰 얼마나 줄었는지 보여줘" → `off all` 후 `status`
- "superpowers 플러그인 잠깐 꺼줘" → `off plugin:superpowers`

## 스킬 대시보드: 에이전트별 상태·사용 빈도·토큰

```bash
node setup.mjs dashboard              # http://localhost:4178 (다른 포트: --port 5000)
node setup.mjs stats                  # 브라우저 없이 에이전트별 요약만 출력 (수집 결과는 똑같이 저장)
node setup.mjs stats --exact          # Claude Code 스킬 토큰을 count_tokens API로 정확히 센다 (API 키 필요, 아래)
node ~/.claude/skill-policy/skill-stats.mjs serve   # 템플릿 저장소 없이, 설치된 사본으로
```

위쪽 메뉴로 세 페이지를 오가고, 오른쪽 위에서 언어(한국어·English·简体中文)를 고른다. 고른 언어와 테마는
브라우저에 기억된다.

- **현황판**: 위쪽에서 코딩 에이전트(전체, Claude Code, Codex, CodeBuddy Code, Qwen Code, Gemini CLI, GitHub
  Copilot CLI 중 이 PC에 있는 것)를 고른다. 요약 숫자, 에이전트별 비교(요청마다 싣는 스킬 목록, 30일 스킬 호출,
  요청 수·입력 토큰, 입력 중 스킬 목록 비중, 중복 등록), 에이전트별 스킬 목록 막대, 최근 30일 호출·토큰
  사용량(에이전트별로 쌓은 막대), 많이 쓴 스킬, 그리고 스킬 전부를 분류별·출처별·전체 목록으로 보여 준다.
  비교표의 행을 눌러도 그 에이전트만 본다. 스킬 행의 호출 방식을 누르면 호출 방식 페이지의 그 스킬로 간다.
- **호출 방식**: 에이전트별로 스킬의 호출 방식(자동 · 명시 전용 · 꺼짐)을 바꾼다. 아래에 따로 설명한다.
- **사용법·개념**: 스킬이 불리는 흐름, 토큰이 드는 두 가지 방식, 호출 방식, 스킬이 있는 곳과 우선순위,
  숫자가 만들어지는 과정, 코딩 에이전트별 수집 방법, 토큰 정확히 세기(API 키를 두는 곳)를 그림과 표로
  설명하고, 용어와 정리 방법을 정리했다. 현황판의 `?` 버튼에서 해당 설명으로 바로 간다.

- **항상 드는 토큰**: 자동 스킬의 이름·설명은 요청마다 컨텍스트에 들어간다. 스킬을 안 써도 나가는 비용이다.
  `/명시 전용`이나 꺼짐이면 0. 에이전트마다 자기 목록을 따로 보낸다.
- **쓸 때 드는 토큰**: 스킬이 호출되면 SKILL.md 본문이 대화에 들어간다. 호출할 때만 드는 비용이다.
- **호출 방식**: 자동, `/명시 전용`, 꺼짐, 가려짐(같은 이름의 전역 스킬이 이김), 플러그인 꺼짐, 미설치
  (기록에만 있음).
- **출처**: 스킬이 어디서 왔는지(gstack, superpowers 플러그인, mattpocock/skills, 스킬 세트 저장소 등)와
  설치 위치(에이전트, 전역·프로젝트·플러그인·기본 제공). 출처 링크를 누르면 원본 저장소가 열린다.
- **분류**: 기획·설계, 구현, 디버깅, 리뷰·보안, 테스트, 배포·Git, 디자인, 문서, 데이터 등. 이름·설명
  키워드로 정한다.
- **최근 30일 호출**: 모델이 스스로 부른 것과 사용자가 직접(`/이름`, `$이름`) 부른 것. 행을 펼치면 전체 설명,
  프로젝트별 호출 수, 30일 그래프, 호출 1회 실측값이 나온다.
- **정리 후보**: 자동 스킬인데 최근 30일 동안 한 번도 안 불린 것. 설명 토큰만 요청마다 나가고 있으니
  `/명시 전용`으로 바꾸거나 끌 후보다. 중복 등록된 사본은 다른 사본이 쓰였으면 후보에서 뺀다.
- **중복 등록**: 같은 이름의 스킬이 목록에 두 번 이상 실린 것. 주로 Codex에서 같은 스킬이 두 폴더에 있거나
  같은 플러그인이 두 마켓플레이스에서 설치됐을 때 생긴다. 비교표에 사본 하나를 빼면 줄어드는 토큰을 보여 준다.

출처나 분류가 틀리면 `~/.claude/skill-policy/skill-meta.local.json`에 적는다. 형식은
`kit/user/skill-meta.json`과 같고, 이 파일이 이긴다.

```json
{ "origins": { "my-notes": "https://github.com/me/notes-skill" }, "categories": { "my-notes": "research" } }
```

### 호출 방식 페이지

스킬마다 **기준값**(내가 정한 값, `policy.json`)과 **적용값**(각 에이전트가 실제로 읽는 설정 파일의 값)이
있다. 이 페이지는 둘을 함께 바꾼다.

- **에이전트별 보기**: 전역 값은 행의 선택 단추로 한 번에 바꾼다. 프로젝트 예외는 행의 칩이나 "+ 프로젝트
  예외"로 두고, "나만"(이 PC, `settings.local.json`)과 "팀 공유"(저장소의 `settings.json`, 커밋해야 동료에게
  감) 중 고른다. 위쪽 "편집 범위"에서 프로젝트 하나를 고르면 목록 전체를 그 프로젝트 기준으로 보고 고친다.
- **스킬별 · 모든 에이전트 보기**: 한 스킬을 모든 에이전트에서 한 번에 바꾼다. 명시 전용을 설정으로 못 하는
  에이전트(Codex, Qwen Code, ZCode)가 섞이면 "건너뜀 / 꺼짐으로" 중에 고른다.
- **일괄 조작**: 행을 체크하고 Shift+클릭으로 범위를 고른다. 추천 단추로 "정리 후보 → 명시 전용",
  "중복 사본 끄기"를 한 번에 넣는다.
- **모아서 적용**: 바꾼 값은 변경 목록에 쌓이고, 미리보기에서 파일별 이전·이후를 본 뒤 적용한다. 적용하기 전에
  바뀌는 파일을 `~/.claude/skill-policy/backups/`에 백업하고, 한 파일이라도 실패하면 이미 쓴 파일도 되돌린다.
  마지막 적용은 "되돌리기"로 취소한다(그 뒤에 파일이 다시 바뀌었으면 거부한다).
- **기준값과 다름**: 업그레이드나 `/skills` 화면처럼 밖에서 바뀐 설정을 빨간 테두리로 보여 주고, "기준값대로
  되돌리기"와 "지금 값 채택"을 고른다. 기준값에 없는 스킬은 적용값만 보여 주고 건드리지 않는다.
- **잠김**: 플러그인 스킬(플러그인 단위로만 켜고 끔), SKILL.md가 명시 전용인 스킬(자동 불가), 관리자 정책
  (`managed-settings.json`)이 정한 값, Qwen의 `skills.disabled`, Kimi Code(설정 없음)는 고를 수 없고 이유를
  보여 준다.

| 에이전트 | 전역 | 프로젝트 · 팀 공유 | 프로젝트 · 나만 | 값 |
| --- | --- | --- | --- | --- |
| Claude Code | `~/.claude/settings.json` `skillOverrides` | `.claude/settings.json` | `.claude/settings.local.json` | 자동·명시 전용·꺼짐 |
| CodeBuddy Code | `~/.codebuddy/settings.json` | `.codebuddy/settings.json` | `.codebuddy/settings.local.json` | 같음 |
| Qwen Code | `~/.qwen/settings.json` `skills.defaultDisabled` | `.qwen/settings.json` (`enabled`·`defaultDisabled`) | 없음 | 자동·꺼짐 |
| Codex | `~/.codex/config.toml` `[[skills.config]]` (경로별) | 시험 뒤에 켬 | 없음 | 자동·꺼짐 |
| ZCode | `~/.zcode/cli/config.json` (경로별) | `.zcode/config.json` | 없음 | 자동·꺼짐 |
| Kimi Code | 없음 (보기만) | – | – | – |

설정을 바꾸는 요청은 이 페이지에서만 받는다. 서버는 켤 때 만든 임의 토큰을 페이지에 넣고, 그 토큰과
`localhost` Host, JSON 본문이 있는 요청만 받는다. 쓸 파일 경로는 서버가 정한다. 새로 만든 "나만" 파일은
`.git/info/exclude`에 넣는다. 설계와 조사 내용은 [docs/design/skill-modes.md](docs/design/skill-modes.md)에 있다.

### 코딩 에이전트별 수집

따로 켤 것은 없다. 이 PC에서 찾은 에이전트의 기록을 모두 읽고, 에이전트를 한 번이라도 쓰면 다음 수집부터
현황판에 나온다.

| 에이전트 | 대화 기록 | 호출로 세는 것 | 요청마다 드는 토큰 |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Skill 도구 호출, `/이름` 입력 뒤 SKILL.md 본문 주입 | 설정(`skillOverrides`)과 SKILL.md로 계산 |
| Codex | `$CODEX_HOME/sessions/**/*.jsonl`, `archived_sessions` (기본 `~/.codex`) | 셸로 SKILL.md 읽기, `<skill>` 주입, 메시지의 `$이름` (한 턴에 한 번) | 마지막 세션이 실제로 보낸 `<skills_instructions>` 목록 |
| CodeBuddy Code | `~/.codebuddy/projects/**/*.jsonl` (Claude Code 형식) | Claude Code와 같음 | 설정(`skillOverrides`)과 SKILL.md로 계산 |
| Qwen Code | 아직 읽지 않음 | – | `~/.qwen/skills`와 `skills.*` 설정으로 추정 |
| ZCode, Kimi Code (앱) | 아직 읽지 않음 | – | 공유 폴더 `~/.agents/skills`로 추정 |
| Gemini CLI | `~/.gemini/tmp/*/chats/session-*.json` | `activate_skill` 도구, `read_file`로 SKILL.md 읽기 | `~/.gemini/skills`, `<프로젝트>/.gemini/skills`로 추정 |
| GitHub Copilot CLI (실험적) | `~/.copilot/session-state/**/*.jsonl` | 이름이 `skill`인 도구 호출, SKILL.md 읽기 | `~/.copilot/skills`, `<프로젝트>/.github/skills`로 추정 |

토큰 사용량은 각 기록의 사용량 필드에서 읽는다(Claude Code `usage`, Codex `token_count`, Gemini `tokens`).
입력에는 캐시에서 읽은 토큰도 들어 있어 요금과는 다르다. Codex의 포크된 서브에이전트는 부모 대화를 다시
기록하므로 같은 턴은 한 번만 세고, 자동 검토(guardian) 세션은 검토하는 대화를 인용하므로 호출은 세지 않고
토큰만 센다. Copilot CLI는 기록 형식이 문서로 공개돼 있지 않아 모양으로 찾는다. 기록을 데이터베이스나
바이너리로 두는 도구(Cursor, Antigravity 등)는 수집하지 않는다.

수집한 호출과 사용량은 `~/.claude/skill-policy/stats.json` 하나에 쌓인다. 대화 기록 파일은 바뀐 것만 다시
읽는다. Claude Code는 `cleanupPeriodDays`(기본 30일)가 지난 기록을 지우고 Gemini CLI도 설정에 따라 지우므로,
오래 쌓으려면 그 안에 한 번씩 `stats`나 `dashboard`를 실행한다. 서버는 `127.0.0.1`에만 열린다(로컬 경로와
프로젝트 이름이 들어 있다).

### 토큰은 어떻게 재나

| 값 | 재는 방법 | 정확도 |
| --- | --- | --- |
| 사용 빈도 | 에이전트별 대화 기록 (위 표, 서브에이전트 포함) | 정확. 지워진 기록은 수집 전이면 빠진다 |
| 항상 드는 토큰 (요청마다) | Claude Code: 이름 + `description` + `when_to_use` (1536자에서 자름). Codex: 목록의 그 스킬 줄 | 기본은 추정. `--exact`면 Claude Code 스킬은 실측 |
| 쓸 때 드는 토큰 (호출 1회) | SKILL.md 전체 | 같음. 스킬이 따로 읽는 참고 파일과 스크립트 출력은 빠진다 |
| 호출 1회 실측 | 기록의 사용량: 본문이 들어간 직후 요청의 입력 토큰 − 스킬을 부르기 직전 요청 (중앙값) | 실측이지만 도구 결과·사용자 입력이 섞이므로 최대치 |
| 세션 전체 | Claude Code 안에서 `/context`의 Skills 줄, `/cost` | 정확. 세션 하나 단위 |

### 토큰 정확히 세기: API 키 설정

`--exact`(대시보드의 "토큰 정확히 세기")는 Claude Code 스킬의 목록·본문 텍스트를 Anthropic `count_tokens`
API에 보낸다. 무료지만 요청 수 제한이 있고, 스킬 설명이 API로 나간다. 결과는 내용 해시로 캐시해 바뀐 스킬만
다시 보낸다. Codex·Gemini·Copilot 스킬은 토크나이저가 달라 추정치로 둔다.

키는 **대시보드 서버를 띄우는 터미널의 환경 변수**에 둔다. 브라우저나 `~/.claude/settings.json`의 `env`가
아니다(`env`는 Claude Code 안에서 실행한 명령에만 전달된다). 서버는 켜질 때 환경 변수를 한 번 읽으므로,
설정한 뒤에는 서버를 다시 켠다.

```powershell
# Windows PowerShell: 이번 터미널에서만
$env:SKILL_STATS_API_KEY = "sk-ant-..."
node setup.mjs dashboard

# 계속 쓰기: 사용자 환경 변수로 저장한 뒤 새 터미널(VS Code라면 VS Code 재시작)에서 실행
setx SKILL_STATS_API_KEY "sk-ant-..."
```

```bash
# macOS / Linux
export SKILL_STATS_API_KEY="sk-ant-..."                         # 이번 터미널에서만
echo 'export SKILL_STATS_API_KEY="sk-ant-..."' >> ~/.zshrc       # 계속 쓰기 (bash는 ~/.bashrc)
```

| 변수 | 뜻 | 기본값 |
| --- | --- | --- |
| `SKILL_STATS_API_KEY` | count_tokens에 쓰는 키. 먼저 본다. 이 도구만 읽으므로 계속 설정해 둬도 된다 | 없음 |
| `ANTHROPIC_API_KEY` | 위 변수가 없을 때 쓴다. 이 변수가 있는 터미널에서 Claude Code를 켜면 구독 대신 API 키를 쓰게 될 수 있다 | 없음 |
| `SKILL_STATS_MODEL` | 토큰을 세는 모델 | `claude-sonnet-5` |
| `CODEX_HOME` | Codex 기록을 읽는 위치 | `~/.codex` |

설정이 먹었으면 대시보드의 "토큰 정확히 세기" 버튼이 켜지고, 마우스를 올리면 어느 변수를 읽었는지 보인다.
키는 Anthropic Console의 API Keys에서 만든다.

## 이 템플릿 갱신하기

- 서드파티 스킬 갱신 절차는 `kit/project/.claude/skills/THIRD_PARTY_NOTICES.md`에 있다.
- 이미 설치한 프로젝트에 새 파일만 반영하려면 `node setup.mjs project <dir>`를 다시 실행한다.
  기존 파일은 그대로 두고, 없는 파일과 settings.json의 새 항목만 더한다.
- 스킬 세트 카탈로그나 관리기를 고쳤으면 `node setup.mjs user`를 다시 실행한다. `policy.json`과
  `state.json`은 덮어쓰지 않는다.
