// /clients/[id]/edit — Edit client_meta for a client. [id] is clients_v2.id;
// client_meta itself is still keyed by the primary contract's Airtable id.
// Admin/exec/manager gated. Server-rendered form with a single server action.

import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { requireClient } from '../_lib';
import { redirect } from 'next/navigation';
import { createClient, getAuthUser } from '@/lib/supabase/server';
import { saveClientMeta, saveClientOrg } from './actions';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ error?: string }>;
}

interface ClientMetaRow {
	airtable_contract_id: string;
	contract_legal_name: string | null;
	website_url: string | null;
	brand_anniversary: string | null;
	client_calendar_url: string | null;
	context_md: string | null;
	story_md: string | null;
	history_md: string | null;
	pr_goals_md: string | null;
	contracted_deliverables_md: string | null;
	feedback_md: string | null;
	has_influencer: boolean;
	has_social: boolean;
	has_awards: boolean;
	has_podcasts: boolean;
	notice_period_days: number;
	first_live_link_url: string | null;
	first_national_url: string | null;
	links: Record<string, string> | null;
}

export default async function ClientEditPage({ params, searchParams }: PageProps) {
	const { id } = await params;
	const { error: saveError } = await searchParams;
	const ctx = await requireClient(id, '/edit');
	const clientId = ctx.clientId;
	const contractId = ctx.airtableId;

	const supabase = await createClient();
	const user = await getAuthUser();
	if (!user) redirect(`/auth/login?redirect=/clients/${clientId}/edit`);

	const { data: me } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();
	if (!me || !['exec', 'admin', 'manager'].includes(me.role)) {
		return (
			<>
				<Card>
					<p className="text-sm text-slate-700 dark:text-slate-300">
						Editing client_meta requires <code>manager</code> role or higher.
					</p>
				</Card>
			</>
		);
	}

	// Org tag lives on clients_v2 directly (0103), independent of the Airtable
	// contract — render this section even for clients with no contract on file.
	const isOrgEditor = ['exec', 'admin'].includes(me.role);
	const [{ data: orgTags }, { data: clientRow }] = await Promise.all([
		supabase.from('tags').select('id, label').eq('category', 'org').order('position'),
		supabase.from('clients_v2').select('org_tag_id').eq('id', clientId).maybeSingle<{ org_tag_id: string | null }>(),
	]);
	const currentOrgTagId = clientRow?.org_tag_id ?? '';

	const saveOrgAction = async (formData: FormData): Promise<void> => {
		'use server';
		const state = await saveClientOrg(clientId, formData);
		if (state?.error) {
			redirect(`/clients/${clientId}/edit?error=${encodeURIComponent(state.error)}`);
		}
	};

	if (!contractId) {
		return (
			<>
				<div className="mb-4">
					<Link
						href={`/clients/${clientId}`}
						className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-primary-600 transition-colors"
					>
						<ChevronLeft className="w-3 h-3" />
						Back to {ctx.name}
					</Link>
				</div>

				{saveError && (
					<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
						<p className="text-sm text-red-700 dark:text-red-300">
							<strong>Could not save:</strong> {saveError}
						</p>
					</Card>
				)}

				<Card className="mb-4">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Org</h2>
					<form action={saveOrgAction} className="flex items-end gap-3">
						<Field label="Org">
							<select name="org_tag_id" defaultValue={currentOrgTagId} disabled={!isOrgEditor} className={inputClass}>
								<option value="">— none —</option>
								{(orgTags ?? []).map((t) => (
									<option key={t.id} value={t.id}>
										{t.label}
									</option>
								))}
							</select>
						</Field>
						{isOrgEditor && <Button type="submit">Save org</Button>}
					</form>
				</Card>

				<Card>
					<p className="text-sm text-slate-700 dark:text-slate-300">
						This client has no Airtable contract on file, so there is no <code>client_meta</code> row to edit yet.
					</p>
				</Card>
			</>
		);
	}

	const { data: existingRow } = await supabase
		.from('client_meta')
		.select('*')
		.eq('airtable_contract_id', contractId)
		.maybeSingle();

	const existing = (existingRow ?? null) as ClientMetaRow | null;
	const links = existing?.links ?? {};

	// Inline server action that adapts saveClientMeta's (id, prevState, formData)
	// signature to the void-returning shape React expects for `<form action>`.
	// saveClientMeta redirects on success and RETURNS a FormState on failure —
	// discarding it made failed saves look like a dead button (18/08 QA audit),
	// so errors now round-trip via ?error= and render in the banner below.
	const saveAction = async (formData: FormData): Promise<void> => {
		'use server';
		const state = await saveClientMeta({ clientId, contractId }, { error: null, success: false }, formData);
		if (state?.error) {
			redirect(`/clients/${clientId}/edit?error=${encodeURIComponent(state.error)}`);
		}
	};

	return (
		<>
			<div className="mb-4">
				<Link
					href={`/clients/${clientId}`}
					className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-primary-600 transition-colors"
				>
					<ChevronLeft className="w-3 h-3" />
					Back to {ctx.name}
				</Link>
			</div>

			<div className="mb-6">
				<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
					Edit · {ctx.name}
				</h1>
				<p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
					App-side fields stored in Supabase <code>client_meta</code>. Airtable Contract
					Agreement fields are managed in Airtable.
				</p>
			</div>

			{saveError && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Could not save:</strong> {saveError}
					</p>
				</Card>
			)}

			{/* Org — separate table (clients_v2), separate form/action from client_meta below */}
			<Card className="mb-4">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Org</h2>
				<form action={saveOrgAction} className="flex items-end gap-3">
					<Field label="Org">
						<select name="org_tag_id" defaultValue={currentOrgTagId} disabled={!isOrgEditor} className={inputClass}>
							<option value="">— none —</option>
							{(orgTags ?? []).map((t) => (
								<option key={t.id} value={t.id}>
									{t.label}
								</option>
							))}
						</select>
					</Field>
					{isOrgEditor && <Button type="submit">Save org</Button>}
				</form>
			</Card>

			<form action={saveAction} className="space-y-4">
				{/* Basics */}
				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
						Basics
					</h2>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<Field label="Contract / Legal name">
							<input
								name="contract_legal_name"
								defaultValue={existing?.contract_legal_name ?? ''}
								placeholder="The SOW party — distinct from Brand"
								className={inputClass}
							/>
						</Field>
						<Field label="Website URL">
							<input
								name="website_url"
								type="url"
								defaultValue={existing?.website_url ?? ''}
								placeholder="https://example.com"
								className={inputClass}
							/>
						</Field>
						<Field label="Brand anniversary">
							<input
								name="brand_anniversary"
								type="date"
								defaultValue={existing?.brand_anniversary ?? ''}
								className={inputClass}
							/>
						</Field>
						<Field label="Client calendar URL">
							<input
								name="client_calendar_url"
								type="url"
								defaultValue={existing?.client_calendar_url ?? ''}
								placeholder="https://calendar.google.com/…"
								className={inputClass}
							/>
						</Field>
						<Field label="Notice period (days)">
							<select
								name="notice_period_days"
								defaultValue={existing?.notice_period_days ?? 60}
								className={inputClass}
							>
								<option value={30}>30 days</option>
								<option value={60}>60 days (standard)</option>
								<option value={90}>90 days</option>
								<option value={120}>120 days</option>
							</select>
						</Field>
					</div>
				</Card>

				{/* Deliverable scope flags */}
				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
						Deliverable scope
					</h2>
					<p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
						What&apos;s in this client&apos;s package. Drives Health package-adherence factor.
					</p>
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
						<Checkbox name="has_influencer" defaultChecked={existing?.has_influencer ?? false}>
							Influencer
						</Checkbox>
						<Checkbox name="has_social" defaultChecked={existing?.has_social ?? false}>
							Social
						</Checkbox>
						<Checkbox name="has_awards" defaultChecked={existing?.has_awards ?? false}>
							Awards
						</Checkbox>
						<Checkbox name="has_podcasts" defaultChecked={existing?.has_podcasts ?? false}>
							Podcasts
						</Checkbox>
					</div>
				</Card>

				{/* Narrative */}
				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
						Narrative
					</h2>
					<div className="space-y-3">
						<Field label="Client context with Open Ronin">
							<textarea
								name="context_md"
								rows={3}
								defaultValue={existing?.context_md ?? ''}
								placeholder="e.g. Has worked with us before, returning client"
								className={inputClass}
							/>
						</Field>
						<Field label="Client story">
							<textarea
								name="story_md"
								rows={5}
								defaultValue={existing?.story_md ?? ''}
								placeholder="Brand origin + mission + key milestones"
								className={inputClass}
							/>
						</Field>
						<Field label="Client history with Open Ronin">
							<textarea
								name="history_md"
								rows={4}
								defaultValue={existing?.history_md ?? ''}
								placeholder="Timeline of the relationship — campaigns, pauses, restarts"
								className={inputClass}
							/>
						</Field>
						<Field label="Main PR goals / priority (narrative)">
							<textarea
								name="pr_goals_md"
								rows={4}
								defaultValue={existing?.pr_goals_md ?? ''}
								placeholder="What the client is trying to accomplish with publicity"
								className={inputClass}
							/>
						</Field>
						<Field label="Contracted monthly deliverables">
							<textarea
								name="contracted_deliverables_md"
								rows={3}
								defaultValue={existing?.contracted_deliverables_md ?? ''}
								placeholder="What the package commits to (informational — package adherence factor uses Airtable goals)"
								className={inputClass}
							/>
						</Field>
						<Field label="Client feedback (verbatim quotes)">
							<textarea
								name="feedback_md"
								rows={4}
								defaultValue={existing?.feedback_md ?? ''}
								placeholder="Important quotes from calls, surveys, emails"
								className={inputClass}
							/>
						</Field>
					</div>
				</Card>

				{/* Milestones */}
				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
						Milestones
					</h2>
					<p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
						First placements drive Client badges (first_live, first_national). The
						app will eventually populate these automatically as new live_links come in.
					</p>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<Field label="1st live link URL">
							<input
								name="first_live_link_url"
								type="url"
								defaultValue={existing?.first_live_link_url ?? ''}
								className={inputClass}
							/>
						</Field>
						<Field label="1st national placement URL">
							<input
								name="first_national_url"
								type="url"
								defaultValue={existing?.first_national_url ?? ''}
								className={inputClass}
							/>
						</Field>
					</div>
				</Card>

				{/* Resource links bundle */}
				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
						Resource links
					</h2>
					<p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
						Quick-jump URLs for the team. All optional.
					</p>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{[
							['drive', 'Client Google Drive'],
							['strategy', 'Strategy docs'],
							['twelve_week', '12-Week Year Plan'],
							['friday_recap', 'Friday Recap'],
							['monthly_report', 'Latest Monthly Report'],
							['call_agenda', 'Call Agenda doc'],
							['product_tracker', 'Product Request Tracker'],
							['media_tracker', 'Media Tracker (Airtable view)'],
							['assignments', 'Assignments (Airtable view)'],
							['strategy_survey', 'Strategy Survey'],
							['termination_letter', 'Termination letter'],
							['pause_report', 'Pause Report'],
							['media_assets', 'Media asset folder'],
						].map(([key, label]) => (
							<Field key={key} label={label as string}>
								<input
									name={`links.${key}`}
									type="url"
									defaultValue={links[key as string] ?? ''}
									placeholder="https://…"
									className={inputClass}
								/>
							</Field>
						))}
					</div>
				</Card>

				<div className="flex items-center justify-between">
					<Link
						href={`/clients/${clientId}`}
						className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
					>
						Cancel
					</Link>
					<Button type="submit">Save</Button>
				</div>
			</form>
		</>
	);
}

const inputClass =
	'w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className="flex flex-col gap-1">
			<span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
			{children}
		</label>
	);
}

function Checkbox({
	name,
	defaultChecked,
	children,
}: {
	name: string;
	defaultChecked: boolean;
	children: React.ReactNode;
}) {
	return (
		<label className="flex items-center gap-2 px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer">
			<input
				type="checkbox"
				name={name}
				defaultChecked={defaultChecked}
				className="w-4 h-4 rounded-md border-slate-300 text-primary-600 focus:ring-primary-500"
			/>
			<span className="text-sm text-slate-700 dark:text-slate-300">{children}</span>
		</label>
	);
}
