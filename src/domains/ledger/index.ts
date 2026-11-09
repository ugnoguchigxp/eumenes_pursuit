import { ledgerV5FindingSources } from "./finding-sources-schema.ts";
import type { MigrationDescriptor } from "../../contracts/index.ts";
import { ledgerV2Findings } from "./findings-schema.ts";
import { ledgerV3Parts } from "./parts-schema.ts";
import { ledgerV4Settlement } from "./settlement-schema.ts";
import { ledgerV1 } from "./schema.ts";
import { ledgerV6HypothesisTargets } from "./targets-schema.ts";
import { ledgerV7HostLifecycle } from "./host-lifecycle-schema.ts";

/** Append-only; the host applies them in order inside its own migration runner. */
export const migrations: readonly MigrationDescriptor[] = [
	{
		id: "pursuit-0001-ledger",
		sql: ledgerV1,
		sha256: "caea9e75215a4f062622270d9e9c14b84793fa8449774af81912ae4e513dd4ea",
	},
	{
		id: "pursuit-0002-findings",
		sql: ledgerV2Findings,
		sha256: "5c45e46f0448d0f44108703a4ba96ebfbdc3ae7951d76d03efe7f0560a7b64cc",
	},
	{
		id: "pursuit-0003-parts",
		sql: ledgerV3Parts,
		sha256: "79653d2dfb89864bdd9ed2f22d05a2f55822f2c9efe3ac77f7b4a291a7a79cb6",
	},
	{
		id: "pursuit-0004-settlement",
		sql: ledgerV4Settlement,
		sha256: "c7af35e2971ff35b21f96a8312c61940561a81ba6ca3aa9813fbecc9ede1336b",
	},
	{
		id: "pursuit-0005-finding-sources",
		sql: ledgerV5FindingSources,
		sha256: "5b8d4499ad9382fe54118585cdf4c6a3c50b5be6de329addd19f96f28ed6f9b0",
	},
	{
		id: "pursuit-0006-hypothesis-targets",
		sql: ledgerV6HypothesisTargets,
		sha256: "3db990ae902fba0c296ebde600a2dfc220cc3b768b7824be36dcf41c0b5c032e",
	},
	{
		id: "pursuit-0007-host-lifecycle",
		sql: ledgerV7HostLifecycle,
		sha256: "b9e5e6bc470319847f3d653b18c17d2be600003ad617e8e58d5b4ae78b50918b",
	},
	{
		id: "pursuit-0008-unknown-usage",
		sql: "\nALTER TABLE pursuit_inference ADD COLUMN usage_json TEXT;\n",
		sha256: "cc8047d1431acd0ec6180366cc19443aa7564bdb58e59145e3a4650616bee70c",
	},
	{
		id: "pursuit-0009-action-plan",
		sql: "\nALTER TABLE pursuit_pursuit ADD COLUMN action_plan_json TEXT;\n",
		sha256: "5878f6bd72759d0b3aca92116c17af2484019fd0fa00912f7f6597f919f8ec8a",
	},
	{
		id: "pursuit-0010-productivity",
		sql: "\nALTER TABLE pursuit_pursuit ADD COLUMN productive_json TEXT;\nCREATE TABLE pursuit_progress(id TEXT PRIMARY KEY,pursuit_id TEXT NOT NULL REFERENCES pursuit_pursuit(id),data_json TEXT NOT NULL) STRICT;\n",
		sha256: "9808ec79f7516c217909ccd4d1e3dbf37d14b3d16b6c9876ea3d0287d4ff9bb9",
	},
];
export * from "./productivity.ts";
export * from "./action-plan.ts";
export * from "./host-lifecycle.ts";
export * from "./findings.ts";
export * from "./repository.ts";
export type * from "./types.ts";
