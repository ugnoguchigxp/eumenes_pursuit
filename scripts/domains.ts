/** Ownership manifest. Add a dependency only with its first real import. */
export const domains = {
	ledger: { depends: [] },
	rules: { depends: ["ledger"] },
	judge: { depends: ["ledger", "rules"] },
	generation: { depends: ["ledger"] },
	loop: { depends: ["ledger", "rules", "judge", "generation"] },
} as const;
export type Domain = keyof typeof domains;
export const isDomain = (value: string): value is Domain =>
	Object.hasOwn(domains, value);
