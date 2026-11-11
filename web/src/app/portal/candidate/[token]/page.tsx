// /portal/candidate/[token] — the lightweight candidate portal (0132, round
// 3: magic link, no password). Status timeline per application, upcoming
// interviews with the booking / join link, document upload (resume, ID,
// portfolio), and in H6 the offer + NDA signing. The raw token in the URL
// hashes to hire_portal_tokens.token_hash; 14-day expiry.

import type { Metadata } from 'next';
import { createHash } from 'node:crypto';
import { notFound } from 'next/navigation';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { INTERVIEW_KIND_LABELS, LOCATION_KIND_LABELS } from '@/lib/hiring/pipeline';
import { formatDate } from '@/lib/format';
import CareersShell from '@/app/careers/CareersShell';
import PortalUpload from './PortalUpload';
import PortalDisc from './PortalDisc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your application · Open Ronin', robots: { index: false } };

const STAGE_LABELS: Record<string, string> = { new: 'Application received', screening: 'In review', culture_fit: 'Culture fit interview', job_fit: 'Job fit interview', final: 'Final panel', offer: 'Offer', hired: 'Welcome aboard', rejected: 'Not moving forward', withdrawn: 'Withdrawn', pool: 'Talent pool' };
const ORDER = ['new', 'screening', 'culture_fit', 'job_fit', 'final', 'offer', 'hired'];

export default async function CandidatePortalPage({ params }: { params: Promise<{ token: string }> }) {
	const { token } = await params;
	if (!/^[0-9a-f]{48}$/.test(token)) notFound();
	const svc = createServiceRoleClient();
	const { data: resolved } = await svc.rpc('hire_portal_resolve', { p_token_hash: createHash('sha256').update(token).digest('hex') });
	const who = resolved as { candidate_id: string; full_name: string; email: string; purpose: string; expires_at: string } | null;
	if (!who) {
		return (
			<CareersShell headline="Link expired">
				<div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-700">This link has expired or was already replaced. Reply to your last email from us and we&apos;ll send a fresh one.</div>
			</CareersShell>
		);
	}
	const [{ data: apps }, { data: interviews }, { data: files }, { data: cand }, { data: discQ }] = await Promise.all([
		svc.from('hire_applications').select('id, status, stage_key, submitted_at, position:hire_positions!hire_applications_position_id_fkey(title, brand, status)').eq('candidate_id', who.candidate_id).order('submitted_at', { ascending: false }),
		svc.from('hire_interviews').select('id, application_id, kind, status, scheduled_at, duration_min, timezone, location_kind, location_text, booking_url').in('status', ['proposed', 'scheduled', 'rescheduled']).in('application_id', ((await svc.from('hire_applications').select('id').eq('candidate_id', who.candidate_id)).data ?? []).map((a: { id: string }) => a.id)).order('scheduled_at'),
		svc.from('hire_application_files').select('id, kind, original_name, created_at').eq('candidate_id', who.candidate_id).order('created_at', { ascending: false }),
		svc.from('hire_candidates').select('disc').eq('id', who.candidate_id).maybeSingle(),
		svc.from('hire_disc_questions').select('id, d_word, i_word, s_word, c_word').eq('is_active', true).order('id'),
	]);
	const discOnFile = (cand as { disc: { style?: string; scores?: Record<string, number> } | null } | null)?.disc ?? null;
	const discQuestions = (discQ ?? []) as { id: number; d_word: string; i_word: string; s_word: string; c_word: string }[];
	type App = { id: string; status: string; stage_key: string | null; submitted_at: string; position: { title: string; brand: string; status: string } | null };
	type Iv = { id: string; application_id: string; kind: keyof typeof INTERVIEW_KIND_LABELS; status: string; scheduled_at: string | null; duration_min: number; timezone: string | null; location_kind: keyof typeof LOCATION_KIND_LABELS; location_text: string | null; booking_url: string | null };
	const list = (apps ?? []) as unknown as App[];
	const ivs = (interviews ?? []) as Iv[];

	return (
		<CareersShell headline={`Hi ${who.full_name.split(' ')[0]}`}>
			<div className="space-y-4 max-w-2xl">
				<p className="text-sm text-slate-600">Your applications with Open Ronin. This page is yours alone; the link works for 14 days. Questions: reply to any email from careers@example.com.</p>
				{list.map((a) => {
					const idx = ORDER.indexOf(a.status);
					const mine = ivs.filter((i) => i.application_id === a.id);
					return (
						<div key={a.id} className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
							<div>
								<h2 className="text-base font-semibold text-slate-900">{a.position?.title ?? 'Role'}</h2>
								<div className="text-xs text-slate-500">Applied {formatDate(a.submitted_at)}</div>
							</div>
							<ol className="flex flex-wrap gap-1.5">
								{ORDER.filter((s) => s !== 'hired' || a.status === 'hired').map((s, i) => (
									<li key={s} className={`px-2 py-1 rounded-md text-2xs border ${s === a.status ? 'border-primary-600 bg-primary-700 text-white' : idx > i ? 'border-green-200 bg-green-50 text-green-800' : 'border-slate-200 text-slate-500'}`}>
										{STAGE_LABELS[s]}
									</li>
								))}
								{!ORDER.includes(a.status) && <li className="px-2 py-1 rounded-md text-2xs border border-slate-300 bg-slate-100 text-slate-700">{STAGE_LABELS[a.status] ?? a.status}</li>}
							</ol>
							{mine.length > 0 && (
								<div className="space-y-2">
									<h3 className="text-sm font-medium text-slate-800">Interviews</h3>
									{mine.map((i) => (
										<div key={i.id} className="rounded-md border border-slate-200 p-3 text-sm space-y-1">
											<div className="font-medium text-slate-900">{INTERVIEW_KIND_LABELS[i.kind]}</div>
											{i.scheduled_at ? (
												<div className="text-slate-700">
													{formatDate(i.scheduled_at, 'EEEE, MMM d · h:mm a')} {i.timezone ? `(${i.timezone})` : ''} · {i.duration_min} min · {LOCATION_KIND_LABELS[i.location_kind]}
												</div>
											) : (
												<div className="text-slate-600">Pick a time that works for you.</div>
											)}
											<div className="flex flex-wrap gap-2 pt-1">
												{!i.scheduled_at && i.booking_url && (
													<a href={i.booking_url} target="_blank" rel="noreferrer" className="rounded-md bg-primary-700 hover:bg-primary-800 text-white text-xs font-medium px-3 py-1.5">
														Book a time
													</a>
												)}
												{i.scheduled_at && i.location_text && /^https?:\/\//.test(i.location_text) && (
													<a href={i.location_text} target="_blank" rel="noreferrer" className="rounded-md bg-primary-700 hover:bg-primary-800 text-white text-xs font-medium px-3 py-1.5">
														Join the call
													</a>
												)}
												{i.scheduled_at && i.location_text && !/^https?:\/\//.test(i.location_text) && <span className="text-xs text-slate-600">{i.location_text}</span>}
												{i.scheduled_at && i.booking_url && (
													<a href={i.booking_url} target="_blank" rel="noreferrer" className="text-xs text-primary-700 underline self-center">
														Need to reschedule?
													</a>
												)}
											</div>
										</div>
									))}
								</div>
							)}
							{a.status === 'final' && <p className="text-xs text-slate-600">For the final panel, prepare a 5-10 minute talk on how you personally align with Open Ronin&apos;s core pillars: Transparency, Obsession, Leadership, Execution, Growth, Intentionality, Teamwork. Stories beat slides.</p>}
						</div>
					);
				})}
				<div className="rounded-lg border border-slate-200 bg-white p-5 space-y-2">
					<h2 className="text-sm font-semibold text-slate-900">Documents</h2>
					<ul className="text-xs text-slate-600">
						{((files ?? []) as { id: string; kind: string; original_name: string | null; created_at: string }[]).map((f) => (
							<li key={f.id}>
								{f.kind} · {f.original_name ?? 'file'} · {formatDate(f.created_at)}
							</li>
						))}
					</ul>
					<PortalUpload token={token} />
				</div>
				{discQuestions.length > 0 && (
					<div className="rounded-lg border border-slate-200 bg-white p-5 space-y-2">
						<h2 className="text-sm font-semibold text-slate-900">Work style questionnaire (DISC)</h2>
						<p className="text-xs text-slate-600">Optional but appreciated: 24 quick picks that tell us how you like to work, so your lead can set you up well from day one. It is not a test and there is no pass or fail.</p>
						<PortalDisc token={token} questions={discQuestions} existing={discOnFile?.style && discOnFile.scores ? { style: discOnFile.style, scores: discOnFile.scores } : null} />
					</div>
				)}
			</div>
		</CareersShell>
	);
}
