'use client';

// Renders an open form with its conditional logic live: fields appear and
// disappear as earlier answers change. Submits through submitForm, which
// re-applies the same rules on the server.

import { useState, useTransition } from 'react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import { visibleFields, type FormField, type FormValues } from '@/lib/forms/logic';
import { submitForm } from './actions';

const cls = 'w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400';

export default function FormRenderer({ slug, fields, allowMultiple }: { slug: string; fields: FormField[]; allowMultiple: boolean }) {
	const [values, setValues] = useState<FormValues>({});
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [pending, start] = useTransition();
	const shown = visibleFields(fields, values);
	const set = (k: string, v: FormValues[string]) => setValues((x) => ({ ...x, [k]: v }));

	function submit(e: React.FormEvent) {
		e.preventDefault();
		setMsg(null);
		start(async () => {
			const res = await submitForm(slug, values);
			if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
			setMsg({ ok: true, text: allowMultiple ? 'Submitted. Thank you.' : 'Submitted. Thank you — this form takes one response per person.' });
			setValues({});
		});
	}

	return (
		<form onSubmit={submit} className="space-y-3">
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
			<Card className="space-y-4">
				{shown.map((f) => (
					<div key={f.key}>
						<label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">
							{f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
						</label>
						{f.type === 'textarea' ? (
							<textarea rows={3} value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} className={cls} />
						) : f.type === 'select' ? (
							<select value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} className={cls}>
								<option value="">—</option>
								{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
							</select>
						) : f.type === 'multiselect' ? (
							<div className="flex flex-wrap gap-x-4 gap-y-1">
								{(f.options ?? []).map((o) => {
									const cur = Array.isArray(values[f.key]) ? (values[f.key] as string[]) : [];
									return (
										<label key={o} className="inline-flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
											<input type="checkbox" checked={cur.includes(o)} onChange={(e) => set(f.key, e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))} />
											{o}
										</label>
									);
								})}
							</div>
						) : f.type === 'checkbox' ? (
							<label className="inline-flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
								<input type="checkbox" checked={values[f.key] === true} onChange={(e) => set(f.key, e.target.checked)} /> Yes
							</label>
						) : (
							<input
								type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'}
								value={String(values[f.key] ?? '')}
								onChange={(e) => set(f.key, e.target.value)}
								className={cls}
							/>
						)}
						{f.help && <p className="text-2xs text-slate-600 dark:text-slate-400 mt-1">{f.help}</p>}
					</div>
				))}
				{shown.length === 0 && <p className="text-sm text-slate-500">This form has no fields yet.</p>}
			</Card>
			<Button type="submit" disabled={pending || shown.length === 0}>Submit</Button>
		</form>
	);
}
