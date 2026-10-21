import { lookup } from "node:dns/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Host-side checks for cited web sources (horizon-9): fetch a cited URL, extract its text, and
 * look for the quoted passage with tolerant matching. Only public http(s) hosts are fetched
 * (no loopback, private, link-local or carrier-grade NAT addresses, checked on every redirect).
 */
export type FetchText = (
	url: string,
	signal: AbortSignal,
) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;

const MAX_BYTES = 40 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const UA =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 eumenes-pursuit-quote-check";

function privateV4(ip: string): boolean {
	const [a, b] = ip.split(".").map(Number) as [number, number];
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		a >= 224
	);
}

export function privateAddress(ip: string): boolean {
	if (isIP(ip) === 4) return privateV4(ip);
	const v6 = ip.toLowerCase();
	if (v6.startsWith("::ffff:")) return privateAddress(v6.slice(7));
	return (
		v6 === "::" ||
		v6 === "::1" ||
		v6.startsWith("fc") ||
		v6.startsWith("fd") ||
		v6.startsWith("fe8") ||
		v6.startsWith("fe9") ||
		v6.startsWith("fea") ||
		v6.startsWith("feb")
	);
}

async function publicUrl(raw: string): Promise<URL | string> {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return "URL ではありません";
	}
	if (url.protocol !== "http:" && url.protocol !== "https:")
		return "http(s) だけです";
	const host = url.hostname.replace(/^\[|\]$/g, "");
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local")
	)
		return "公開されたホストではありません";
	const addresses = isIP(host)
		? [host]
		: await lookup(host, { all: true })
				.then((r) => r.map((a) => a.address))
				.catch(() => []);
	if (!addresses.length) return "ホスト名を解決できません";
	if (addresses.some(privateAddress)) return "公開されたホストではありません";
	return url;
}

export function htmlToText(html: string): string {
	return html
		.replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
		.replace(/&ldquo;|&rdquo;/g, '"')
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&#x([0-9a-f]+);/gi, (_, h) =>
			String.fromCodePoint(parseInt(h, 16)),
		);
}

async function pdfToText(bytes: Uint8Array): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "quote-pdf-"));
	try {
		const file = join(dir, "doc.pdf");
		await writeFile(file, bytes);
		const proc = Bun.spawn(["pdftotext", "-q", "-enc", "UTF-8", file, "-"], {
			stdout: "pipe",
			stderr: "ignore",
			timeout: 60_000,
		});
		const [out] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		return out;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

export const fetchPublicText: FetchText = async (raw, signal) => {
	let target = raw;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const url = await publicUrl(target);
		if (typeof url === "string") return { ok: false, error: url };
		let res: Response;
		try {
			res = await fetch(url, {
				redirect: "manual",
				headers: { "user-agent": UA, accept: "text/html,application/pdf,*/*" },
				signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
			});
		} catch (e) {
			return { ok: false, error: `取得できません（${(e as Error).name}）` };
		}
		if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
			target = new URL(res.headers.get("location")!, url).toString();
			continue;
		}
		if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
		const bytes = new Uint8Array(await res.arrayBuffer());
		if (bytes.length > MAX_BYTES) return { ok: false, error: "大きすぎます" };
		const type = res.headers.get("content-type") ?? "";
		const isPdf =
			type.includes("pdf") ||
			(bytes[0] === 0x25 &&
				bytes[1] === 0x50 &&
				bytes[2] === 0x44 &&
				bytes[3] === 0x46);
		const text = isPdf
			? await pdfToText(bytes)
			: type.includes("html") || type.includes("xml") || !type
				? htmlToText(new TextDecoder().decode(bytes))
				: new TextDecoder().decode(bytes);
		return { ok: true, text };
	}
	return { ok: false, error: "リダイレクトが多すぎます" };
};

/** NFKC, lower case, letters and digits only (spacing, punctuation, quote styles ignored). */
export function normalizeForQuote(text: string): string {
	return text
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "");
}

const GRAM = 6;
/** Exact (normalised) containment, else the share of the quote's 6-grams found in the page. */
export function quoteCoverage(quote: string, pageText: string): number {
	const q = normalizeForQuote(quote);
	const t = normalizeForQuote(pageText);
	if (q.length < 10) return 0;
	if (t.includes(q)) return 1;
	const grams = new Set<string>();
	for (let i = 0; i + GRAM <= t.length; i++) grams.add(t.slice(i, i + GRAM));
	let hit = 0;
	let total = 0;
	for (let i = 0; i + GRAM <= q.length; i++) {
		total++;
		if (grams.has(q.slice(i, i + GRAM))) hit++;
	}
	return total ? hit / total : 0;
}

export const QUOTE_FOUND = 0.85;

const SECOND_LEVEL = new Set([
	"co.jp",
	"or.jp",
	"ac.jp",
	"go.jp",
	"ne.jp",
	"lg.jp",
	"ed.jp",
	"gr.jp",
	"co.uk",
	"ac.uk",
	"gov.uk",
	"org.uk",
	"nhs.uk",
	"com.au",
	"org.au",
	"gov.au",
	"edu.au",
	"co.kr",
	"or.kr",
	"com.cn",
	"com.tw",
	"org.tw",
	"co.nz",
	"gov.sg",
]);

/** Registrable domain (approximate): example.co.jp, nature.com. */
export function siteOf(url: string): string {
	try {
		const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
		const parts = host.split(".");
		const two = parts.slice(-2).join(".");
		return SECOND_LEVEL.has(two) ? parts.slice(-3).join(".") : two;
	} catch {
		return "";
	}
}
