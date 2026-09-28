"""PostToolUse hook for Write|Edit. Reads the hook payload (JSON) from stdin.

1. Files under .claude/skills   -> mirror .claude/skills to .agents/skills so Codex sees the
   same skills (symlinks are avoided: they need Windows Developer Mode + git core.symlinks).
2. AGENTS.md / CLAUDE.md        -> copy the edited one over the other, so both agents read the
   same instructions. Whichever file was edited wins.

Manual sync:  python .claude/hooks/post_edit.py --sync
Add project-specific formatters (ruff, prettier, ...) in main() below.
"""

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILLS_SRC = ROOT / ".claude" / "skills"
SKILLS_DST = ROOT / ".agents" / "skills"
AGENTS_MD = ROOT / "AGENTS.md"
CLAUDE_MD = ROOT / "CLAUDE.md"


def sync_skills() -> None:
    if SKILLS_DST.exists():
        shutil.rmtree(SKILLS_DST)
    if SKILLS_SRC.exists():
        shutil.copytree(SKILLS_SRC, SKILLS_DST)


def sync_instructions(source: Path = AGENTS_MD) -> None:
    """Copy source over its twin. AGENTS.md wins for a manual sync."""
    target = CLAUDE_MD if source == AGENTS_MD else AGENTS_MD
    if not source.exists():
        return
    text = source.read_text(encoding="utf-8")
    if target.exists() and target.read_text(encoding="utf-8") == text:
        return
    target.write_text(text, encoding="utf-8", newline="\n")


def main() -> None:
    if "--sync" in sys.argv:
        sync_skills()
        sync_instructions()
        return

    payload = json.load(sys.stdin)
    tool_input = payload.get("tool_input") or {}
    tool_response = payload.get("tool_response") or {}
    file_path = tool_input.get("file_path") or tool_response.get("filePath")
    if not file_path:
        return

    path = Path(file_path).resolve()
    if path.is_relative_to(SKILLS_SRC):
        sync_skills()
    elif path in (AGENTS_MD, CLAUDE_MD):
        sync_instructions(path)


if __name__ == "__main__":
    main()
