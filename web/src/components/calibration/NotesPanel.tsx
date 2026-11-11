'use client';

// Admin -> Calibration: "Notes for next quarter" (0119). One markdown
// scratchpad Alex uses to plan scorecard changes before the next cycle
// opens. Edit / preview toggle, autosaves 800 ms after the last keystroke,
// shows who last edited it and when. Nothing else reads the note.

import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Eye, Loader2, Pencil } from 'lucide-react';
import Card from '@/components/ui/Card';
import Callout from '@/components/ui/Callout';
import { saveCalibrationNote } from '@/app/(app)/admin/calibration/actions';

interface Props {
	noteKey: string;
	body: string;
	updatedAt: string | null;
	updatedByName: string | null;
	/** False when 0119 is not applied: render read-only with a hint. */
	available: boolean;
}

const stamp = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function NotesPanel({ noteKey, body, updatedAt, updatedByName, available }: Props) {
	const [text, setText] = useState(body);
	const [mode, setMode] = useState<'preview' | 'edit'>('preview');
	const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
	const [error, setError] = useState<string | null>(null);
	const [meta, setMeta] = useState({ updatedAt, updatedByName });
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastSaved = useRef(body);

	const persist = (value: string) => {
		if (value === lastSaved.current) { setState('idle'); return; }
		setState('saving');
		void saveCalibrationNote({ key: noteKey, body_md: value }).then((r) => {
			if (r.ok) {
				lastSaved.current = value;
				setMeta({ updatedAt: r.updated_at, updatedByName: r.updated_by_name });
				setError(null);
				setState('saved');
			} else {
				setError(r.error);
				setState('error');
			}
		});
	};

	const onChange = (value: string) => {
		setText(value);
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => persist(value), 800);
	};

	// Flush a pending edit when leaving the page or switching back to preview.
	useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
	const flush = () => {
		if (timer.current) { clearTimeout(timer.current); timer.current = null; }
		persist(text);
	};

	return (
		<Card>
			<div className="flex items-center justify-between gap-2 flex-wrap mb-2">
				<div>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Notes for next quarter</h2>
					<p className="text-2xs text-slate-600 dark:text-slate-400">Planning scratchpad for scorecard changes. Nothing here touches the cycle in progress; edit the real questions under Questions, rubric &amp; weights when the next cycle is ready.</p>
				</div>
				<div className="flex items-center gap-3 text-2xs text-slate-500">
					<span className="inline-flex items-center gap-1 tabular-nums">
						{state === 'saving' && <><Loader2 className="w-3 h-3 animate-spin" /> Saving</>}
						{state === 'saved' && <><Check className="w-3 h-3 text-green-600" /> Saved</>}
						{state !== 'saving' && state !== 'saved' && meta.updatedAt && <>Last edited {meta.updatedByName ? `by ${meta.updatedByName} ` : ''}{stamp(meta.updatedAt)}</>}
						{state === 'saved' && meta.updatedAt && <span className="text-slate-400">· {meta.updatedByName ? `${meta.updatedByName}, ` : ''}{stamp(meta.updatedAt)}</span>}
					</span>
					{available && (
						<button
							type="button"
							onClick={() => { if (mode === 'edit') flush(); setMode(mode === 'edit' ? 'preview' : 'edit'); }}
							className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline"
						>
							{mode === 'edit' ? <><Eye className="w-3.5 h-3.5" /> Preview</> : <><Pencil className="w-3.5 h-3.5" /> Edit</>}
						</button>
					)}
				</div>
			</div>
			{!available && <Callout tone="warning">The notes panel needs migration <code>0119_calibration_notes.sql</code>, written but not applied.</Callout>}
			{error && <Callout tone="error">{error}</Callout>}
			{mode === 'edit' ? (
				<textarea
					value={text}
					onChange={(e) => onChange(e.target.value)}
					onBlur={flush}
					spellCheck
					rows={Math.min(40, Math.max(12, text.split('\n').length + 2))}
					className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono leading-relaxed text-slate-800 dark:text-slate-200 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400 resize-y"
					aria-label="Notes for next quarter (markdown)"
				/>
			) : text.trim() ? (
				<article className="prose prose-sm prose-slate dark:prose-invert max-w-none prose-headings:mt-3 prose-headings:mb-1.5 prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5">
					<Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
				</article>
			) : (
				<p className="text-sm text-slate-500 py-4 text-center">No notes yet. Click Edit to start.</p>
			)}
		</Card>
	);
}
