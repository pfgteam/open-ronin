'use client';

// Form builder: ordered fields, each with a type, options and an optional
// "show if" rule pointing at an earlier field. Saves through saveForm; the
// same logic module validates here and on the server.
//
// 0158 added the Sharing & notifications panel (public hosting at
// /f/<slug>, the embed snippet, notify list, thank-you copy + button,
// redirect, confidential, submission tags), the phone + file types, and a
// live preview that renders the real public form component.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { ArrowDown, ArrowUp, Copy, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import {
	FIELD_TYPES,
	FIELD_TYPE_LABELS,
	OPS,
	OP_LABELS,
	validateFields,
	type FormField,
	type Op,
} from '@/lib/forms/logic';
import { embedSnippet, hostedUrl, type PublicFormDef } from '@/lib/forms/shared';
import PublicForm from '@/app/f/[slug]/PublicForm';
import { saveForm } from './actions';

export interface BuilderForm {
	id?: string;
	slug: string;
	title: string;
	description_md: string | null;
	status: 'draft' | 'open' | 'closed';
	allow_multiple: boolean;
	anonymous_ok: boolean;
	fields: FormField[];
	is_public: boolean;
	confidential: boolean;
	request_type: string | null;
	notify_emails: string[];
	success_message: string | null;
	redirect_url: string | null;
	success_cta_label: string | null;
	success_cta_url: string | null;
	submit_label: string | null;
	brand_label: string | null;
	submission_tags: Record<string, string>;
}

export const EMPTY_BUILDER_FORM: BuilderForm = {
	slug: '', title: '', description_md: null, status: 'draft', allow_multiple: true, anonymous_ok: false, fields: [],
	is_public: false, confidential: false, request_type: null, notify_emails: [], success_message: null, redirect_url: null,
	success_cta_label: null, success_cta_url: null, submit_label: null, brand_label: null, submission_tags: {},
};

const blankField = (n: number): FormField => ({ key: `field_${n}`, label: '', type: 'text', required: false, show_if: null });
const textarea = 'w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2';

function CopyButton({ text, label }: { text: string; label: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(text);
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				} catch {
					/* clipboard blocked */
				}
			}}
			className="inline-flex items-center gap-1 text-2xs text-primary-600 hover:underline"
		>
			<Copy className="w-3 h-3" /> {copied ? 'Copied' : label}
		</button>
	);
}

function tagsToText(t: Record<string, string>): string {
	return Object.entries(t).map(([k, v]) => `${k}=${v}`).join('\n');
}
function textToTags(s: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of s.split(/[\n,]+/)) {
		const [k, ...rest] = line.split('=');
		const key = k?.trim();
		if (key && rest.length) out[key] = rest.join('=').trim();
	}
	return out;
}

export default function FormBuilder({ initial, appUrl }: { initial: BuilderForm; appUrl: string }) {
	const router = useRouter();
	const [form, setForm] = useState<BuilderForm>(initial);
	const [notifyText, setNotifyText] = useState(initial.notify_emails.join('\n'));
	const [tagsText, setTagsText] = useState(tagsToText(initial.submission_tags));
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [preview, setPreview] = useState(false);
	const [pending, start] = useTransition();
	const errors = validateFields(form.fields);

	const setField = (i: number, patch: Partial<FormField>) =>
		setForm((f) => ({ ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
	const move = (i: number, dir: -1 | 1) =>
		setForm((f) => {
			const next = [...f.fields];
			const j = i + dir;
			if (j < 0 || j >= next.length) return f;
			[next[i], next[j]] = [next[j], next[i]];
			return { ...f, fields: next };
		});

	function save() {
		setMsg(null);
		const notify_emails = notifyText.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
		const payload = { ...form, notify_emails, submission_tags: textToTags(tagsText) };
		start(async () => {
			const res = await saveForm(payload);
			if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
			setForm(payload);
			setMsg({ ok: true, text: 'Saved.' });
			if (!form.id && res.id) router.replace(`/data/forms?edit=${form.slug}`);
			router.refresh();
		});
	}

	const live = !!(form.id && form.status === 'open' && form.is_public && form.slug);
	const previewDef: PublicFormDef = {
		slug: form.slug || 'preview',
		title: form.title || 'Untitled form',
		description: form.description_md,
		fields: form.fields,
		pages: Object.fromEntries(form.fields.map((f) => [f.key, (f as { page?: number }).page ?? 1])),
		submit_label: form.submit_label || 'Submit',
		brand_label: form.brand_label || 'Open Ronin',
		success_message: form.success_message,
		redirect_url: null,
		success_cta_label: form.success_cta_label,
		success_cta_url: form.success_cta_url,
		turnstile_site_key: null,
	};

	return (
		<div className="space-y-4">
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
			<Card className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
				<Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
				<Input label="Slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="client-onboarding" />
				<Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as BuilderForm['status'] })}>
					<option value="draft">Draft</option>
					<option value="open">Open</option>
					<option value="closed">Closed</option>
				</Select>
				<div className="flex flex-col gap-1.5 justify-end text-xs text-slate-700 dark:text-slate-300">
					<label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={form.allow_multiple} onChange={(e) => setForm({ ...form, allow_multiple: e.target.checked })} /> Allow multiple per person</label>
					<label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={form.anonymous_ok} onChange={(e) => setForm({ ...form, anonymous_ok: e.target.checked })} /> Anonymous OK (staff fills)</label>
				</div>
				<div className="sm:col-span-2 lg:col-span-4">
					<label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">Intro</label>
					<textarea rows={2} value={form.description_md ?? ''} onChange={(e) => setForm({ ...form, description_md: e.target.value || null })} className={textarea} />
				</div>
			</Card>

			{/* Sharing & notifications (0158) */}
			<Card className="space-y-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Sharing &amp; notifications</h3>
					<div className="flex flex-wrap items-center gap-3 text-xs text-slate-700 dark:text-slate-300">
						<label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })} /> Public (hosted + embeddable)</label>
						<label className="inline-flex items-center gap-1.5" title="Submissions readable by execs and admins only"><input type="checkbox" checked={form.confidential} onChange={(e) => setForm({ ...form, confidential: e.target.checked })} /> Confidential (execs only)</label>
					</div>
				</div>
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
					<Input label="Request type" value={form.request_type ?? ''} onChange={(e) => setForm({ ...form, request_type: e.target.value.toLowerCase() || null })} placeholder="speaking-request" />
					<Input label="Header label" value={form.brand_label ?? ''} onChange={(e) => setForm({ ...form, brand_label: e.target.value || null })} placeholder="Open Ronin" />
					<Input label="Submit button" value={form.submit_label ?? ''} onChange={(e) => setForm({ ...form, submit_label: e.target.value || null })} placeholder="Submit" />
					<Input label="Redirect after submit (optional)" value={form.redirect_url ?? ''} onChange={(e) => setForm({ ...form, redirect_url: e.target.value || null })} placeholder="https://…/thank-you" />
					<div className="sm:col-span-2">
						<label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">Notify on every submission (one email per line)</label>
						<textarea rows={2} value={notifyText} onChange={(e) => setNotifyText(e.target.value)} className={textarea} placeholder="you@example.com" />
					</div>
					<div className="sm:col-span-2">
						<label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">Thank-you message</label>
						<textarea rows={2} value={form.success_message ?? ''} onChange={(e) => setForm({ ...form, success_message: e.target.value || null })} className={textarea} placeholder="Thanks, we'll be in touch." />
					</div>
					<Input label="Thank-you button text (optional)" value={form.success_cta_label ?? ''} onChange={(e) => setForm({ ...form, success_cta_label: e.target.value || null })} placeholder="Download the PDF" />
					<Input label="Thank-you button URL" value={form.success_cta_url ?? ''} onChange={(e) => setForm({ ...form, success_cta_url: e.target.value || null })} placeholder="https://…/file.pdf" />
					<div className="sm:col-span-2">
						<label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">Submission tags (key=value per line)</label>
						<textarea rows={1} value={tagsText} onChange={(e) => setTagsText(e.target.value)} className={textarea} placeholder="lead_magnet=compare" />
					</div>
				</div>
				{form.slug && (
					<div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 p-3 space-y-2 text-xs">
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
							<span className="text-slate-600 dark:text-slate-400">Hosted:</span>
							<a href={hostedUrl(form.slug, appUrl)} target="_blank" rel="noreferrer" className="font-mono text-primary-600 hover:underline">{hostedUrl(form.slug, appUrl)}</a>
							<CopyButton text={hostedUrl(form.slug, appUrl)} label="Copy link" />
							{!live && <span className="text-2xs text-amber-700 dark:text-amber-400">{form.is_public ? (form.status === 'open' ? 'save to go live' : 'set status Open to go live') : 'not public yet'}</span>}
						</div>
						<div>
							<div className="flex items-center gap-3 mb-1">
								<span className="text-slate-600 dark:text-slate-400">Embed on another site:</span>
								<CopyButton text={embedSnippet(form.slug, appUrl)} label="Copy snippet" />
							</div>
							<pre className="font-mono text-2xs whitespace-pre-wrap break-all rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 text-slate-700 dark:text-slate-300">{embedSnippet(form.slug, appUrl)}</pre>
						</div>
					</div>
				)}
			</Card>

			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Fields</h3>
				<Button variant="outline" size="sm" type="button" onClick={() => setPreview((p) => !p)} className="gap-1.5">
					{preview ? <><Pencil className="w-3.5 h-3.5" /> Edit fields</> : <><Eye className="w-3.5 h-3.5" /> Preview</>}
				</Button>
			</div>

			{preview ? (
				<div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 p-4 sm:p-8">
					<div className="max-w-xl mx-auto rounded-lg overflow-hidden border border-slate-200 bg-white text-slate-900">
						<div className="border-t-4 border-primary-700 px-6 pt-6 pb-4">
							<div className="text-2xs uppercase tracking-[0.18em] text-slate-500">{previewDef.brand_label}</div>
							<h2 className="text-xl font-bold tracking-tight mt-1">{previewDef.title}</h2>
							{previewDef.description && <p className="text-sm text-slate-600 mt-2 whitespace-pre-line">{previewDef.description}</p>}
						</div>
						<div className="px-6 pb-6">
							<PublicForm key={JSON.stringify(previewDef)} def={previewDef} preview />
						</div>
					</div>
					<p className="text-2xs text-slate-500 text-center mt-3">Preview only: nothing is submitted.</p>
				</div>
			) : (
				<div className="space-y-2">
					{form.fields.map((f, i) => {
						const earlier = form.fields.slice(0, i);
						return (
							<Card key={i} className="space-y-2">
								<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
									<Input label="Label" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} />
									<Input label="Key" value={f.key} onChange={(e) => setField(i, { key: e.target.value })} />
									<Select label="Type" value={f.type} onChange={(e) => setField(i, { type: e.target.value as FormField['type'] })}>
										{FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
									</Select>
									<label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 pb-2">
										<input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })} /> Required
									</label>
									<div className="flex items-center gap-1 justify-end pb-1">
										<button type="button" onClick={() => move(i, -1)} className="p-1 text-slate-400 hover:text-primary-600" aria-label="Move up"><ArrowUp className="w-3.5 h-3.5" /></button>
										<button type="button" onClick={() => move(i, 1)} className="p-1 text-slate-400 hover:text-primary-600" aria-label="Move down"><ArrowDown className="w-3.5 h-3.5" /></button>
										<button type="button" onClick={() => setForm((x) => ({ ...x, fields: x.fields.filter((_, j) => j !== i) }))} className="p-1 text-slate-400 hover:text-red-600" aria-label="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
									</div>
								</div>
								{(f.type === 'select' || f.type === 'multiselect') && (
									<Input label="Options (comma-separated)" value={(f.options ?? []).join(', ')} onChange={(e) => setField(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
								)}
								<Input label="Help text" value={f.help ?? ''} onChange={(e) => setField(i, { help: e.target.value || undefined })} />
								{/* Conditional logic */}
								<div className="rounded-md border border-dashed border-slate-200 dark:border-slate-700 p-2">
									<div className="flex flex-wrap items-center gap-2 text-xs">
										<span className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">Show this field</span>
										<select
											value={f.show_if?.field ?? ''}
											disabled={earlier.length === 0}
											onChange={(e) => setField(i, { show_if: e.target.value ? { field: e.target.value, op: f.show_if?.op ?? 'eq', value: f.show_if?.value ?? '' } : null })}
											className="text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1"
										>
											<option value="">always</option>
											{earlier.map((g) => <option key={g.key} value={g.key}>only if “{g.label || g.key}”</option>)}
										</select>
										{f.show_if && (
											<>
												<select value={f.show_if.op} onChange={(e) => setField(i, { show_if: { ...f.show_if!, op: e.target.value as Op } })} className="text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1">
													{OPS.map((o) => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
												</select>
												{(f.show_if.op === 'eq' || f.show_if.op === 'neq' || f.show_if.op === 'in') && (
													<input
														value={f.show_if.value ?? ''}
														onChange={(e) => setField(i, { show_if: { ...f.show_if!, value: e.target.value } })}
														placeholder={f.show_if.op === 'in' ? 'a, b, c' : 'value'}
														className="text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 w-40"
													/>
												)}
											</>
										)}
									</div>
								</div>
							</Card>
						);
					})}
					<Button variant="outline" type="button" onClick={() => setForm((f) => ({ ...f, fields: [...f.fields, blankField(f.fields.length + 1)] }))} className="gap-1.5">
						<Plus className="w-4 h-4" /> Add field
					</Button>
				</div>
			)}

			{errors.length > 0 && <Callout tone="warning">{errors[0]}{errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}</Callout>}
			<div className="flex flex-wrap items-center gap-3">
				<Button type="button" onClick={save} disabled={pending || errors.length > 0 || !form.title || !form.slug}>{form.id ? 'Save changes' : 'Create form'}</Button>
				{live && <a href={hostedUrl(form.slug, appUrl)} target="_blank" rel="noreferrer" className="text-xs text-primary-600 hover:underline">Open the public form →</a>}
				{form.id && !form.is_public && form.status === 'open' && <a href={`/data/forms/${form.slug}`} className="text-xs text-primary-600 hover:underline">Open the staff form →</a>}
				{form.id && <a href={`/data/forms/${form.slug}/submissions`} className="text-xs text-primary-600 hover:underline">Inbox →</a>}
			</div>
		</div>
	);
}
