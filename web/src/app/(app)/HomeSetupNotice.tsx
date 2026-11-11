// Home setup notice — "o que falta preencher" (Sam, 19/08/2026).
//
// Honest and actionable, which here means SPLIT BY WHO CAN ACT: position,
// department, manager and specialty are people-manager-only fields (the
// protect_profile_structure trigger rejects anyone else), so telling a
// contributor to "complete your profile" for those would be a dead end — the
// exact thing the QA sweep was meant to kill. Those appear as "ask your
// people-manager" unless the viewer IS one, in which case they get the link.
//
// SCOPE, since the Radar shipped (2026-08-25): this card is now PROFILE GAPS
// ONLY. The metrics-still-blank and check-in-not-submitted bullets moved into
// the Radar, which is the one feed for "what needs you" — keeping them here as
// well would have made Home state the same fact twice, three inches apart.
// Their computation lives in web/src/lib/home/signals.ts.

import Link from 'next/link';
import Card from '@/components/ui/Card';
import { AlertTriangle, UserCog, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';

interface ProfileLite {
	id: string;
	department: string | null;
	department_tag_id: string | null;
	position_track: string | null;
	position_level: number | null;
	manager_id: string | null;
	pap_position: string | null;
	photo_url: string | null;
	avatar_url: string | null;
	bio_md: string | null;
}

export default async function HomeSetupNotice({ viewerId }: { viewerId: string }) {
	const supabase = await createClient();
	const ctx = await loadSensitiveAccessContext();
	const isPeopleManager = canManagePeople(ctx);

	const { data: profileRaw } = await supabase
		.from('profiles')
		.select(
			'id, department, department_tag_id, position_track, position_level, manager_id, pap_position, photo_url, avatar_url, bio_md',
		)
		.eq('id', viewerId)
		.maybeSingle();
	const profile = profileRaw as ProfileLite | null;
	if (!profile) return null;

	// ----- structure (people-manager territory) -------------------------------
	const structureGaps: string[] = [];
	if (!profile.department_tag_id && !profile.department) structureGaps.push('department');
	if (!profile.position_track) structureGaps.push('position');
	if (profile.position_level == null) structureGaps.push('level');
	if (!profile.manager_id) structureGaps.push('manager');
	if (!profile.pap_position) structureGaps.push('specialty');

	// ----- self-serve profile fields ------------------------------------------
	const selfGaps: string[] = [];
	if (!profile.photo_url && !profile.avatar_url) selfGaps.push('a photo');
	if (!profile.bio_md) selfGaps.push('a short bio');

	if (structureGaps.length === 0 && selfGaps.length === 0) return null;

	return (
		<Card className="mb-4 border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/10">
			<div className="flex items-start gap-2">
				<AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
				<div className="min-w-0 flex-1">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
						Your profile is incomplete
					</h2>
					<ul className="mt-2 space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
						{selfGaps.length > 0 && (
							<li className="flex items-start gap-1.5">
								<Sparkles className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
								<span>
									Your profile is missing {selfGaps.join(' and ')} — the team sees this in the
									Directory.{' '}
									<Link href={`/team/${viewerId}/edit`} className="text-primary-600 hover:underline">
										Add it
									</Link>
									.
								</span>
							</li>
						)}
						{structureGaps.length > 0 && (
							<li className="flex items-start gap-1.5">
								<UserCog className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
								<span>
									{isPeopleManager ? (
										<>
											Your own {structureGaps.join(', ')} {structureGaps.length === 1 ? 'is' : 'are'}{' '}
											not set.{' '}
											<Link
												href={`/team/${viewerId}/edit`}
												className="text-primary-600 hover:underline"
											>
												Set {structureGaps.length === 1 ? 'it' : 'them'}
											</Link>{' '}
											— the org chart, metrics and PAP all read these.
										</>
									) : (
										<>
											A people-manager still needs to set your {structureGaps.join(', ')}. Until
											then your metrics set and the org chart stay incomplete — worth a nudge at
											your next 1:1.
										</>
									)}
								</span>
							</li>
						)}
					</ul>
				</div>
			</div>
		</Card>
	);
}
