# 작업 흐름

한 가지 일을 기획부터 배포까지 끌고 가는 순서. 단계마다 어떤 스킬이 붙는지, 그 스킬이 어디서
왔는지, 알아서 걸리는지 사람이 불러야 하는지를 적는다. 규칙 자체는 `AGENTS.md`에 있고 이 문서는
순서만 다룬다.

## 원칙

- 단계마다 절차 스킬은 하나, 영역 스킬도 하나. 같은 역할의 스킬을 겹쳐 부르지 않는다.
- 계획 파일에 이미 적힌 결정은 다시 캐묻지 않고 계획대로 실행한다.
- 리뷰 경로는 한 작업에 하나. 기본은 `requesting-code-review`, 크거나 머지 직전일 때만 커맨드를 더한다.

## 스킬 출처

| 표기 | 출처 | 설치 위치 |
| --- | --- | --- |
| **SP** | Superpowers 플러그인 (`obra/superpowers`) | 사용자 범위, `setup.mjs user` |
| **MP** | `mattpocock/skills` 복사본 | 이 저장소 `.claude/skills/` |
| **PJ** | 이 저장소 자체 스킬 | 이 저장소 `.claude/skills/` |
| **CC** | Claude Code 내장 커맨드·스킬 | 기본 제공 |
| **OF** | 공식 플러그인 (`claude-plugins-official`) | 프로젝트 설정에서 켠다 |
| **GS** | gstack (`garrytan/gstack`) | 개인 설치. 없으면 건너뛴다 |
| **GL** | GitLab `gitlab-ci-skill` | `--gitlab`로 설치했을 때만 |

호출 방식: **자동**은 에이전트가 상황을 보고 부른다. **명시**는 사람이 `/이름`으로 부른다.
명시로 둔 것은 비싸거나(토큰·시간), 대화를 오래 붙잡거나, 정기적으로만 쓰는 것이다.

## 단계별 흐름

| 단계 | 할 일 | 스킬 | 출처 | 방식 |
| --- | --- | --- | --- | --- |
| 0. 시작 | 작업을 backlog에서 active로 | `plan-board` | PJ | 자동 |
| 1. 기획 | 작은 기능 아이디어 정리 | `brainstorming` | SP | 자동 |
| | 큰 결정 캐묻기 | `grilling` (문서까지 남기려면 `/grill-with-docs`) | MP | 자동 / 명시 |
| | 용어·결정 기록 (`CONTEXT.md`, `docs/adr/`) | `domain-modeling` | MP | 자동 |
| 2. 설계 | 모듈 경계와 인터페이스 | `codebase-design` | MP | 자동 |
| | 화면 방향 (UI 있는 프로젝트) | `frontend-design` | OF | 자동 |
| 3. 계획 | 계획 내용 작성 | `writing-plans` | SP | 자동 |
| | 위험한 계획의 구멍 찾기 | `/grill-me` | MP | 명시 |
| | **계획 승인** | 사람 | — | — |
| 4. 구현 | 모든 기능·버그픽스 | `test-driven-development` | SP | 자동 |
| | 병렬 작업·여러 명 동시 진행 | `using-git-worktrees` | SP | 자동 |
| | 서로 독립인 작업 여러 개 | `subagent-driven-development` | SP | 자동 |
| | 버그·실패한 테스트 | `systematic-debugging` | SP | 자동 |
| | 운영 서버·DB를 만질 때 | `careful` | GS | 자동 |
| 5. 검증 | 프로젝트 검사 명령 실행 후 | `verification-before-completion` | SP | 자동 |
| | 화면 흐름 실제 확인 | `browse` (정식 QA 보고서는 `/qa-only`) | GS | 자동 / 명시 |
| 6. 리뷰 | 기능 완료 후 리뷰 | `requesting-code-review` | SP | 자동 |
| | 리뷰 피드백 처리 | `receiving-code-review` | SP | 자동 |
| | 크거나 머지 직전인 변경 | `/code-review` | CC | 명시 |
| | 인증·권한·결제 변경 | `/security-review` | CC | 명시 |
| 7. 마무리 | 브랜치 정리 | `finishing-a-development-branch` | SP | 자동 |
| | 계획을 done으로, 남길 결정은 ADR | `plan-board`, `domain-modeling` | PJ, MP | 자동 |
| 8. 배포 | `.gitlab-ci.yml` 작성·검증 | `gitlab-ci-skill` | GL | 자동 |
| 운영 | 긴 세션을 다음 사람에게 넘김 | `/handoff` | MP | 명시 |
| | 머지·리베이스 충돌 | `resolving-merge-conflicts` | MP | 자동 |
| | 주간 회고 | `/retro` | GS | 명시 |
| | 단계(phase)가 끝날 때 구조 점검 | `/improve-codebase-architecture` | MP | 명시 |
| | 단계가 끝날 때 보안 감사 | `/cso` | GS | 명시 |
| | 다른 모델의 두 번째 의견 | `/codex` 또는 `codex:rescue` | GS / codex 플러그인 | 명시 |

프로젝트 영역 스킬(예: API 변경, DB 마이그레이션, 네이티브 권한)은 이 저장소 `.claude/skills/`에
만들어 4단계에 붙인다. 영역 스킬이 TDD를 선행 스킬로 부르면 한 작업의 스킬 본문이 커지므로,
영역 스킬은 짧게 유지한다.

## 한 작업의 전체 사이클

```
작업 시작 지시
  → plan-board          backlog에서 작업 집어 active/로 이동
  → writing-plans       계획 내용 채우기
계획 승인                                            ← 사람이 개입
  → 영역 스킬 + test-driven-development
  → 프로젝트 검사 명령
  → verification-before-completion   실제 출력 확인
  → requesting-code-review
리뷰 발동(선택: /code-review, /security-review)       ← 사람이 개입
  → receiving-code-review
  → finishing-a-development-branch
  → plan-board          done/으로 이동 (단계가 끝났으면 그때만 ROADMAP)
  → domain-modeling     남길 결정이 있으면 ADR
커밋                                                 ← 사람이 개입
```

## 쓰지 않는 것 (역할이 겹침)

사용자 범위 `skillOverrides`로 명시 전용이 되어 있다. 필요하면 `/이름`으로만 부른다.

| 겹치는 스킬 (GS) | 대신 쓰는 것 |
| --- | --- |
| `office-hours`, `plan-ceo/eng/design/devex-review`, `autoplan` | `brainstorming`, `grilling`, `writing-plans` |
| `review`, `ship`, `land-and-deploy` (GitHub `gh` 전제) | SP 리뷰 흐름, `/code-review`, CI |
| `investigate` | `systematic-debugging` |
| `health` | 프로젝트 검사 명령 + `verification-before-completion` |
| `checkpoint` | `/handoff` |
| `document-release` | `plan-board` + `domain-modeling` |
| `design-*` | `frontend-design` + 프로젝트 디자인 문서 |

## docs 구조

| 경로 | 무엇 | 누가 만드나 |
| --- | --- | --- |
| `docs/ROADMAP.md` | 단계와 단계 종료 조건 (60줄 이하) | `plan-board` |
| `docs/plans/backlog/<ID>-<slug>.md` | 시작 안 한 작업 스텁 | `plan-board` |
| `docs/plans/active/<ID>-<slug>.md` | 진행 중인 계획 | `plan-board` + `writing-plans` |
| `docs/plans/done/` | 끝난 계획, 다시 안 읽는다 | 이동만 |
| `docs/adr/NNNN-*.md` | 되돌리기 어려운 결정과 이유 | `domain-modeling` |
| `CONTEXT.md` | 용어집 | `domain-modeling` |

작업 상태는 계획 파일이 든 폴더다. 파일을 옮기는 것이 상태 변경이다. 읽을 때는 좁은 쪽부터:
`ls docs/plans/backlog`, 진행 중인 계획 파일 하나, 전체 그림이 필요할 때만 `ROADMAP.md`.

## 설계 문서를 고칠 수 있는 때

ADR, `CONTEXT.md`, 계획의 목표·비목표는 기획·설계·계획 단계에서만 쓴다. 구현 중에는 계획의
체크박스만 건드린다. 구현해 보니 결정이 안 맞으면 멈추고 사람에게 선택지를 제시한다.
