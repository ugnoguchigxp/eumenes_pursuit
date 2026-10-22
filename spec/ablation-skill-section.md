## Direct baseline (ablation: does the pursuit structure help?)
- Condition `D0` in `eval/main.ts` (`eval/direct.ts`): same tasks, tools, hidden checks, canary detection and grader as E1R, but no plan / hypotheses / predictions / findings / self-check / completion check / step-backs / reviewer. Each request (purpose `direct`) shows goal, acceptance criteria, tools and the action history; the responder answers ONE of `{"kind":"tool","tool":…,"inputJson":"{…}","text":null|"raw","message":""}`, `{"kind":"done",…}`, `{"kind":"give_up",…}` (strict keys: kind, tool, inputJson, text, message). A claim runs the host check and returns 合格/不合格; a failed claim does not end the task.
- Budgets come from the policy's pursuit-wide budget: tool calls = `budget.attempts`, wall = `budget.wallMs`, requests = `min(budget.transitions, --max-steps)`. `config/policy.v5.json` = 120 / 90 min / 900; `config/policy.v5-tight.json` = 60 / 45 min / 450 (use the same policy in both conditions).
- Pursuit side of the ablation adds two flags (default off, older runs unchanged): `--claim-feedback verdict` (claim verdict in all later prompts + an end-of-task notice in `<llm-dir>/notices/`, printed by show.sh) and `--attempt-count mutating` (only workspace-changing tools count toward the 6-attempts-per-hypothesis step-back). Give D0 `--claim-feedback verdict` too.
- Runner (one run name per condition × repeat; each run its own corpus-server port and request log):
```
bun eval/tools/corpus-server.ts --root <private>/hz10/a/corpus --port <p> --log <private>/abl/logs/<run>.jsonl &
bun eval/main.ts run --name abl1-direct-r1 --policy config/policy.v5.json --llm file --llm-dir <dir>/solo/gen \
  --grader-llm file --grader-dir <dir>/grader --rubric-dir <private>/abl/rubrics --secret-dir <private>/abl/secrets \
  --corpus-url http://127.0.0.1:<p> --corpus-log <private>/abl/logs/<run>.jsonl \
  --conditions D0 --claim-feedback verdict --tasks <14 ids> --repeat 1 --tools 0 --max-steps 1000 --concurrency 1
# pursuit: same, plus --reviewer-dir <dir>/solo/rev and
#   --conditions E1R --findings verified --self-check parts --verify-on claim --prediction falsifiable
#   --completion-check acceptance --claim-feedback verdict --attempt-count mutating
```
- Run dirs: `/workspace/pursuit_abl/<pursuit|direct>[-tight]-r<k>/` (READY.txt has the exact commands). The direct dir has no `solo/rev`; its `tool.sh <id> <tool> <inputJson> [textFile]` and `act.sh <id> <done|give_up> <message>` write the direct shape. show.sh (both conditions) prints system + tool descriptions + option text in full only on the first request of each task, then omits them, and prints end-of-task notices first.
- Fairness: fresh generator/reviewer/grader responders per run directory (never reuse across conditions or repeats; never the task author); alternate the order (r1 pursuit→direct, r2 direct→pursuit, r3 pursuit→direct).
- Compare: `bun eval/analyze.ts --compare abl1-pursuit-r1 abl1-pursuit-r2 abl1-pursuit-r3 abl1-direct-r1 abl1-direct-r2 abl1-direct-r3` (per family × mode × budget: correct, false completion, over-stopping, canary hits, grader pass, failed/total claims, tool calls mean/median, responder requests, minutes; then per task ○/× per repeat). D0 transcripts: `eval/results/<run>/direct/*.jsonl`.
