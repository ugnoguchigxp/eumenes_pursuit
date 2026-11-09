"""Compare the isolated Eumenes runs. Rejected/incomplete trials never count as speedups."""
import argparse
import json
from pathlib import Path

CASES = ("technical", "museum", "denied", "missing", "conflict", "cap")


def read(path):
    return json.loads(path.read_text())


def merge(intervals):
    result = []
    for start, end in sorted(intervals):
        if result and start <= result[-1][1]:
            result[-1][1] = max(result[-1][1], end)
        else:
            result.append([start, end])
    return result


def occupied(intervals, windows):
    return sum(max(0, min(b, d) - max(a, c)) for a, b in intervals for c, d in windows)


def waiting(events):
    starts = {}
    inference, io, waits = [], [], []
    for event in events:
        if event["kind"] == "job_started":
            starts[event["id"]] = event["at"]
        elif event["kind"] in ("job_ready", "late_job_ignored") and event["id"] in starts:
            (inference if event["job"] == "decision" else io).append((starts[event["id"]], event["at"]))
        elif event["kind"] == "wait":
            waits.append((event["at"] - event["durationMs"], event["at"]))
    windows = merge(waits)
    total = sum(b - a for a, b in windows)
    active = occupied(windows, merge(inference + io))
    return {
        "schedulerParkedMs": total,
        "overlappingDecisionMs": occupied(windows, merge(inference)),
        "overlappingIoMs": occupied(windows, merge(io)),
        "outsideRecordedJobsMs": max(0, total - active),
    }


def analyze(directory):
    inputs = read(directory / "input.json")
    audit_path = directory / "audit.json"
    events = [json.loads(line) for line in (directory / "events.jsonl").read_text().splitlines()]
    if not audit_path.exists():
        return inputs, {"status": "no_report", "last_event": events[-1] if events else None}
    audit = read(audit_path)
    stats = audit["stats"]
    docs = {d["id"]: d for d in audit["documents"]}
    draft = stats.get("draft")
    claims = draft["claims"] if draft else []
    citations = all(
        all(e in docs for e in claim["evidence"])
        and (claim["status"] == "unknown" or claim["evidence"])
        for claim in claims
    )
    cited = {e for claim in claims if claim["status"] != "unknown" for e in claim["evidence"]}
    retained = bool(cited and cited <= docs.keys())
    published = Path(stats["markdown"]) if stats.get("markdown") else None
    bytes_match = bool(published and published.is_file() and draft and published.read_bytes() == draft["answer"].encode())
    complete = stats["status"] == "completed" and stats["verified"]
    acceptable_partial = (
        stats["status"] in ("incomplete", "stopped")
        and not stats["verified"]
        and draft is not None
        and draft["completion"] == "incomplete"
        and retained
        and bytes_match
    )
    external = [e for e in events if e["kind"] == "tool_adopted" and e["job"] in ("lookup", "read")]
    last_external = max((e["at"] for e in external), default=None)
    after_external = [
        e for e in events if last_external is not None
        and e["kind"] == "model_started" and e["at"] >= last_external
    ]
    by_number = {e["number"]: e for e in events if e["kind"] == "model_finished"}
    started = {}
    receipt_lag = []
    for event in events:
        if event["kind"] == "job_ready":
            started[event["id"]] = event["at"]
        if event["kind"] == "tool_adopted" and event["id"] in started:
            receipt_lag.append(event["at"] - started[event["id"]])
    progress = [{
        "assessed": p["verdict"]["assessed"],
        "kind": p["verdict"]["kind"],
        "change": p["verdict"]["change"],
        "evidence": p["verdict"]["evidence"],
        "criteria": p["verdict"]["criteria"],
        "choice": p["choice"]["choice"],
        "reason": p["choice"]["reason"],
        "status": p.get("status"),
    } for p in audit.get("progress", [])]
    return inputs, {
        **{k: stats[k] for k in ("status", "verified", "expectedComplete", "elapsedMs",
                                 "model", "toolCounts", "rejections", "waitMs",
                                 "externalMs", "markdownMs")},
        "usage": {k: v for k, v in (stats.get("usage") or {}).items() if k != "events"},
        "same_acceptance_passed": bool(complete and citations and bytes_match),
        "acceptable_partial": bool(acceptable_partial and citations),
        "citations_exist": bool(citations),
        "markdown_matches_draft": bytes_match,
        "supported_claims_retained": retained,
        "draft_completion": draft["completion"] if draft else None,
        "unknown_claims": sum(c["status"] == "unknown" for c in claims),
        "limitations": draft["limitations"] if draft else [],
        "acquired": {e: doc["url"] for e, doc in docs.items()},
        "verification": stats["report"]["criteria"] if stats.get("report") else [],
        "stop_reason": stats["report"]["reason"] if stats.get("report") else None,
        "after_last_external": None if last_external is None else {
            "wallMs": events[-1]["at"] - last_external,
            "modelCallsStarted": len(after_external),
            "modelDurationMs": sum(by_number.get(e["number"], {}).get("durationMs", 0) for e in after_external),
        },
        "waiting_breakdown": waiting(events),
        "max_ready_to_adopt_ms": max(receipt_lag, default=None),
        "progress": progress,
        "attempts": [{
            "seq": a["seq"], "tool": a["tool"], "state": a["state"],
            "status": (a.get("observation") or {}).get("status"), "refs": a["refs"],
        } for a in audit["attempts"]],
        "directory": str(directory),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    report = {}
    for case in CASES:
        legacy = args.root / ("live" if case in ("technical", "museum") else "final" if case == "denied" else "release") / case / "legacy" / case
        productive = args.root / "release" / case / "productive" / case
        paths = {"legacy": legacy, "productive": productive}
        if not all((d / "events.jsonl").is_file() for d in paths.values()):
            continue
        before_inputs, before = analyze(legacy)
        after_inputs, after = analyze(productive)
        equal = all(before_inputs.get(k) == after_inputs.get(k)
                    for k in ("mode", "name", "role", "request", "limits", "sources", "provenance"))
        comparable = equal and all(r.get("same_acceptance_passed") for r in (before, after))
        comparable_partial = equal and all(r.get("acceptable_partial") for r in (before, after))
        report[case] = {
            "matched_inputs": equal,
            "same_accepted_quality": bool(comparable or comparable_partial),
            "legacy": before,
            "productive": after,
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
