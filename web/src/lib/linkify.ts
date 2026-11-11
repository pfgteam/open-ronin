// Find http(s):// and www. URLs in plain text. Pure, so it is testable and
// shared by ui/LinkifiedText.

export type LinkPart = { text: string; href?: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
// Punctuation that ends a sentence rather than the URL.
const TRAILING = /[.,;:!?'")\]}]+$/;

export function splitLinks(text: string): LinkPart[] {
	const out: LinkPart[] = [];
	let last = 0;
	for (const m of text.matchAll(URL_RE)) {
		const start = m.index ?? 0;
		let url = m[0];
		// Keep a closing paren that balances one inside the URL (wikipedia-style links).
		const trail = url.match(TRAILING)?.[0] ?? '';
		let cut = trail.length;
		if (trail.startsWith(')') && (url.match(/\(/g)?.length ?? 0) > (url.slice(0, url.length - trail.length).match(/\)/g)?.length ?? 0)) cut = trail.length - 1;
		if (cut > 0) url = url.slice(0, url.length - cut);
		if (!url.replace(/^(https?:\/\/|www\.)/i, '')) continue;
		if (start > last) out.push({ text: text.slice(last, start) });
		out.push({ text: url, href: /^www\./i.test(url) ? `https://${url}` : url });
		last = start + url.length;
	}
	if (last < text.length) out.push({ text: text.slice(last) });
	return out;
}
