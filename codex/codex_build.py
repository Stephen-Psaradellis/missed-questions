"""Drive one Codex thread that authors the Missed Questions app.

Codex runs with `--sandbox read-only` on the OpenRouter provider, so it never
writes to disk itself: it answers with whole files, each fenced and headed
`FILE: <relative path>`, and this script saves those fences under app/. Every
turn after the first resumes the same session, so one session id covers the
whole build (the id the submission form asks for).

    python codex_build.py new "<prompt>"      # starts the thread
    python codex_build.py more "<prompt>"     # resumes it
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE / "app"
STATE = HERE / "codex_session.json"
LOG = HERE / "codex_turns.jsonl"
# Codex's cwd stays outside the trading tree so a read-only shell call cannot
# wander into the bot's data files.
WORK = Path(os.environ.get("CODEX_WORK", Path.home() / "codex-work" / "missed-questions"))
MODEL = "gpt-4.1-mini"

PROVIDER = [
    "-c", "model_provider=openrouter",
    "-c", f"model={MODEL}",
    "-c", 'model_providers.openrouter.name="OpenRouter"',
    "-c", 'model_providers.openrouter.base_url="https://openrouter.ai/api/v1"',
    "-c", 'model_providers.openrouter.env_key="OPENROUTER_API_KEY"',
    "-c", 'model_providers.openrouter.wire_api="responses"',
    "-c", 'sandbox_mode="read-only"',
]

RULES = (
    "You cannot write files in this sandbox. Reply with every file you create or "
    "change IN FULL, each as a fenced code block whose first line inside the fence is "
    "`FILE: <relative path>`. No diffs, no ellipses, no placeholders.\n\n"
)

FENCE = re.compile(r"```[^\n]*\n\s*FILE:\s*(\S+)\s*\n(.*?)```", re.S)


def extract(text):
    """Return [(relpath, body)] for every FILE: fence in a Codex reply."""
    out = []
    for rel, body in FENCE.findall(text):
        rel = rel.strip().lstrip("/\\")
        if ".." in Path(rel).parts or Path(rel).is_absolute():
            continue
        out.append((rel, body))
    return out


def save(files, root=APP):
    for rel, body in files:
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body.encode("utf-8"))
    return [rel for rel, _ in files]


def _key():
    for line in (HERE.parent / "dunning" / ".env").read_text().splitlines():
        if line.startswith("OPENROUTER_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("no OPENROUTER_API_KEY")


def run(mode, prompt):
    WORK.mkdir(parents=True, exist_ok=True)
    last = WORK / "last.txt"
    env = dict(os.environ, OPENROUTER_API_KEY=_key())
    base = ["codex.cmd" if os.name == "nt" else "codex", "exec"]
    common = PROVIDER + ["--skip-git-repo-check", "-o", str(last)]
    if mode == "new":
        cmd = base + ["--sandbox", "read-only", "-C", str(WORK)] + common + ["-"]
    else:
        sid = json.loads(STATE.read_text())["session_id"]
        cmd = base + ["resume"] + common + [sid, "-"]
    r = subprocess.run(cmd, cwd=WORK, env=env, input=RULES + prompt, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=600)
    m = re.search(r"session id:\s*([0-9a-f-]{36})", r.stdout + r.stderr)
    # The prompt goes on stdin: codex.cmd runs through cmd.exe, which cuts an
    # argv string at its first newline.
    if mode == "new" and m:
        STATE.write_text(json.dumps({"session_id": m.group(1), "model": MODEL}) + "\n")
    text = last.read_text(encoding="utf-8") if last.exists() else ""
    saved = save(extract(text))
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"mode": mode, "rc": r.returncode, "prompt": prompt[:300],
                            "saved": saved, "session": m.group(1) if m else None}) + "\n")
    print(f"rc={r.returncode} session={m.group(1) if m else '?'} saved={saved}")
    if r.returncode and not saved:
        print(r.stderr[-1500:])


if __name__ == "__main__":
    run(sys.argv[1], sys.argv[2])
