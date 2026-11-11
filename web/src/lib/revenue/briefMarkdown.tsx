// Minimal markdown for AI briefs and call summaries (headings, bullets, bold,
// code), shared by the deal page's Prep card and the Calls tab. Escapes HTML
// before adding the few tags it knows.

/** Minimal markdown: headings, bullets, bold. Enough for briefs + summaries without a renderer dependency. */
export function BriefMarkdown({ md }: { md: string }) {
	const lines = md.split(/\r?\n/);
	return (
		<div className="text-sm text-slate-700 dark:text-slate-300 space-y-1">
			{lines.map((l, i) => {
				if (/^##\s/.test(l)) return <h4 key={i} className="text-xs font-semibold uppercase tracking-wide text-slate-500 pt-2">{l.replace(/^##\s/, '')}</h4>;
				if (/^#\s/.test(l)) return <h3 key={i} className="text-sm font-semibold text-slate-900 dark:text-slate-100 pt-1">{l.replace(/^#\s/, '')}</h3>;
				if (/^\s*[-*]\s/.test(l)) return <div key={i} className="pl-3 relative before:content-['•'] before:absolute before:left-0" dangerouslySetInnerHTML={{ __html: inline(l.replace(/^\s*[-*]\s/, '')) }} />;
				if (!l.trim()) return null;
				return <p key={i} dangerouslySetInnerHTML={{ __html: inline(l) }} />;
			})}
		</div>
	);
}
function inline(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
}
