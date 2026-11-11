'use client';

// Client pieces for /the-work/acquisitions: the proposal decide row, the
// target edit form and the add-note form. Each calls a server action and
// shows the {ok, error} verdict in a Callout (open-ronin-feature-workflow).

import { useState, useTransition } from 'react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import {
	FINANCIAL_CONFIDENCE, GROWTH_TREND, HARD_GATE, MANAGEMENT_DEPTH, NOTE_KINDS, OWNER_READINESS, RECOMMENDATION,
	RELATIONSHIP_WARMTH, RISK_SEVERITY, RISK_STATUS, SOURCING_CHANNEL, TARGET_STATUSES, type TargetRow,
} from '@/lib/mcp/mappers/acquisitions';
import { addAcquisitionNote, decideAcquisitionProposal, updateAcquisitionTarget } from './actions';

type Result = { ok: true } | { ok: false; error: string };

function useAction(action: (fd: FormData) => Promise<Result>) {
	const [pending, start] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const submit = (fd: FormData) =>
		start(async () => {
			setSaved(false);
			const r = await action(fd);
			setError(r.ok ? null : r.error);
			setSaved(r.ok);
		});
	return { pending, error, saved, submit };
}

const label = (s: string) => s.replace(/_/g, ' ');

function EnumSelect({ name, value, options, allowEmpty = true }: { name: string; value: string | null; options: readonly string[]; allowEmpty?: boolean }) {
	return (
		<Select name={name} defaultValue={value ?? ''} size="sm">
			{allowEmpty && <option value="">—</option>}
			{options.map((o) => (
				<option key={o} value={o}>
					{label(o)}
				</option>
			))}
		</Select>
	);
}

export function ProposalDecide({ actionId }: { actionId: string }) {
	const { pending, error, submit } = useAction(decideAcquisitionProposal);
	return (
		<form action={submit} className="flex flex-wrap items-center gap-2">
			<input type="hidden" name="action_id" value={actionId} />
			<Input name="note" placeholder="Note (optional)" className="max-w-xs" />
			<Button type="submit" name="decision" value="approved" size="sm" loading={pending}>
				Approve &amp; apply
			</Button>
			<Button type="submit" name="decision" value="rejected" size="sm" variant="ghost" disabled={pending}>
				Reject
			</Button>
			{error && (
				<Callout tone="error" className="w-full">
					{error}
				</Callout>
			)}
		</form>
	);
}

const F = ({ children, l }: { children: React.ReactNode; l: string }) => (
	<label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
		<span>{l}</span>
		{children}
	</label>
);

export function TargetEditForm({ t }: { t: TargetRow }) {
	const { pending, error, saved, submit } = useAction(updateAcquisitionTarget);
	return (
		<form action={submit} className="space-y-4">
			<input type="hidden" name="id" value={t.id} />
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<F l="Status"><EnumSelect name="status" value={t.status} options={TARGET_STATUSES} allowEmpty={false} /></F>
				<F l="Hard gate (23)"><EnumSelect name="hard_gate" value={t.hard_gate} options={HARD_GATE} /></F>
				<F l="Scorecard /40 (24)"><Input name="scorecard_total" type="number" min={0} max={40} defaultValue={t.scorecard_total ?? ''} /></F>
				<F l="Recommendation (26)"><EnumSelect name="recommendation" value={t.recommendation} options={RECOMMENDATION} /></F>
				<F l="Next action (22)"><Input name="next_action" defaultValue={t.next_action ?? ''} placeholder="Never blank" /></F>
				<F l="Next action date"><Input name="next_action_on" type="date" defaultValue={t.next_action_on ?? ''} /></F>
				<F l="Vertical (7)"><Input name="vertical" defaultValue={t.vertical ?? ''} /></F>
				<F l="Sourcing channel (18)"><EnumSelect name="sourcing_channel" value={t.sourcing_channel} options={SOURCING_CHANNEL} /></F>
				<F l="Est. revenue (9)"><Input name="est_revenue" defaultValue={t.est_revenue ?? ''} /></F>
				<F l="Est. EBITDA (10)"><Input name="est_ebitda" defaultValue={t.est_ebitda ?? ''} /></F>
				<F l="Financial confidence (11)"><EnumSelect name="financial_confidence" value={t.financial_confidence} options={FINANCIAL_CONFIDENCE} /></F>
				<F l="Retainer mix % (12)"><Input name="retainer_mix_pct" type="number" min={0} max={100} step="0.1" defaultValue={t.retainer_mix_pct ?? ''} /></F>
				<F l="Top-3 concentration % (13)"><Input name="top3_concentration_pct" type="number" min={0} max={100} step="0.1" defaultValue={t.top3_concentration_pct ?? ''} /></F>
				<F l="Growth trend (14)"><EnumSelect name="growth_trend" value={t.growth_trend} options={GROWTH_TREND} /></F>
				<F l="Management depth (15)"><EnumSelect name="management_depth" value={t.management_depth} options={MANAGEMENT_DEPTH} /></F>
				<F l="Owner readiness (17)"><EnumSelect name="owner_readiness" value={t.owner_readiness} options={OWNER_READINESS} /></F>
				<F l="Relationship warmth (19)"><EnumSelect name="relationship_warmth" value={t.relationship_warmth} options={RELATIONSHIP_WARMTH} /></F>
			</div>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				<F l="Notable clients (8)"><Textarea name="notable_clients" rows={2} defaultValue={t.notable_clients ?? ''} /></F>
				<F l="Score drivers (25)"><Textarea name="score_drivers" rows={2} defaultValue={t.score_drivers ?? ''} /></F>
				<F l="BATNA (deal card)"><Textarea name="batna" rows={3} defaultValue={t.batna ?? ''} /></F>
				<F l="Deal structure (deal card)"><Textarea name="deal_structure" rows={3} defaultValue={t.deal_structure ?? ''} /></F>
				<F l="Deal stage notes"><Textarea name="deal_stage_notes" rows={3} defaultValue={t.deal_stage_notes ?? ''} /></F>
				<F l="Notes (28)"><Textarea name="notes" rows={3} defaultValue={t.notes ?? ''} /></F>
			</div>
			<div className="flex items-center gap-3">
				<Button type="submit" loading={pending}>
					Save target
				</Button>
				{saved && <span className="text-xs text-green-700 dark:text-green-400">Saved.</span>}
			</div>
			{error && <Callout tone="error">{error}</Callout>}
		</form>
	);
}

export function AddNoteForm({ targetId }: { targetId: string }) {
	const { pending, error, saved, submit } = useAction(addAcquisitionNote);
	const [kind, setKind] = useState<string>('general');
	return (
		<form action={submit} className="space-y-3">
			<input type="hidden" name="target_id" value={targetId} />
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<F l="Kind">
					<Select name="kind" size="sm" value={kind} onChange={(e) => setKind(e.target.value)}>
						{NOTE_KINDS.map((k) => (
							<option key={k} value={k}>
								{label(k)}
							</option>
						))}
					</Select>
				</F>
				<F l="Date"><Input name="occurred_on" type="date" /></F>
				{kind === 'risk' && (
					<>
						<F l="Severity"><EnumSelect name="severity" value={null} options={RISK_SEVERITY} allowEmpty={false} /></F>
						<F l="Risk status"><EnumSelect name="risk_status" value={null} options={RISK_STATUS} allowEmpty={false} /></F>
					</>
				)}
			</div>
			<F l="Title (optional)"><Input name="title" maxLength={200} /></F>
			<F l="Note"><Textarea name="body_md" rows={4} required placeholder="Markdown. A touch or negotiation note moves the last-touch date." /></F>
			<div className="flex items-center gap-3">
				<Button type="submit" size="sm" loading={pending}>
					Add note
				</Button>
				{saved && <span className="text-xs text-green-700 dark:text-green-400">Added.</span>}
			</div>
			{error && <Callout tone="error">{error}</Callout>}
		</form>
	);
}
