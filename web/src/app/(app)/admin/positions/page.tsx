// /admin/positions — Positions & Specialties (terminology fixed 19/08/2026):
//
//   POSITIONS  (table position_tracks) — the PAP progression: Assistant,
//              Analyst, Specialist, Coordinator, Manager. Not linked to
//              departments. Level I/II/III lives on the profile (1 = most
//              senior; progression III → II → I).
//   SPECIALTIES (table pap_positions — name kept for compatibility) — the
//              Media/Publicist/Content/... list. A specialty lives inside a
//              department or sub-department (tag_id → tags) and links a
//              person to their metric set. Assigned manually, never derived.
//
// Slugs are immutable in both catalogs (they're the values stored on
// profiles and metric definitions); renames change the label only.

import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import ModalCard from '@/components/ui/ModalCard';
import Link from 'next/link';
import { Plus, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { Field, FormError, inputClass, selectClass } from '../../team/_form';
import {
	createPapPosition,
	updatePapPosition,
	togglePapPositionActive,
	createPositionTrack,
	updatePositionTrack,
	togglePositionTrackActive,
} from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
	searchParams: Promise<{ error?: string; edit?: string; new?: string; editTrack?: string; newTrack?: string }>;
}

interface Track {
	slug: string;
	label: string;
	sort: number;
	is_active: boolean;
}

interface Position {
	slug: string;
	label: string;
	tag_id: string | null;
	sort: number;
	is_active: boolean;
}

interface Tag {
	id: string;
	label: string;
	color: string | null;
	category: string | null;
	parent_tag_id: string | null;
}

function PositionForm({ pos, tags }: { pos?: Position; tags: Tag[] }) {
	const departments = tags.filter((t) => t.category === 'department');
	const byId = new Map(tags.map((t) => [t.id, t]));
	const subTeams = tags.filter((t) => t.category === 'sub_team');
	return (
		<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
			{pos && <input type="hidden" name="slug" value={pos.slug} />}
			<Field label="Name" hint={pos ? `Stable key: ${pos.slug} (renames change the label only)` : 'The name becomes the stable key.'}>
				<input name="label" defaultValue={pos?.label ?? ''} placeholder="Publicist" className={inputClass} />
			</Field>
			<Field label="Lives inside" hint="A sub-department OR a department directly — both levels are valid. Managed in Admin → Departments & Sub-Teams.">
				<select name="tag_id" defaultValue={pos?.tag_id ?? ''} className={selectClass}>
					<option value="">— Unlinked —</option>
					<optgroup label="Departments">
						{departments.map((d) => (
							<option key={d.id} value={d.id}>{d.label}</option>
						))}
					</optgroup>
					<optgroup label="Sub-departments">
						{subTeams.map((st) => (
							<option key={st.id} value={st.id}>
								{(st.parent_tag_id && byId.get(st.parent_tag_id)?.label ? `${byId.get(st.parent_tag_id)!.label} — ` : '') + st.label}
							</option>
						))}
					</optgroup>
				</select>
			</Field>
			<div className="flex items-end gap-2">
				<Button type="submit">{pos ? 'Save changes' : 'Create specialty'}</Button>
				<Link href="/admin/positions">
					<Button variant="outline" type="button">Cancel</Button>
				</Link>
			</div>
		</div>
	);
}

export default async function AdminPositionsPage({ searchParams }: PageProps) {
	const { error, edit: editSlug, new: showNew, editTrack: editTrackSlug, newTrack } = await searchParams;
	const supabase = await createClient();
	const ctx = await loadSensitiveAccessContext();
	const canEdit = canManagePeople(ctx);

	const [{ data: posRows }, { data: tagRows }, { data: profileRows }, { data: trackRows }] =
		await Promise.all([
			supabase.from('pap_positions').select('slug, label, tag_id, sort, is_active').order('sort'),
			supabase
				.from('tags')
				.select('id, label, color, category, parent_tag_id')
				.in('category', ['department', 'sub_team'])
				.order('position'),
			supabase.from('profiles').select('pap_position, position_track').eq('is_active', true),
			supabase.from('position_tracks').select('slug, label, sort, is_active').order('sort'),
		]);

	const positions = (posRows ?? []) as Position[];
	const tracks = (trackRows ?? []) as Track[];
	const trackPeopleCount = new Map<string, number>();
	for (const p of profileRows ?? []) {
		const key = (p as { position_track: string | null }).position_track;
		if (key) trackPeopleCount.set(key, (trackPeopleCount.get(key) ?? 0) + 1);
	}
	const editTrack = editTrackSlug ? tracks.find((t) => t.slug === editTrackSlug) : undefined;
	const tags = (tagRows ?? []) as Tag[];
	const byId = new Map(tags.map((t) => [t.id, t]));
	const peopleCount = new Map<string, number>();
	for (const p of profileRows ?? []) {
		const key = (p as { pap_position: string | null }).pap_position;
		if (key) peopleCount.set(key, (peopleCount.get(key) ?? 0) + 1);
	}
	const editPos = editSlug ? positions.find((p) => p.slug === editSlug) : undefined;

	function linkLabel(tagId: string | null): { text: string; color: string | null } {
		if (!tagId) return { text: '—', color: null };
		const t = byId.get(tagId);
		if (!t) return { text: '—', color: null };
		if (t.category === 'sub_team' && t.parent_tag_id) {
			const parent = byId.get(t.parent_tag_id);
			return { text: parent ? `${parent.label} — ${t.label}` : t.label, color: parent?.color ?? t.color };
		}
		return { text: t.label, color: t.color };
	}

	if (positions.length === 0) {
		return (
			<>
				<PageHeader title="Positions & Specialties" description="Specialty catalog — links people to their metric set" />
				<Card>
					<p className="text-sm text-slate-600 dark:text-slate-400">
						The specialty catalog hasn&apos;t been set up yet. Ask Ops to finish enabling it.
						the Supabase SQL Editor.
					</p>
				</Card>
			</>
		);
	}

	return (
		<>
			<PageHeader
				title="Positions & Specialties"
				description="Positions are the PAP progression (Assistant → Manager, level III → I). Specialties live inside a department and link people to their metric sets."
				actions={
					canEdit ? (
						<Link href="/admin/positions?new=1">
							<Button>
								<Plus className="w-3.5 h-3.5" /> New specialty
							</Button>
						</Link>
					) : undefined
				}
			/>

			<div className="space-y-4">
				<FormError message={error} />

				{canEdit && (showNew === '1' || editPos) && (
					<ModalCard
						title={editPos ? `Edit specialty · ${editPos.label}` : 'New specialty'}
						subtitle="A specialty lives inside a department and links people to their metric set."
						closeHref="/admin/positions"
					>
						<form action={editPos ? updatePapPosition : createPapPosition}>
							<PositionForm pos={editPos} tags={tags} />
						</form>
					</ModalCard>
				)}

				<Card padding="none">
					<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
							<tr>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Specialty</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Lives inside</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-24">People</th>
								{canEdit && <th className="w-32" />}
							</tr>
						</thead>
						<tbody>
							{positions.map((p) => {
								const link = linkLabel(p.tag_id);
								return (
									<tr key={p.slug} className={`border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors ${p.is_active ? '' : 'opacity-50'}`}>
										<td className="px-3 py-2">
											<span className="text-slate-900 dark:text-slate-100 font-medium">{p.label}</span>
											{!p.is_active && <Badge color="default" className="ml-2">inactive</Badge>}
										</td>
										<td className="px-3 py-2">
											<span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
												{link.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: link.color }} />}
												{link.text}
											</span>
										</td>
										<td className="px-3 py-2 text-2xs text-slate-600 dark:text-slate-400">
											<span className="inline-flex items-center gap-1">
												<Users className="w-3 h-3 text-slate-400" /> {peopleCount.get(p.slug) ?? 0}
											</span>
										</td>
										{canEdit && (
											<td className="px-3 py-2 text-right whitespace-nowrap">
												<Link
													href={`/admin/positions?edit=${encodeURIComponent(p.slug)}`}
													className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 underline-offset-2 hover:underline transition-colors mr-3"
												>
													Edit
												</Link>
												<form action={togglePapPositionActive} className="inline">
													<input type="hidden" name="slug" value={p.slug} />
													<button
														type="submit"
														className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 underline-offset-2 hover:underline transition-colors"
													>
														{p.is_active ? 'Deactivate' : 'Reactivate'}
													</button>
												</form>
											</td>
										)}
									</tr>
								);
							})}
						</tbody>
					</table>
					</div>
				</Card>

				{/* --- Positions (0033/0034) ---------------------------------------- */}
				{/* The PAP progression: Assistant → Analyst → Specialist → */}
				{/* Coordinator → Manager. Composed: {department} {position} {level} */}
				{/* → "Ops Coordinator II". Level 1 = most senior (III → II → I). */}
				<Card padding="none" id="tracks">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
						<div>
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Positions</h2>
							<p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">
								The PAP progression, not linked to departments. Composed on the profile as {'{department} {position} {level}'} → &quot;Ops Coordinator II&quot;.
								Level I/II/III is set on the profile — III is the entry step, I the most senior.
							</p>
						</div>
						{canEdit && (
							<Link href="/admin/positions?newTrack=1">
								<Button variant="outline">
									<Plus className="w-3.5 h-3.5" /> New position
								</Button>
							</Link>
						)}
					</div>

					{canEdit && (newTrack === '1' || editTrack) && (
						<ModalCard
							title={editTrack ? `Edit position · ${editTrack.label}` : 'New position'}
							subtitle="The PAP progression step. Level I/II/III is set on each profile."
							closeHref="/admin/positions"
							maxWidth="max-w-lg"
						>
							<form action={editTrack ? updatePositionTrack : createPositionTrack}>
								<div className="flex items-end gap-3 flex-wrap">
									{editTrack && <input type="hidden" name="slug" value={editTrack.slug} />}
									<Field
										label="Position name"
										hint={editTrack ? `Stable key: ${editTrack.slug} (renames change the label only)` : 'Assistant, Analyst, Specialist, Coordinator, Manager… The name becomes the stable key.'}
									>
										<input name="label" defaultValue={editTrack?.label ?? ''} placeholder="Specialist" className={inputClass} />
									</Field>
									<div className="flex items-center gap-2 pb-0.5">
										<Button type="submit">{editTrack ? 'Save changes' : 'Create position'}</Button>
									</div>
								</div>
							</form>
						</ModalCard>
					)}

					<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
							<tr>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Position</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-24">People</th>
								{canEdit && <th className="w-32" />}
							</tr>
						</thead>
						<tbody>
							{tracks.length === 0 && (
								<tr>
									<td colSpan={canEdit ? 3 : 2} className="px-3 py-4 text-center text-xs text-slate-500">
										No positions yet — ask Ops to finish setting this up.
									</td>
								</tr>
							)}
							{tracks.map((t) => (
								<tr key={t.slug} className={`border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors ${t.is_active ? '' : 'opacity-50'}`}>
									<td className="px-3 py-2">
										<span className="text-slate-900 dark:text-slate-100 font-medium">{t.label}</span>
										{!t.is_active && <Badge color="default" className="ml-2">inactive</Badge>}
									</td>
									<td className="px-3 py-2 text-2xs text-slate-600 dark:text-slate-400">
										<span className="inline-flex items-center gap-1">
											<Users className="w-3 h-3 text-slate-400" /> {trackPeopleCount.get(t.slug) ?? 0}
										</span>
									</td>
									{canEdit && (
										<td className="px-3 py-2 text-right whitespace-nowrap">
											<Link
												href={`/admin/positions?editTrack=${encodeURIComponent(t.slug)}`}
												className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 underline-offset-2 hover:underline transition-colors mr-3"
											>
												Edit
											</Link>
											<form action={togglePositionTrackActive} className="inline">
												<input type="hidden" name="slug" value={t.slug} />
												<button
													type="submit"
													className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 underline-offset-2 hover:underline transition-colors"
												>
													{t.is_active ? 'Deactivate' : 'Reactivate'}
												</button>
											</form>
										</td>
									)}
								</tr>
							))}
						</tbody>
					</table>
					</div>
				</Card>
			</div>
		</>
	);
}
