import type { MigrationDescriptor } from "../../contracts/index.ts";
import { ledgerV1 } from "./schema.ts";

/** Append-only; the host applies them in order inside its own migration runner. */
export const migrations: readonly MigrationDescriptor[] = [
	{
		id: "pursuit-0001-ledger",
		sql: ledgerV1,
		sha256: "caea9e75215a4f062622270d9e9c14b84793fa8449774af81912ae4e513dd4ea",
	},
];
export * from "./repository.ts";
export type * from "./types.ts";
