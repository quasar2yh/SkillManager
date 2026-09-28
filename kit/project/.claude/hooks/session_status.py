"""SessionStart 훅: docs/plans/ 폴더와 로드맵 단계에서 현재 작업 상태를 만들어 주입한다."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROADMAP = ROOT / "docs" / "ROADMAP.md"
PLANS = ROOT / "docs" / "plans"
NEXT_COUNT = 3

# Windows 기본 콘솔 인코딩(cp949)으로는 한글·em dash를 쓸 수 없어 훅이 죽는다.
sys.stdout.reconfigure(encoding="utf-8")


def titles(directory: Path, limit: int | None = None) -> list[str]:
    """폴더의 계획 파일을 이름순으로 모아 각 파일의 첫 제목 줄을 돌려준다."""
    if not directory.is_dir():
        return []
    found: list[str] = []
    for path in sorted(directory.glob("*.md")):
        if path.name.startswith("_") or path.name == "README.md":
            continue
        title = path.stem
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
                break
        found.append(f"{title} — `docs/plans/{directory.name}/{path.name}`")
        if limit and len(found) >= limit:
            break
    return found


def current_phase() -> str:
    """단계 지도에서 🔄 진행 중인 단계 한 줄을 돌려준다."""
    if not ROADMAP.exists():
        return ""
    for line in ROADMAP.read_text(encoding="utf-8").splitlines():
        if line.startswith("|") and "🔄" in line:
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if len(cells) >= 4:
                return f"{cells[0]} {cells[1]} — 끝나는 조건: {cells[3]}"
    return ""


active = titles(PLANS / "active")
backlog = titles(PLANS / "backlog", limit=NEXT_COUNT)
phase = current_phase()

if not (active or backlog or phase):
    sys.exit(0)

lines = ["현재 작업 상태. `docs/plans/`와 `docs/ROADMAP.md`에서 자동 생성했다."]
if phase:
    lines.append(f"단계: {phase}")
lines.append("진행 중: " + ("없음" if not active else ""))
lines.extend(f"  - {item}" for item in active)
lines.append(
    "다음 후보: " + ("없음" if not backlog else "(전체 목록은 `ls docs/plans/backlog`)")
)
lines.extend(f"  - {item}" for item in backlog)
lines.append(
    "세부는 해당 계획 파일만 읽는다. 단계 전체 그림이 필요할 때만 `docs/ROADMAP.md`를 연다."
)

print(
    json.dumps(
        {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": "\n".join(lines),
            }
        },
        ensure_ascii=False,
    )
)
