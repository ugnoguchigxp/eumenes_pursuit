"""Summarize frozen runs; never fill unknown historical actions or provider usage."""
import hashlib
import json
import pathlib
import shutil
import sys
from collections import Counter

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "artifacts/research-loop-20261109")
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "spec/verification/research-loop-2026-11-09")
out.mkdir(parents=True, exist_ok=True)
names = ["technical", "museum", "denied", "missing", "conflict", "cap"]


def total(calls, key):
    values = [call[key] for call in calls]
    return sum(values) if all(v is not None for v in values) else None


def digest(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


result = []
for name in names:
    pair = {}
    inputs = []
    for variant in ["before", "after"]:
        folder = root / f"{variant}-final" / name
        summary = json.loads((folder / "summary.json").read_text())
        data = json.loads((folder / "input.json").read_text())
        view = json.loads((folder / "view.json").read_text())
        inputs.append(data)
        calls = summary["calls"]
        pair[variant] = {key: value for key, value in summary.items() if key not in ["calls", "draft"]}
        pair[variant].update({
            "modelCalls": len(calls), "purposes": dict(Counter(call["purpose"] for call in calls)),
            "uncachedInput": total(calls, "input"), "cacheInput": total(calls, "cache"), "output": total(calls, "output"),
            "evidenceRetainedInDraft": sorted({e for claim in (summary.get("draft") or {}).get("claims", []) for e in claim["evidence"]}),
            "inputHash": digest(data["input"]), "runnerHash": data["runnerHash"], "sourceHash": data["sourceHash"],
        })
        target = out / f"{variant}-{name}"
        target.mkdir(exist_ok=True)
        shutil.copyfile(folder / "events.jsonl", target / "events.jsonl")
        (target / "audit.json").write_text(json.dumps({
            "attempts": view["attempts"], "decisions": view["decisions"], "verifications": view["verifications"],
            "findings": view["findings"], "report": view["report"], "draft": summary.get("draft"),
            "modelCalls": calls,
        }, ensure_ascii=False, indent=2) + "\n")
    for key in ["input", "role", "reviewRole", "sources", "runnerHash"]:
        assert inputs[0][key] == inputs[1][key], f"comparison condition differs: {name}/{key}"
    result.append({"name": name, **pair})

(out / "comparison.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print("case | status before/after | calls before/after | seconds before/after | uncached/cache/output before -> after")
for entry in result:
    b, a = entry["before"], entry["after"]
    print(f'{entry["name"]} | {b["status"]}/{a["status"]} | {b["modelCalls"]}/{a["modelCalls"]} | '
          f'{b["elapsedMs"]/1000:.2f}/{a["elapsedMs"]/1000:.2f} | '
          f'{b["uncachedInput"]}/{b["cacheInput"]}/{b["output"]} -> {a["uncachedInput"]}/{a["cacheInput"]}/{a["output"]}')
