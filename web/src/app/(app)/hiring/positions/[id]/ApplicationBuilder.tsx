'use client';

// Application builder (0130): the role's config-driven application. Section
// list with per-question editing (type, label, help, required, paste mode,
// options, timer, honeypot flag), "AI draft from the 4R", reset to default,
// and a raw JSON drawer for anything the form does not expose. Candidates
// never see honeypot flags; staff do.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { PASTE_MODES, QUESTION_TYPES, QUESTION_TYPE_LABELS, SECTION_KINDS, SECTION_KIND_LABELS, validateConfig, type AppQuestion, type AppSection, type ApplicationConfig } from '@/lib/hiring/application';
import { draftApplicationConfig, resetApplicationToDefault, saveApplicationConfig } from '../../actions';

type Cfg = ApplicationConfig & { scoring?: { key: string; label: string; description?: string; weight: number }[] };

export default function ApplicationBuilder({ positionId, slug, initial, canManage, aiReady, appUrl, funnel }: { positionId: string; slug: string; initial: Cfg | null; canManage: boolean; aiReady: boolean; appUrl: string; funnel: { started: number; consented: number; submitted: number } }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [cfg, setCfg] = useState<Cfg>(initial ?? { version: 2, sections: [] });
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [raw, setRaw] = useState(false);
	const [rawText, setRawText] = useState('');
	const [open, setOpen] = useState<string | null>(cfg.sections[0]?.key ?? null);
	const problem = useMemo(() => validateConfig(cfg), [cfg]);
	const total = cfg.sections.reduce((n, s) => n + s.questions.length, 0);
	const honeypots = cfg.sections.flatMap((s) => s.questions).filter((q) => q.honeypot).length;
	const timed = cfg.sections.flatMap((s) => s.questions).filter((q) => q.type === 'timed_text').length;
	const blocked = cfg.sections.flatMap((s) => s.questions).filter((q) => q.paste === 'block').length;
	const disabled = !canManage;

	const update = (fn: (c: Cfg) => Cfg) => setCfg((c) => fn(structuredClone(c)));
	const setSection = (key: string, patch: Partial<AppSection>) => update((c) => ({ ...c, sections: c.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));
	const setQuestion = (sk: string, qk: string, patch: Partial<AppQuestion>) => update((c) => ({ ...c, sections: c.sections.map((s) => (s.key === sk ? { ...s, questions: s.questions.map((q) => (q.key === qk ? { ...q, ...patch } : q)) } : s)) }));
	const removeQuestion = (sk: string, qk: string) => update((c) => ({ ...c, sections: c.sections.map((s) => (s.key === sk ? { ...s, questions: s.questions.filter((q) => q.key !== qk) } : s)) }));
	const moveQuestion = (sk: string, qk: string, dir: -1 | 1) =>
		update((c) => ({
			...c,
			sections: c.sections.map((s) => {
				if (s.key !== sk) return s;
				const i = s.questions.findIndex((q) => q.key === qk);
				const j = i + dir;
				if (i < 0 || j < 0 || j >= s.questions.length) return s;
				const qs = [...s.questions];
				[qs[i], qs[j]] = [qs[j], qs[i]];
				return { ...s, questions: qs };
			}),
		}));
	const addQuestion = (sk: string) => {
		const used = new Set(cfg.sections.flatMap((s) => s.questions.map((q) => q.key)));
		let key = 'q1';
		let n = 1;
		while (used.has(key)) key = `q${++n}`;
		update((c) => ({ ...c, sections: c.sections.map((s) => (s.key === sk ? { ...s, questions: [...s.questions, { key, type: 'short_text', label: 'New question', required: true, paste: 'track' }] } : s)) }));
	};
	const addSection = () => {
		const used = new Set(cfg.sections.map((s) => s.key));
		let key = 'custom';
		let n = 1;
		while (used.has(key)) key = `custom_${++n}`;
		update((c) => ({ ...c, sections: [...c.sections, { key, kind: 'custom', title: 'New section', questions: [] }] }));
		setOpen(key);
	};
	const removeSection = (sk: string) => update((c) => ({ ...c, sections: c.sections.filter((s) => s.key !== sk) }));
	const moveSection = (sk: string, dir: -1 | 1) =>
		update((c) => {
			const i = c.sections.findIndex((s) => s.key === sk);
			const j = i + dir;
			if (i < 0 || j < 0 || j >= c.sections.length) return c;
			const ss = [...c.sections];
			[ss[i], ss[j]] = [ss[j], ss[i]];
			return { ...c, sections: ss };
		});

	const save = () =>
		start(async () => {
			setMsg(null);
			const fd = new FormData();
			fd.set('position_id', positionId);
			fd.set('config_json', JSON.stringify(cfg));
			const r = await saveApplicationConfig(fd);
			setMsg(r.ok ? { ok: true, text: 'Application saved. Candidates see it on their next page load.' } : { ok: false, text: r.error });
			router.refresh();
		});
	const draft = () =>
		start(async () => {
			setMsg(null);
			const r = await draftApplicationConfig({ position_id: positionId });
			if (!r.ok) return setMsg({ ok: false, text: r.error });
			setCfg(r.config as Cfg);
			setMsg({ ok: true, text: `Drafted from the 4R: ${r.summary}. Review every question (especially the honeypots: they must sound real) and save.` });
		});
	const reset = () =>
		start(async () => {
			const r = await resetApplicationToDefault({ position_id: positionId });
			if (!r.ok) return setMsg({ ok: false, text: r.error });
			setCfg(r.config as Cfg);
			setMsg({ ok: true, text: 'Loaded the default application (generic skills + honeypots). Save to apply.' });
		});
	const applyRaw = () => {
		try {
			const j = JSON.parse(rawText) as Cfg;
			const p = validateConfig(j);
			if (p) return setMsg({ ok: false, text: p });
			setCfg(j);
			setRaw(false);
			setMsg({ ok: true, text: 'JSON applied; save to persist.' });
		} catch {
			setMsg({ ok: false, text: 'Not valid JSON.' });
		}
	};

	return (
		<div className="space-y-4">
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
			<Card className="space-y-3">
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Application</h2>
					<Badge>{cfg.sections.length} sections</Badge>
					<Badge>{total} questions</Badge>
					<Badge color={honeypots ? 'warning' : 'default'}>{honeypots} honeypots</Badge>
					<Badge>{timed} timed</Badge>
					<Badge>{blocked} no-paste</Badge>
					{problem && <Badge color="danger">{problem}</Badge>}
					<span className="text-2xs text-slate-500 ml-auto">
						funnel: {funnel.started} started · {funnel.consented} consented · {funnel.submitted} submitted
					</span>
				</div>
				<p className="text-xs text-slate-500">
					Public form: <a href={`${appUrl}/careers/${slug}/apply`} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">{appUrl}/careers/{slug}/apply</a>. Empty here = the default application from Admin → Hiring. Honeypot skills are rated like any other skill; a 3+ self-rating is an integrity flag. Timed questions block paste and lock when the clock ends.
				</p>
				{canManage && (
					<div className="flex flex-wrap gap-2">
						<Button size="sm" variant="outline" onClick={draft} loading={pending} disabled={!aiReady} title={aiReady ? '' : 'Needs a text provider key'}>
							AI draft from the 4R
						</Button>
						<Button size="sm" variant="ghost" onClick={reset} loading={pending}>
							Load default
						</Button>
						<Button size="sm" variant="ghost" onClick={addSection}>
							+ Section
						</Button>
						<Button size="sm" variant="ghost" onClick={() => { setRawText(JSON.stringify(cfg, null, 2)); setRaw(!raw); }}>
							{raw ? 'Hide JSON' : 'Edit JSON'}
						</Button>
						<Button size="sm" onClick={save} loading={pending} disabled={!!problem || cfg.sections.length === 0}>
							Save application
						</Button>
					</div>
				)}
				{raw && (
					<div className="space-y-2">
						<Textarea rows={18} value={rawText} onChange={(e) => setRawText(e.target.value)} className="font-mono text-xs" />
						<Button size="sm" variant="outline" onClick={applyRaw}>
							Apply JSON
						</Button>
					</div>
				)}
			</Card>

			{cfg.sections.map((s, si) => (
				<Card key={s.key} className="space-y-3">
					<div className="flex flex-wrap items-center gap-2">
						<button type="button" className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:underline" onClick={() => setOpen(open === s.key ? null : s.key)}>
							{si + 1}. {s.title}
						</button>
						<Badge>{SECTION_KIND_LABELS[s.kind]}</Badge>
						<Badge>{s.questions.length} q</Badge>
						{canManage && (
							<span className="ml-auto flex gap-1">
								<Button size="sm" variant="ghost" onClick={() => moveSection(s.key, -1)} disabled={si === 0}>
									↑
								</Button>
								<Button size="sm" variant="ghost" onClick={() => moveSection(s.key, 1)} disabled={si === cfg.sections.length - 1}>
									↓
								</Button>
								<Button size="sm" variant="ghost" onClick={() => removeSection(s.key)} disabled={s.kind === 'consent' || s.kind === 'contact'}>
									Remove
								</Button>
							</span>
						)}
					</div>
					{open === s.key && (
						<div className="space-y-3">
							<div className="grid sm:grid-cols-4 gap-2">
								<Input label="Key" value={s.key} onChange={(e) => setSection(s.key, { key: e.target.value })} pattern="[a-z][a-z0-9_]{0,40}" disabled={disabled} />
								<Input label="Title" value={s.title} onChange={(e) => setSection(s.key, { title: e.target.value })} disabled={disabled} />
								<Select label="Kind" value={s.kind} onChange={(e) => setSection(s.key, { kind: e.target.value as AppSection['kind'] })} disabled={disabled}>
									{SECTION_KINDS.map((k) => (
										<option key={k} value={k}>
											{SECTION_KIND_LABELS[k]}
										</option>
									))}
								</Select>
								<Input label="Intro (shown under the title)" value={s.intro_md ?? ''} onChange={(e) => setSection(s.key, { intro_md: e.target.value || undefined })} disabled={disabled} />
							</div>
							<ul className="divide-y divide-slate-200 dark:divide-slate-700">
								{s.questions.map((q, qi) => (
									<li key={q.key} className="py-3 grid sm:grid-cols-6 gap-2 items-end">
										<Input label="Key" value={q.key} onChange={(e) => setQuestion(s.key, q.key, { key: e.target.value })} pattern="[a-z][a-z0-9_]{0,60}" disabled={disabled} />
										<Select label="Type" value={q.type} onChange={(e) => setQuestion(s.key, q.key, { type: e.target.value as AppQuestion['type'] })} disabled={disabled}>
											{QUESTION_TYPES.map((t) => (
												<option key={t} value={t}>
													{QUESTION_TYPE_LABELS[t]}
												</option>
											))}
										</Select>
										<Input label="Label" value={q.label} onChange={(e) => setQuestion(s.key, q.key, { label: e.target.value })} className="sm:col-span-2" disabled={disabled} />
										<Select label="Paste" value={q.paste ?? 'track'} onChange={(e) => setQuestion(s.key, q.key, { paste: e.target.value as AppQuestion['paste'] })} disabled={disabled}>
											{PASTE_MODES.map((p) => (
												<option key={p} value={p}>
													{p}
												</option>
											))}
										</Select>
										<div className="flex items-center gap-3 text-xs text-slate-700 dark:text-slate-300">
											<label className="flex items-center gap-1">
												<Checkbox checked={q.required ?? false} onChange={(e) => setQuestion(s.key, q.key, { required: e.target.checked })} disabled={disabled} /> req
											</label>
											{q.type === 'rating_1_5' && (
												<label className="flex items-center gap-1" title="A honeypot is a skill/tool that does not exist; rating it 3+ is a red flag">
													<Checkbox checked={q.honeypot ?? false} onChange={(e) => setQuestion(s.key, q.key, { honeypot: e.target.checked, honeypot_threshold: e.target.checked ? (q.honeypot_threshold ?? 3) : undefined })} disabled={disabled} /> honeypot
												</label>
											)}
										</div>
										<Input label="Help text" value={q.help ?? ''} onChange={(e) => setQuestion(s.key, q.key, { help: e.target.value || undefined })} className="sm:col-span-3" disabled={disabled} />
										{(q.type === 'select' || q.type === 'multi') && <Input label="Options (comma separated)" value={(q.options ?? []).join(', ')} onChange={(e) => setQuestion(s.key, q.key, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} className="sm:col-span-2" disabled={disabled} />}
										{q.type === 'timed_text' && <Input label="Time limit (s)" type="number" min={30} max={1800} value={q.time_limit_s ?? 180} onChange={(e) => setQuestion(s.key, q.key, { time_limit_s: Number(e.target.value) })} disabled={disabled} />}
										{(q.type === 'long_text' || q.type === 'short_text' || q.type === 'timed_text') && <Input label="Max chars" type="number" min={10} max={20000} value={q.max_chars ?? ''} onChange={(e) => setQuestion(s.key, q.key, { max_chars: e.target.value ? Number(e.target.value) : undefined })} disabled={disabled} />}
										{canManage && (
											<div className="flex gap-1 sm:col-start-6 justify-end">
												<Button size="sm" variant="ghost" onClick={() => moveQuestion(s.key, q.key, -1)} disabled={qi === 0}>
													↑
												</Button>
												<Button size="sm" variant="ghost" onClick={() => moveQuestion(s.key, q.key, 1)} disabled={qi === s.questions.length - 1}>
													↓
												</Button>
												<Button size="sm" variant="ghost" onClick={() => removeQuestion(s.key, q.key)}>
													×
												</Button>
											</div>
										)}
									</li>
								))}
							</ul>
							{canManage && (
								<Button size="sm" variant="outline" onClick={() => addQuestion(s.key)}>
									+ Question
								</Button>
							)}
						</div>
					)}
				</Card>
			))}
			{cfg.scoring && (
				<Card className="space-y-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Scoring categories (H4 reads these)</h2>
					<ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
						{cfg.scoring.map((c) => (
							<li key={c.key}>
								<span className="font-medium text-slate-800 dark:text-slate-200">{c.label}</span> · {c.weight}%{c.description ? ` · ${c.description}` : ''}
							</li>
						))}
					</ul>
				</Card>
			)}
		</div>
	);
}
