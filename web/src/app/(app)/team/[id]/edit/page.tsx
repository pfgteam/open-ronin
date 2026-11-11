// /team/[id]/edit — edit the people-data fields on a profile.
// Editable by the team member themselves, or by people-managers/exec/admin.
// role + is_active stay in /admin/users (single privilege surface).

import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Lock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { Field, CheckboxRow, FormError, inputClass, selectClass } from '../../_form';
import { saveProfile } from './actions';
import AvatarUpload from '../AvatarUpload';
import { EMPLOYMENT_STATUSES } from '@/lib/people/constants';
import { formatPosition, romanLevel } from '@/lib/people/position';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ error?: string }>;
}

interface ProfileRow {
	id: string;
	email: string;
	first_name: string | null;
	last_name: string | null;
	title: string | null;
	department: string | null;
	department_tag_id: string | null;
	position_track: string | null;
	position_level: number | null;
	job_role: string | null;
	manager_id: string | null;
	pap_position: string | null;
	date_started: string | null;
	birthday: string | null;
	disc: string | null;
	employment_status: string | null;
	in_office: boolean;
	photo_url: string | null;
	bio_md: string | null;
	why_us_md: string | null;
}

export default async function EditProfilePage({ params, searchParams }: PageProps) {
	const { id } = await params;
	const { error } = await searchParams;
	const supabase = await createClient();

	const [{ data: profileRow }, ctx] = await Promise.all([
		supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
		loadSensitiveAccessContext(),
	]);

	if (!profileRow) notFound();
	const profile = profileRow as unknown as ProfileRow;

	const isSelf = ctx.viewerId === id;
	const canEdit = isSelf || canManagePeople(ctx);
	// Structure (title / department / manager) is people-manager/exec/admin
	// territory (decision 2026-08-18) — self-edit covers everything else.
	// The DB enforces the same via the protect_profile_structure trigger (0024).
	const canEditStructure = canManagePeople(ctx);
	const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email;
	const initials =
		`${profile.first_name?.[0] ?? ''}${profile.last_name?.[0] ?? ''}`.toUpperCase() ||
		profile.email[0].toUpperCase();

	if (!canEdit) {
		return (
			<>
				<Card>
					<div className="text-center py-12 text-slate-500">
						<Lock className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
						<p className="text-sm">
							Only {fullName}, a people-manager, exec, or admin can edit this profile.
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

	const [{ data: candidates }, { data: posRows }, { data: deptRows }, { data: trackRows }] =
		await Promise.all([
			supabase
				.from('profiles')
				.select('id, first_name, last_name, title, email')
				.eq('is_active', true)
				.neq('id', id)
				.order('first_name', { ascending: true }),
			// Positions are data (0030) — the catalog lives in /admin/positions.
			supabase.from('pap_positions').select('slug, label').eq('is_active', true).order('sort'),
			// Departments are canon in tags (/admin/tags); tracks in position_tracks (0033).
			supabase
				.from('tags')
				.select('id, label')
				.eq('category', 'department')
				.order('position'),
			supabase
				.from('position_tracks')
				.select('slug, label')
				.eq('is_active', true)
				.order('sort'),
		]);
	const papPositions = (posRows ?? []) as { slug: string; label: string }[];
	const departments = (deptRows ?? []) as { id: string; label: string }[];
	const tracks = (trackRows ?? []) as { slug: string; label: string }[];

	const deptLabel = departments.find((d) => d.id === profile.department_tag_id)?.label ?? null;
	const trackLabel = tracks.find((t) => t.slug === profile.position_track)?.label ?? profile.position_track;
	// Composed position — {department} {track} {I/II/III} (0033); legacy title is the fallback.
	const composedPosition = formatPosition(deptLabel, trackLabel, profile.position_level);

	const manager = profile.manager_id
		? (candidates ?? []).find((c) => c.id === profile.manager_id)
		: undefined;
	const managerName = manager
		? [manager.first_name, manager.last_name].filter(Boolean).join(' ') || manager.email
		: null;

	const saveAction = async (formData: FormData): Promise<void> => {
		'use server';
		await saveProfile(id, formData);
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
				title={`Edit · ${fullName}`}
				description={
					isSelf
						? 'Your profile — this is what the rest of the team sees in the Directory and org chart. Position (department, track, level), role and manager are set by people managers.'
						: 'Editing as a people-manager. App permissions and account status are managed in Admin → Users.'
				}
			/>

			<form action={saveAction} className="space-y-4">
				<FormError message={error} />

				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Identity</h2>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<Field label="First name">
							<input name="first_name" defaultValue={profile.first_name ?? ''} className={inputClass} />
						</Field>
						<Field label="Last name">
							<input name="last_name" defaultValue={profile.last_name ?? ''} className={inputClass} />
						</Field>
						<Field label="Email" hint="Changing the login email is an Admin → Users action.">
							<input value={profile.email} disabled className={`${inputClass} opacity-60`} />
						</Field>
						{/* Uploader is the primary affordance; it also owns the
						    `photo_url` input (see AvatarUpload's header for why the
						    external-URL field has to live in the same state). */}
						<AvatarUpload
							profileId={id}
							currentUrl={profile.photo_url}
							canEdit={canEdit}
							initials={initials}
						/>
					</div>
				</Card>

				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
						Position &amp; reporting
					</h2>
					<p className="text-2xs text-slate-600 dark:text-slate-400 mb-3">
						The full position is composed, never typed:{' '}
						<span className="font-medium text-slate-700 dark:text-slate-300">
							{'{department} {position} {level}'}
						</span>
						{' — currently: '}
						<span className="font-medium text-slate-900 dark:text-slate-100">
							{composedPosition ?? profile.title ?? '— nothing set —'}
						</span>
					</p>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<Field
							label="Department"
							hint={
								canEditStructure
									? 'The canon list lives in Admin → Departments & Sub-Teams.'
									: 'Set by people managers — ask yours if this is wrong.'
							}
						>
							{canEditStructure ? (
								<select
									name="department_tag_id"
									defaultValue={profile.department_tag_id ?? ''}
									className={selectClass}
								>
									<option value="">— Unassigned —</option>
									{departments.map((d) => (
										<option key={d.id} value={d.id}>
											{d.label}
										</option>
									))}
								</select>
							) : (
								<input
									value={deptLabel ?? profile.department ?? '— Unassigned —'}
									disabled
									className={`${inputClass} opacity-60`}
								/>
							)}
						</Field>
						<Field
							label="Position"
							hint={
								canEditStructure
									? 'The PAP progression: Assistant → Analyst → Specialist → Coordinator → Manager. Managed in Admin → Positions & Specialties.'
									: 'The PAP progression. Set by people managers — ask yours if this is wrong.'
							}
						>
							{canEditStructure ? (
								<select
									name="position_track"
									defaultValue={profile.position_track ?? ''}
									className={selectClass}
								>
									<option value="">— Not set —</option>
									{tracks.map((t) => (
										<option key={t.slug} value={t.slug}>
											{t.label}
										</option>
									))}
								</select>
							) : (
								<input
									value={trackLabel ?? '— Not set —'}
									disabled
									className={`${inputClass} opacity-60`}
								/>
							)}
						</Field>
						<Field
							label="Level"
							hint={
								canEditStructure
									? 'From the PAP — III is the entry step, I the most senior (III → II → I).'
									: 'From the PAP (III → II → I, I is most senior). Set by people managers.'
							}
						>
							{canEditStructure ? (
								<select
									name="position_level"
									defaultValue={profile.position_level ?? ''}
									className={selectClass}
								>
									<option value="">— Not set —</option>
									<option value="3">III</option>
									<option value="2">II</option>
									<option value="1">I</option>
								</select>
							) : (
								<input
									value={romanLevel(profile.position_level) ?? '— Not set —'}
									disabled
									className={`${inputClass} opacity-60`}
								/>
							)}
						</Field>
						<Field label="Role" hint="Free text — what the person actually does.">
							{canEditStructure ? (
								<input
									name="job_role"
									defaultValue={profile.job_role ?? ''}
									placeholder="Runs paid acquisition for Beacon clients…"
									className={inputClass}
								/>
							) : (
								<input
									value={profile.job_role ?? '— Not set —'}
									disabled
									className={`${inputClass} opacity-60`}
								/>
							)}
						</Field>
						<Field label="Reports to" hint="Drives the org chart and the manager's direct-reports list.">
							{canEditStructure ? (
								<select
									name="manager_id"
									defaultValue={profile.manager_id ?? ''}
									className={selectClass}
								>
									<option value="">— No manager set —</option>
									{(candidates ?? []).map((c) => {
										const name =
											[c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
										return (
											<option key={c.id} value={c.id}>
												{name}
												{c.title ? ` · ${c.title}` : ''}
											</option>
										);
									})}
								</select>
							) : (
								<input
									value={managerName ?? '— No manager set —'}
									disabled
									className={`${inputClass} opacity-60`}
								/>
							)}
						</Field>
						<Field
							label="Specialty"
							hint="Lives inside a department; links the person to their metric set (Individual Metrics)."
						>
							{canEditStructure ? (
								<select name="pap_position" defaultValue={profile.pap_position ?? ''} className={selectClass}>
									<option value="">— Not set —</option>
									{papPositions.map((p) => (
										<option key={p.slug} value={p.slug}>{p.label}</option>
									))}
								</select>
							) : (
								<input value={profile.pap_position ?? '— Not set —'} disabled className={`${inputClass} opacity-60`} />
							)}
						</Field>
						<Field
							label="Employment status"
							hint={canEditStructure ? undefined : 'Set by people managers — ask yours if this is wrong.'}
						>
							{canEditStructure ? (
								<select
									name="employment_status"
									defaultValue={profile.employment_status ?? 'Active'}
									className={selectClass}
								>
									{EMPLOYMENT_STATUSES.map((s) => (
										<option key={s} value={s}>
											{s}
										</option>
									))}
								</select>
							) : (
								<input value={profile.employment_status ?? 'Active'} disabled className={`${inputClass} opacity-60`} />
							)}
						</Field>
						<Field label="Started on">
							<input
								name="date_started"
								type="date"
								defaultValue={profile.date_started ?? ''}
								className={inputClass}
							/>
						</Field>
						<Field label="DISC" hint="Style from the DISC assessment — e.g. D, DI, SC.">
							<input
								name="disc"
								defaultValue={profile.disc ?? ''}
								placeholder="DI"
								className={inputClass}
							/>
						</Field>
						<div className="sm:col-span-2 pt-1">
							<CheckboxRow name="in_office" defaultChecked={profile.in_office}>
								Works from the HQ office
							</CheckboxRow>
						</div>
					</div>
				</Card>

				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
						Personal &amp; story
					</h2>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<Field label="Birthday" hint="Day and month are shown to the team; the year is not.">
							<input
								name="birthday"
								type="date"
								defaultValue={profile.birthday ?? ''}
								className={inputClass}
							/>
						</Field>
						<div className="hidden sm:block" />
						<Field label="Bio" wide>
							<textarea
								name="bio_md"
								rows={4}
								defaultValue={profile.bio_md ?? ''}
								placeholder="A few lines the team sees on your profile."
								className={inputClass}
							/>
						</Field>
						<Field label="Why I love working with Open Ronin" wide>
							<textarea
								name="why_us_md"
								rows={3}
								defaultValue={profile.why_us_md ?? ''}
								className={inputClass}
							/>
						</Field>
					</div>
				</Card>

				<div className="flex items-center gap-2">
					<Button type="submit">Save profile</Button>
					<Link href={`/team/${id}`}>
						<Button variant="outline" type="button">
							Cancel
						</Button>
					</Link>
					{canManagePeople(ctx) && (
						<Link
							href={`/team/${id}/edit-sensitive`}
							className="ml-auto text-xs text-primary-600 hover:underline inline-flex items-center gap-1"
						>
							<Lock className="w-3 h-3" /> Compensation &amp; PAP
						</Link>
					)}
				</div>
			</form>
		</>
	);
}
