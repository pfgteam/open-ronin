'use client';

// Admin → Hiring → Scoring (0131): weights, integrity penalties, shortlist
// size, enrichment toggles (LinkedIn via Apify stays off until a key exists).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import { saveScoringSettings } from '@/app/(app)/hiring/actions';

export default function ScoringTab({ scoring, enrich, canManage, apifyReady, textReady, transcribeReady }: { scoring: Record<string, unknown>; enrich: Record<string, unknown>; canManage: boolean; apifyReady: boolean; textReady: boolean; transcribeReady: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const pen = (scoring.integrity_penalties ?? {}) as Record<string, number>;
	const submit = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await saveScoringSettings(fd);
			setMsg(r.ok ? { ok: true, text: 'Scoring settings saved. Rescore a role to apply.' } : { ok: false, text: r.error });
			router.refresh();
		});
	return (
		<div className="space-y-4">
			<Callout tone="info">
				Overall = Merit × merit% + Integrity × integrity%. Merit comes from the AI scoring the answers, resume, links and transcript against the 4R and the role&apos;s scoring categories (0-100 each, weighted). Integrity starts at 100 and loses the penalties below for honeypots, restarts, blocked pastes, pasted text, AI-written answers and claim mismatches the model finds across sources. Providers: text {textReady ? 'ready' : 'MISSING (ANTHROPIC / OPENAI key)'} · transcribe {transcribeReady ? 'ready' : 'none (Deepgram / AssemblyAI / ElevenLabs key)'} · Apify {apifyReady ? 'ready' : 'no token'}.
			</Callout>
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
			<form action={submit} className="space-y-4">
				<Card className="space-y-3">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Weights and shortlist</h2>
					<div className="grid sm:grid-cols-4 gap-3">
						<Input name="merit_weight" label="Merit weight %" type="number" min={0} max={100} defaultValue={Number(scoring.merit_weight ?? 70)} disabled={!canManage} />
						<Input name="integrity_weight" label="Integrity weight %" type="number" min={0} max={100} defaultValue={Number(scoring.integrity_weight ?? 30)} disabled={!canManage} />
						<Input name="shortlist_size" label="Shortlist size" type="number" min={1} max={100} defaultValue={Number(scoring.shortlist_size ?? 10)} disabled={!canManage} />
						<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 self-end">
							<Checkbox name="auto_score_on_submit" defaultChecked={scoring.auto_score_on_submit !== false} disabled={!canManage} /> Auto-score on the cron
						</label>
					</div>
				</Card>
				<Card className="space-y-3">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Integrity penalties (points off 100)</h2>
					<div className="grid sm:grid-cols-3 gap-3">
						<Input name="honeypot_hit" label="Per honeypot skill rated ≥ threshold" type="number" min={0} max={100} defaultValue={pen.honeypot_hit ?? 25} disabled={!canManage} />
						<Input name="restart" label="Per restart (max 3 counted)" type="number" min={0} max={100} defaultValue={pen.restart ?? 5} disabled={!canManage} />
						<Input name="blocked_paste" label="Per blocked paste attempt (max 5)" type="number" min={0} max={100} defaultValue={pen.blocked_paste ?? 4} disabled={!canManage} />
						<Input name="pasted_chars_per_500" label="Per 500 pasted chars" type="number" min={0} max={100} defaultValue={pen.pasted_chars_per_500 ?? 3} disabled={!canManage} />
						<Input name="ai_text_flag" label="Per AI-written answer" type="number" min={0} max={100} defaultValue={pen.ai_text_flag ?? 10} disabled={!canManage} />
						<Input name="claim_mismatch" label="Per medium/high claim mismatch" type="number" min={0} max={100} defaultValue={pen.claim_mismatch ?? 15} disabled={!canManage} />
					</div>
				</Card>
				<Card className="space-y-3">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Enrichment</h2>
					<div className="grid sm:grid-cols-2 gap-3 text-sm text-slate-700 dark:text-slate-300">
						<label className="flex items-center gap-2">
							<Checkbox name="links" defaultChecked={enrich.links !== false} disabled={!canManage} /> Fetch + AI-review portfolio / site / GitHub links
						</label>
						<label className="flex items-center gap-2">
							<Checkbox name="resume" defaultChecked={enrich.resume !== false} disabled={!canManage} /> Parse resumes (PDF / DOCX) to text + facts
						</label>
						<label className="flex items-center gap-2">
							<Checkbox name="video" defaultChecked={enrich.video !== false} disabled={!canManage} /> Transcribe in-browser video recordings
						</label>
						<label className="flex items-center gap-2" title={apifyReady ? '' : 'Set APIFY_TOKEN in Vercel first'}>
							<Checkbox name="linkedin" defaultChecked={enrich.linkedin === true} disabled={!canManage || !apifyReady} /> LinkedIn via Apify actor (round 3; off by default)
						</label>
						<Input name="linkedin_actor" label="Apify actor id" defaultValue={String(enrich.linkedin_actor ?? 'apimaestro/linkedin-profile-detail')} className="sm:col-span-2" disabled={!canManage} />
					</div>
				</Card>
				{canManage && (
					<Button type="submit" size="sm" loading={pending}>
						Save scoring settings
					</Button>
				)}
			</form>
		</div>
	);
}
