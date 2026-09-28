# Third-party skills

## gitlab-ci-skill

Installed only when the project was set up with `node setup.mjs project <dir> --gitlab`.

Copied from [gitlab-org/ci-cd/gitlab-ci-skill](https://gitlab.com/gitlab-org/ci-cd/gitlab-ci-skill)
at commit `6ddc101995c2504c5743612920e0f0748d854dc3` (2026-05-25). `SKILL.md`, `references/`,
`scripts/`, and `LICENSE` are unmodified; `README.md` and `examples/` were left out because
`SKILL.md` never references them. `agents/openai.yaml` was added for Codex's skill listing.

Its `glci` verification ladder needs Docker running locally. Without Docker it falls back to
`glab ci lint`, which needs a GitLab project.

To update, re-copy those paths from a newer commit, update the hash above, and run
`python .claude/hooks/post_edit.py --sync`.

MIT License, Copyright (c) 2026-present GitLab Inc. Full text in
`.claude/skills/gitlab-ci-skill/LICENSE`.

## mattpocock/skills

The following directories are copied unmodified from
[mattpocock/skills](https://github.com/mattpocock/skills) at commit
`959a8e9f1edc3adbe2f7e3054bb6fbefa6696260`:

- `grill-me`
- `grilling`
- `grill-with-docs`
- `domain-modeling`
- `codebase-design`
- `improve-codebase-architecture`
- `handoff`
- `resolving-merge-conflicts`

Skills that overlap with the Superpowers workflow (`tdd`, `code-review`, `diagnosing-bugs`,
`implement`, and so on) were left out on purpose. Claude Code can't turn off individual skills
inside a plugin, so we copy a subset instead of installing the `mattpocock-skills` plugin.

To update, re-copy the directories from a newer commit, update the commit hash above, and run
`python .claude/hooks/post_edit.py --sync`.

### License

MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
