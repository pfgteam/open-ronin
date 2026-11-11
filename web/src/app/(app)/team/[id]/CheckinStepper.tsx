'use client';

// Paged check-in (Work Revamp spec §4.4 / phase 9): the same <form> the
// server renders, shown one step at a time. Every step stays in the DOM
// (only `hidden`), so FormData, the server action and its validation are
// unchanged. A required field that fails on submit while its step is hidden
// jumps the form to that step and reports it there.

import { Children, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { controlFocus } from '@/components/ui/focus';

export interface CheckinStep {
	key: string;
	label: string;
	optional?: boolean;
}

export default function CheckinStepper({ steps, footer, children }: {
	steps: CheckinStep[];
	/** Submit / draft buttons — shown on the last step (draft on every step). */
	footer: { submit: React.ReactNode; draft?: React.ReactNode };
	children: React.ReactNode;
}) {
	const panels = Children.toArray(children);
	const [step, setStep] = useState(0);
	const rootRef = useRef<HTMLDivElement>(null);
	const last = steps.length - 1;

	const panelOf = (el: Element) => {
		const host = el.closest('[data-step]');
		return host ? Number(host.getAttribute('data-step')) : -1;
	};

	/** Validate the current step's required fields before moving on. */
	const next = () => {
		const panel = rootRef.current?.querySelector(`[data-step="${step}"]`);
		const invalid = panel ? Array.from(panel.querySelectorAll<HTMLInputElement>('input, textarea, select')).find((el) => !el.checkValidity()) : undefined;
		if (invalid) { invalid.reportValidity(); return; }
		setStep((s) => Math.min(last, s + 1));
		rootRef.current?.scrollIntoView({ block: 'nearest' });
	};

	return (
		<div
			ref={rootRef}
			// `invalid` doesn't bubble; capture sees it. The browser can't focus a
			// control inside a hidden step, so move to that step and re-report.
			onInvalidCapture={(e) => {
				const target = e.target as HTMLInputElement;
				const i = panelOf(target);
				if (i >= 0 && i !== step) {
					e.preventDefault();
					setStep(i);
					setTimeout(() => target.reportValidity(), 0);
				}
			}}
			className="space-y-4"
		>
			<ol role="list" aria-label="Check-in steps" className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 sm:grid-cols-5">
				{steps.map((s, i) => (
					<li key={s.key}>
						<button
							type="button"
							onClick={() => (i <= step ? setStep(i) : next())}
							aria-current={i === step ? 'step' : undefined}
							className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs', controlFocus,
								i === step ? 'bg-primary-50 font-semibold text-primary-800 dark:bg-primary-950 dark:text-primary-300' : 'text-slate-600 hover:bg-hover dark:text-slate-400')}
						>
							<span className={clsx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-2xs font-bold',
								i < step ? 'border-green-600 bg-green-600 text-white' : i === step ? 'border-primary-700 bg-primary-700 text-white' : 'border-slate-300 dark:border-slate-600')}>
								{i < step ? <Check className="w-3 h-3" aria-hidden="true" /> : i + 1}
							</span>
							<span className="truncate">{s.label}</span>
						</button>
					</li>
				))}
			</ol>

			{panels.map((panel, i) => (
				<div key={steps[i]?.key ?? i} data-step={i} hidden={i !== step}>
					{panel}
				</div>
			))}

			<div className="flex flex-wrap items-center gap-2 border-t border-slate-200 dark:border-slate-700 pt-3">
				<button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}
					className={clsx('inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm disabled:opacity-40', controlFocus)}>
					<ArrowLeft className="w-4 h-4" aria-hidden="true" />Back
				</button>
				<span className="text-2xs text-slate-500">
					Step {step + 1} of {steps.length}{steps[step]?.optional ? ' · optional, you can skip it' : ''}
				</span>
				<span className="ml-auto flex items-center gap-2">
					{footer.draft}
					{step < last ? (
						<button type="button" onClick={next}
							className={clsx('inline-flex items-center gap-1.5 rounded-md bg-primary-700 px-3 py-2 text-sm font-medium text-white hover:bg-primary-800', controlFocus)}>
							Next<ArrowRight className="w-4 h-4" aria-hidden="true" />
						</button>
					) : footer.submit}
				</span>
			</div>
		</div>
	);
}

/** Appends a suggestion to a textarea in the same form (Highlights step). */
export function SuggestChips({ target, items }: { target: string; items: string[] }) {
	if (!items.length) return null;
	return (
		<span className="mt-1.5 flex flex-wrap gap-1">
			{items.slice(0, 3).map((text) => (
				<button
					key={text}
					type="button"
					onClick={(e) => {
						const form = (e.currentTarget as HTMLElement).closest('form');
						const ta = form?.querySelector<HTMLTextAreaElement>(`textarea[name="${target}"]`);
						if (!ta) return;
						ta.value = ta.value.trim() ? `${ta.value.trim()}\n${text}` : text;
						ta.focus();
					}}
					className={clsx('max-w-56 truncate rounded-md border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-2xs text-slate-600 hover:bg-hover dark:text-slate-300', controlFocus)}
				>
					+ {text}
				</button>
			))}
		</span>
	);
}

/** Next-week focus: up to 3 checkboxes named `focus` (server caps it too). */
export function FocusPicker({ items, initial, disabled }: { items: { id: string; name: string; board: string }[]; initial: string[]; disabled?: boolean }) {
	const [picked, setPicked] = useState<string[]>(initial);
	return (
		<ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded-md border border-slate-200 dark:border-slate-700">
			{items.map((it) => {
				const on = picked.includes(it.id);
				const full = !on && picked.length >= 3;
				return (
					<li key={it.id}>
						<label className={clsx('flex h-10 items-center gap-2 px-3 text-sm', full || disabled ? 'opacity-60' : 'cursor-pointer hover:bg-hover')}>
							<input type="checkbox" name="focus" value={it.id} checked={on} disabled={disabled || full} className="accent-primary-600"
								onChange={(e) => setPicked((p) => (e.target.checked ? [...p, it.id] : p.filter((x) => x !== it.id)))} />
							<span className="min-w-0 truncate">{it.name}</span>
							<span className="ml-auto shrink-0 text-2xs text-slate-500">{it.board}</span>
						</label>
					</li>
				);
			})}
			{!items.length && <li className="px-3 py-4 text-sm text-slate-500">Nothing open to pick from.</li>}
		</ul>
	);
}
