import type { JudgeRequest } from "../../src/contracts/judge.ts";
import { openDecisionLease } from "./connection.ts";
import { smokeQuestions } from "./fixtures.ts";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(`missing env var ${name}`);
		process.exit(2);
	}
	return value;
}

const origin = requireEnv("PURSUIT_LARM_ORIGIN");
const selector = requireEnv("PURSUIT_LARM_PROFILE");
const audience = requireEnv("PURSUIT_LARM_AUDIENCE");
const clientId = requireEnv("PURSUIT_LARM_CLIENT");
const token = requireEnv("LARM_API_TOKEN");

const request: JudgeRequest = {
	state: {
		goal: "ログイン画面のテストを通す",
		acceptance: "login.test.ts が全件成功する",
		attempts: 4,
		files_touched: [3, 5, 9, 14],
		failing_tests: [6, 6, 5, 5],
		touched_acceptance_files: 0,
	},
	questions: smokeQuestions,
	questionSet: { id: "smoke", version: 1 },
	adapter: null,
};

const lease = openDecisionLease({
	origin,
	token,
	selector,
	audience,
	clientId,
	catalogCapability: "decision.general",
});
try {
	const response = await lease.judge.ask(request, AbortSignal.timeout(120_000));
	console.log(JSON.stringify(response, null, 2));
	console.log(
		`latencyMs=${response.latencyMs} inputTokens=${response.inputTokens}`,
	);
} finally {
	await lease.release();
}
