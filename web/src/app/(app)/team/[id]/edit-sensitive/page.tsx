// /team/[id]/edit-sensitive — compensation structure + PAP tracking + HR notes.
// This route existed as a link on /team/[id] with no page behind it (404);
// this is that page. Gated to people_managers / exec / admin.

import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Lock, ExternalLink } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { Field, FormError, inputClass, selectClass } from '../../_form';
import { saveSensitive } from './actions';
import { PAY_STRUCTURES, REVIEW_CYCLES, PAP_STATUSES, CURRENCIES } from '@/lib/people/constants';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ error?: string }>;
}

interface SensitiveRow {
	comp_base_cents: number | null;
	comp_currency: string | null;
	comp_review_cycle: string | null;
	comp_next_review_on: string | null;
	pay_structure: string | null;
	pap_status: string | null;
	pap_started_on: string | null;
	pap_ends_on: string | null;
	pap_doc_url: string | null;
	pap_owner_id: string | null;
	gusto_employee_id: string | null;
	emergency_contact_md: string | null;
	notes_md: string | null;
}

const EXTERNAL_LINKS = [
	{
		label: 'V2 Pay System (master)',
		url: 'https://docs.google.com/spreadsheets/d/1CLl2AP1w3yRwx5RqgmYrCSDOtm9D9iN7XucXf_2d3EI/edit',
	},
	{
		label: 'PAPs folder',
		url: 'https://drive.google.com/drive/folders/1iCHg9xGuvFAkx-UiNIwnllLarNZB5PDN',
	},
];

export default async function EditSensitivePage({ params, searchParams }: PageProps) {
	const { id } = await params;
	const { error } = await searchParams;
	const supabase = await createClient();

	const [{ data: profile }, ctx] = await Promise.all([
		supabase.from('profiles').select('id, email, first_name, last_name, title').eq('id', id).maybeSingle(),
		loadSensitiveAccessContext(),
	]);

	if (!profile) notFound();
	const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email;

	if (!canManagePeople(ctx)) {
		return (
			<>
				<Card>
					<div className="text-center py-12 text-slate-500">
						<Lock className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
						<p className="text-sm">
							Compensation and PAP records are editable by people-managers, exec, and admin only.
						</p>
						<Link
							href={`/team/${id}`}
							className="inline-block mt-3 text-xs text-primary-600 hover:underline"
						>
							Back to the profile
						</Link>
					</div>
				</Card>
			</>
		);
	}

	const [{ data: sensitiveRow }, { data: owners }] = await Promise.all([
		supabase.from('profile_sensitive').select('*').eq('user_id', id).maybeSingle(),
		supabase
			.from('profiles')
			.select('id, first_name, last_name, email')
			.eq('is_active', true)
			.order('first_name', { ascending: true }),
	]);

	const sensitive = (sensitiveRow ?? null) as SensitiveRow | null;
	const baseValue =
		sensitive?.comp_base_cents != null ? (sensitive.comp_base_cents / 100).toFixed(2) : '';

	const saveAction = async (formData: FormData): Promise<void> => {
		'use server';
		await saveSensitive(id, formData);
	};

	return (
		<>
			<div className="mb-4">
				<Link
					href={`/team/${id}`}
					className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-primary-600 transition-colors"
				>
					<ChevronLeft className="w-3 h-3" /> Back to {fullName}
				</Link>
			</div>

			<PageHeader
				title={
					<span className="inline-flex items-center gap-2">
						<Lock className="w-4 h-4 text-slate-400" /> Compensation &amp; PAP · {fullName}
					</span>
				}
				description="Sensitive. Payroll itself stays in Gusto — this tracks structure, review cadence and PAP state so managers can act on it inside the app."
				actions={
					<div className="flex flex-wrap items-center gap-1.5 justify-end">
						{EXTERNAL_LINKS.map((l) => (
							<a
								key={l.url}
								href={l.url}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 transition-colors"
							>
								<ExternalLink className="w-3 h-3" /> {l.label}
							</a>
						))}
					</div>
				}
			/>

			<form action={saveAction} className="space-y-4">
				<FormError message={error} />

				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
						Compensation
					</h2>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<Field label="Base pay" hint="Whole units — stored in cents. Leave blank to keep it in Gusto only.">
							<input
								name="comp_base"
								inputMode="decimal"
								defaultValue={baseValue}
								placeholder="65000"
								className={inputClass}
							/>
						</Field>
						<Field label="Currency">
							<select name="comp_currency" defaultValue={sensitive?.comp_currency ?? 'USD'} className={selectClass}>
								{CURRENCIES.map((c) => (
									<option key={c} value={c}>
										{c}
									</option>
								))}
							</select>
						</Field>
						<Field label="Pay structure">
							<select name="pay_structure" defaultValue={sensitive?.pay_structure ?? ''} className={selectClass}>
								<option value="">— Not set —</option>
								{PAY_STRUCTURES.map((s) => (
									<option key={s} value={s}>
										{s}
									</option>
								))}
							</select>
						</Field>
						<Field label="Review cycle">
							<select
								name="comp_review_cycle"
								defaultValue={sensitive?.comp_review_cycle ?? ''}
								className={selectClass}
							>
								<option value="">— Not set —</option>
								{REVIEW_CYCLES.map((c) => (
									<option key={c} value={c}>
										{c}
									</option>
								))}
							</select>
						</Field>
						<Field label="Next review on">
							<input
								name="comp_next_review_on"
								type="date"
								defaultValue={sensitive?.comp_next_review_on ?? ''}
								className={inputClass}
							/>
						</Field>
						<Field label="Gusto employee ID">
							<input
								name="gusto_employee_id"
								defaultValue={sensitive?.gusto_employee_id ?? ''}
								className={inputClass}
							/>
						</Field>
					</div>
				</Card>

				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
						Performance Action Plan
					</h2>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<Field label="PAP status">
							<select name="pap_status" defaultValue={sensitive?.pap_status ?? 'not_on_pap'} className={selectClass}>
								{PAP_STATUSES.map((s) => (
									<option key={s} value={s}>
										{s}
									</option>
								))}
							</select>
						</Field>
						<Field label="PAP owner" hint="Who runs this plan with the team member.">
							<select name="pap_owner_id" defaultValue={sensitive?.pap_owner_id ?? ''} className={selectClass}>
								<option value="">— Not set —</option>
								{(owners ?? []).map((o) => (
									<option key={o.id} value={o.id}>
										{[o.first_name, o.last_name].filter(Boolean).join(' ') || o.email}
									</option>
								))}
							</select>
						</Field>
						<Field label="Started on">
							<input
								name="pap_started_on"
								type="date"
								defaultValue={sensitive?.pap_started_on ?? ''}
								className={inputClass}
							/>
						</Field>
						<Field label="Ends on">
							<input
								name="pap_ends_on"
								type="date"
								defaultValue={sensitive?.pap_ends_on ?? ''}
								className={inputClass}
							/>
						</Field>
						<Field label="PAP document URL" wide>
							<input
								name="pap_doc_url"
								type="url"
								defaultValue={sensitive?.pap_doc_url ?? ''}
								placeholder="https://docs.google.com/…"
								className={inputClass}
							/>
						</Field>
					</div>
				</Card>

				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
						HR notes
					</h2>
					<div className="grid grid-cols-1 gap-3">
						<Field label="Notes" hint="Visible to people-managers, exec, admin — and to the team member themselves.">
							<textarea name="notes_md" rows={4} defaultValue={sensitive?.notes_md ?? ''} className={inputClass} />
						</Field>
						<Field label="Emergency contact" hint="Keep it to a name and a phone — no medical or ID details.">
							<textarea
								name="emergency_contact_md"
								rows={2}
								defaultValue={sensitive?.emergency_contact_md ?? ''}
								className={inputClass}
							/>
						</Field>
					</div>
				</Card>

				<div className="flex items-center gap-2">
					<Button type="submit">Save</Button>
					<Link href={`/team/${id}`}>
						<Button variant="outline" type="button">
							Cancel
						</Button>
					</Link>
				</div>
			</form>
		</>
	);
}
