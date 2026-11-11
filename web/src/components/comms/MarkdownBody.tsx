// Tiny, safe markdown-ish renderer for chat bodies. Emits React elements
// only — never dangerouslySetInnerHTML — so nothing in a message body can
// become markup. Supported: paragraphs (blank line), `> quote` lines,
// **bold**, `code`, bare URLs and [label](url) links (http/https only).

import type { ReactNode } from 'react';

const LINK_CLASS = 'text-primary-600 dark:text-primary-400 hover:underline break-all';

// One combined pattern; alternation order matters (code first so ** inside
// backticks stays literal).
const INLINE_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(https?:\/\/[^\s<]+)/g;

function safeHref(url: string): string | null {
	return /^https?:\/\//i.test(url) ? url : null;
}

export function renderInline(text: string, keyPrefix: string): ReactNode[] {
	const out: ReactNode[] = [];
	let last = 0;
	let i = 0;
	for (const match of text.matchAll(INLINE_RE)) {
		const start = match.index ?? 0;
		if (start > last) out.push(text.slice(last, start));
		const [raw, code, bold, mdLink, bareUrl] = match;
		const key = `${keyPrefix}-${i++}`;
		if (code) {
			out.push(
				<code
					key={key}
					className="px-1 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700/60 text-2xs font-mono text-slate-800 dark:text-slate-200"
				>
					{code.slice(1, -1)}
				</code>,
			);
		} else if (bold) {
			out.push(
				<strong key={key} className="font-semibold">
					{bold.slice(2, -2)}
				</strong>,
			);
		} else if (mdLink) {
			const close = mdLink.indexOf('](');
			const label = mdLink.slice(1, close);
			const href = safeHref(mdLink.slice(close + 2, -1));
			out.push(
				href ? (
					<a key={key} href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
						{label}
					</a>
				) : (
					label
				),
			);
		} else if (bareUrl) {
			// Trailing punctuation is almost never part of the URL.
			const trimmed = bareUrl.replace(/[.,;:!?)]+$/, '');
			const tail = bareUrl.slice(trimmed.length);
			out.push(
				<a key={key} href={trimmed} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
					{trimmed}
				</a>,
			);
			if (tail) out.push(tail);
		} else {
			out.push(raw);
		}
		last = start + raw.length;
	}
	if (last < text.length) out.push(text.slice(last));
	return out;
}

interface Block {
	kind: 'p' | 'quote';
	lines: string[];
}

function parseBlocks(body: string): Block[] {
	const blocks: Block[] = [];
	let current: Block | null = null;
	for (const rawLine of body.replace(/\r\n?/g, '\n').split('\n')) {
		const line = rawLine.trimEnd();
		if (line.trim() === '') {
			current = null;
			continue;
		}
		const isQuote = line.startsWith('>');
		const kind: Block['kind'] = isQuote ? 'quote' : 'p';
		const content = isQuote ? line.replace(/^>\s?/, '') : line;
		if (!current || current.kind !== kind) {
			current = { kind, lines: [] };
			blocks.push(current);
		}
		current.lines.push(content);
	}
	return blocks;
}

export default function MarkdownBody({ body, className }: { body: string; className?: string }) {
	const blocks = parseBlocks(body);
	return (
		<div className={className}>
			{blocks.map((block, bi) => {
				const lines = block.lines.map((line, li) => (
					<span key={li}>
						{li > 0 && <br />}
						{renderInline(line, `${bi}-${li}`)}
					</span>
				));
				if (block.kind === 'quote') {
					return (
						<blockquote
							key={bi}
							className="border-l-2 border-slate-300 dark:border-slate-600 pl-2.5 text-slate-600 dark:text-slate-400 my-1"
						>
							{lines}
						</blockquote>
					);
				}
				return (
					<p key={bi} className="whitespace-pre-wrap break-words [&+p]:mt-2">
						{lines}
					</p>
				);
			})}
		</div>
	);
}
