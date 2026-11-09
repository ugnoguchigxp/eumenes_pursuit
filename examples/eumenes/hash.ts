// Eumenes api/domains/capabilities/contracts/index.ts, hash helper.
export const hash = (v: unknown) =>
	new Bun.CryptoHasher("sha256")
		.update(typeof v === "string" ? v : JSON.stringify(v))
		.digest("hex");
