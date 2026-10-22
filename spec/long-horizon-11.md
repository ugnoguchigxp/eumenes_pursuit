# horizon-11: long-horizon tasks and two loop fixes

## Why
ablation-1 put the pursuit loop (E1R) and direct solving (D0) side by side on the hz10 tasks:
both solved 42/42, and D0 never needed more than 12 tool calls. The tasks were too short to tell
the two apart. horizon-11 adds tasks where success takes many tool calls and facts that must be
kept beyond the 40-entry full history, then repeats the comparison with larger budgets.

## Loop settings
The two loop fixes first written for horizon-11 now live in the core
([fixes-2026-10-22.md](fixes-2026-10-22.md) §a, §b, host contract v1.7) and are on by default:
- `--rollback notify|keep` (conditions.rollback, default notify). notify = when policy.restore
  rolls the workspace back on a step back, the reverted files are stored in the decision basis
  (`reverted`, `attemptsAtRevert`) and named in the next generator requests; keep = never roll back.
  A rollback is never silent. hz11 uses keep (the earlier `--rollback off`).
- `--verdict-label refutation|status` (conditions.verdictLabel, default refutation). Attempts are
  labelled from the machine-checkable refutedIf (`status:ok`, `status:error`, `contains:"…"`,
  `not_contains:"…"`, joined by `||`), otherwise "未判定"; status is the earlier wording. hz11 uses
  refutation.

Other core changes that apply to hz11 runs: scratch files and read-only attempts do not count as
scope growth (§d), citations of unrecorded findings are rejected (§e), the latest observation is
shown up to 8000 characters and read tools page (§f, list_sources 30 sources per page).

## Budget
config/policy.v6-long.json: 200 attempts (tool calls), 120 min wall, 1500 transitions, 8 strategies,
40 step backs; the rest as v5. The same file for D0 and E1R; `--max-steps 2000`.

## Tasks (hz11)
| id | kind | what makes it long |
| --- | --- | --- |
| hz11-legacy-billing | env | ~30-file billing package with several interacting defects; the spec is split over README, docs/ and a dated CHANGELOG whose contradictions resolve by date; visible tests pass from the start; dozens of hidden multi-account cases, so a partial fix fails almost every case |
| hz11-black-box | env + probe | a compositional device (state, arithmetic, context-dependent rules) behind 12 probe calls of 20 inputs; hidden inputs in 4 batches |
| hz11-messy-ledger | env | ~6,300 shipment rows over two exports with mid-year changes (format, units, codes, revisions, duplicates); five exact answers checked together |
| hz11-sales-pipeline | env | a four-stage build (import, SQL steps, dedupe, report) with defects in several stages; the visible hand totals expose only some of them, the hidden datasets (other periods and branch mixes) all of them |
| hz11-water-ratio | corpus (slug r1) | ~75 documents with an annual report, its errata, a two-step billing correction, preliminary figures, look-alike figures (other years, another utility, other population definitions), a forged portal and planted instructions; four answers chained from the latest corrected facts |

Host-only material (hidden cases, device, answers, rubric, corpus, reference solutions, the private
verifier) is outside the repository. The private verifier checks, in the real sandbox, that every
task fails initially, passes with the reference solution, and fails with plausible partial or wrong
solutions.
