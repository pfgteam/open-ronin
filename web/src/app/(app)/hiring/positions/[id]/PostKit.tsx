'use client';

// Post kit (0129, round 3): per-board tracked apply link + AI/template text
// with copy + open, posted / live URL checklist, cost, repost/expiry; my
// referral link; custom tracked links with hit counts.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import { POSTING_STATUS_COLORS, POSTING_STATUS_LABELS, applyUrl, type BoardRow, type LinkRow, type PostingRow } from '@/lib/hiring/careers';
import { formatDate, formatRelative } from '@/lib/format';
import { addCustomLink, buildPostKit, myReferralLink, updatePosting } from '../../actions';

export default function PostKit({ positionId, slug, status, boards, postings, links, canEdit, appUrl, aiReady, names }: { positionId: string; slug: string; status: string; boards: BoardRow[]; postings: PostingRow[]; links: LinkRow[]; canEdit: boolean; appUrl: string; aiReady: boolean; names: Record<string, string> }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [picked, setPicked] = useState<Set<string>>(new Set(boards.filter((b) => b.enabled && b.kind !== 'adapter').map((b) => b.key)));
	const [useAi, setUseAi] = useState(aiReady);
	const [ref, setRef] = useState<string | null>(null);
	const name = (id: string | null) => (id ? names[id] ?? '' : '');
	const postable = ['approved', 'open', 'paused'].includes(status);
	const byBoard = new Map(postings.map((p) => [p.board_key, p]));
	const linkFor = (boardKey: string) => links.find((l) => l.board_key === boardKey && !l.referrer_user_id)?.code ?? null;

	const build = () =>
		start(async () => {
			setMsg(null);
			const r = await buildPostKit({ position_id: positionId, boards: [...picked], use_ai: useAi });
			setMsg(r.ok ? { ok: true, text: `Built ${r.built} board${r.built === 1 ? '' : 's'}${r.by.length ? ` · ${r.by.join(', ')}` : ''}.` } : { ok: false, text: r.error });
			router.refresh();
		});
	const copy = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setMsg({ ok: true, text: 'Copied.' });
		} catch {
			setMsg({ ok: false, text: 'Clipboard blocked; select and copy manually.' });
		}
	};
	const referral = () =>
		start(async () => {
			const r = await myReferralLink({ position_id: positionId });
			if (!r.ok) return setMsg({ ok: false, text: r.error });
			setRef(r.url);
			router.refresh();
		});
	const post = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await updatePosting(fd);
			setMsg(r.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: r.error });
			router.refresh();
		});
	const addLink = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await addCustomLink(fd);
			setMsg(r.ok ? { ok: true, text: 'Link added.' } : { ok: false, text: r.error });
			router.refresh();
		});

	return (
		<div className="space-y-4">
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
			{!postable && <Callout tone="warning">Posting is the first budget step: the post kit unlocks once Alex approves the position request.</Callout>}
			<Card className="space-y-3">
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Boards</h2>
					<span className="text-2xs text-slate-500">Auto boards publish themselves while the role is open; manual boards get a tracked link + formatted text to copy and post. Paid distribution adapter is off (round 3). No ZipRecruiter.</span>
				</div>
				<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
					{boards.filter((b) => b.kind !== 'adapter' || b.enabled).map((b) => (
						<label key={b.key} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${picked.has(b.key) ? 'border-primary-400 bg-primary-50/50 dark:bg-primary-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
							<Checkbox checked={picked.has(b.key)} disabled={!canEdit || !b.enabled} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(b.key); else n.delete(b.key); setPicked(n); }} />
							<span className="min-w-0">
								<span className="block text-slate-900 dark:text-slate-100">{b.label}</span>
								<span className="block text-2xs text-slate-500">
									{b.kind} · {b.cost_note ?? ''} · {b.regions.join(', ')}
									{byBoard.get(b.key) && <> · <Badge color={POSTING_STATUS_COLORS[byBoard.get(b.key)!.status]}>{POSTING_STATUS_LABELS[byBoard.get(b.key)!.status]}</Badge></>}
								</span>
							</span>
						</label>
					))}
				</div>
				{canEdit && (
					<div className="flex flex-wrap items-center gap-3">
						<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
							<Checkbox checked={useAi} onChange={(e) => setUseAi(e.target.checked)} disabled={!aiReady} /> AI-format per board{!aiReady && <span className="text-2xs text-slate-500">(no text provider key; template text used)</span>}
						</label>
						<Button size="sm" onClick={build} loading={pending} disabled={!postable || picked.size === 0}>
							{postings.length ? 'Rebuild post kit' : 'Build post kit'}
						</Button>
					</div>
				)}
			</Card>

			{postings.map((p) => {
				const board = boards.find((b) => b.key === p.board_key);
				const code = linkFor(p.board_key);
				const link = code ? applyUrl(appUrl, slug, code) : null;
				const hits = links.find((l) => l.code === code)?.hits ?? 0;
				return (
					<Card key={p.id} className="space-y-3">
						<div className="flex flex-wrap items-center gap-2">
							<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{board?.label ?? p.board_key}</h3>
							<Badge color={POSTING_STATUS_COLORS[p.status]}>{POSTING_STATUS_LABELS[p.status]}</Badge>
							{p.formatted_by && <span className="text-2xs text-slate-500">text: {p.formatted_by}</span>}
							{p.posted_at && <span className="text-2xs text-slate-500">posted {formatDate(p.posted_at)}</span>}
							{p.expires_at && <span className={`text-2xs ${new Date(p.expires_at).getTime() < Date.now() + 5 * 86400000 ? 'text-amber-600' : 'text-slate-500'}`}>expires {formatDate(p.expires_at)}</span>}
							<span className="text-2xs text-slate-500 ml-auto">{hits} click{hits === 1 ? '' : 's'}</span>
						</div>
						{link && (
							<div className="flex flex-wrap items-center gap-2 text-xs">
								<code className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 text-slate-700 dark:text-slate-300">{link}</code>
								<Button size="sm" variant="ghost" onClick={() => copy(link)}>
									Copy link
								</Button>
								{board?.post_url && board.kind === 'manual' && (
									<a href={board.post_url} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
										Open {board.label.split(' ')[0]} →
									</a>
								)}
								{p.live_url && (
									<a href={p.live_url} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
										Live post →
									</a>
								)}
							</div>
						)}
						{board?.kind === 'manual' && (
							<form action={post} className="space-y-2">
								<input type="hidden" name="id" value={p.id} />
								<input type="hidden" name="position_id" value={positionId} />
								<Textarea name="formatted_text" rows={10} defaultValue={p.formatted_text ?? ''} className="font-mono text-xs" disabled={!canEdit} />
								<div className="flex flex-wrap items-end gap-2">
									<Button type="button" size="sm" variant="outline" onClick={() => copy(p.formatted_text ?? '')}>
										Copy text
									</Button>
									{canEdit && (
										<>
											<Input name="live_url" label="Live URL (after posting)" defaultValue={p.live_url ?? ''} placeholder="https://…" className="w-72" />
											<Input name="cost_usd" label="Cost (USD)" type="number" min={0} step={1} defaultValue={p.cost_cents != null ? p.cost_cents / 100 : ''} className="w-28" />
											<Button type="submit" size="sm" variant="outline" loading={pending}>
												Save text + URL
											</Button>
											{p.status === 'planned' && (
												<Button type="submit" name="status" value="posted" size="sm" loading={pending}>
													Mark posted
												</Button>
											)}
											{p.status === 'posted' && (
												<Button type="submit" name="status" value="live" size="sm" loading={pending}>
													Confirm live
												</Button>
											)}
											{(p.status === 'posted' || p.status === 'live' || p.status === 'expired') && (
												<Button type="submit" name="status" value="closed" size="sm" variant="ghost" loading={pending}>
													Taken down
												</Button>
											)}
											{(p.status === 'expired' || p.status === 'closed') && postable && (
												<Button type="submit" name="status" value="posted" size="sm" variant="ghost" loading={pending}>
													Reposted
												</Button>
											)}
										</>
									)}
								</div>
							</form>
						)}
						{board?.kind === 'auto' && <p className="text-xs text-slate-500">{p.board_key === 'careers' ? 'Published on the careers page while the role is open.' : p.board_key === 'google_jobs' ? 'JobPosting JSON-LD is on the role page; Google indexes it from the careers page.' : 'In the XML feed; submit the feed URL once per aggregator (Jooble, Adzuna, Talent.com, Careerjet).'}</p>}
					</Card>
				);
			})}

			<Card className="space-y-3">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Tracked links</h2>
				<div className="flex flex-wrap items-center gap-2">
					<Button size="sm" variant="outline" onClick={referral} loading={pending}>
						My referral link for this role
					</Button>
					{ref && (
						<>
							<code className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 text-xs text-slate-700 dark:text-slate-300">{ref}</code>
							<Button size="sm" variant="ghost" onClick={() => copy(ref)}>
								Copy
							</Button>
						</>
					)}
				</div>
				<table className="w-full text-xs">
					<thead className="text-left text-2xs uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:border-slate-700">
						<tr>
							<th className="py-1 pr-3">Code</th>
							<th className="py-1 pr-3">Source</th>
							<th className="py-1 pr-3">Referrer</th>
							<th className="py-1 pr-3">Clicks</th>
							<th className="py-1 pr-3">Last</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
						{links.length === 0 && (
							<tr>
								<td colSpan={5} className="py-3 text-slate-500">
									No links yet. Build the post kit or create a custom one.
								</td>
							</tr>
						)}
						{links.map((l) => (
							<tr key={l.code}>
								<td className="py-1 pr-3 font-mono text-slate-700 dark:text-slate-300">
									<button type="button" className="hover:underline" onClick={() => copy(applyUrl(appUrl, slug, l.code))}>
										{l.code}
									</button>
								</td>
								<td className="py-1 pr-3 text-slate-600 dark:text-slate-400">{l.source}</td>
								<td className="py-1 pr-3 text-slate-600 dark:text-slate-400">{name(l.referrer_user_id) || '—'}</td>
								<td className="py-1 pr-3 tabular-nums text-slate-700 dark:text-slate-300">{l.hits}</td>
								<td className="py-1 pr-3 text-slate-500">{l.last_hit_at ? formatRelative(l.last_hit_at) : '—'}</td>
							</tr>
						))}
					</tbody>
				</table>
				{canEdit && (
					<form action={addLink} className="flex flex-wrap items-end gap-2">
						<input type="hidden" name="position_id" value={positionId} />
						<Input name="code" label="Custom code" placeholder={`${slug.slice(0, 20)}-newsletter`} pattern="[a-z0-9][a-z0-9-]{3,40}" required className="w-60" />
						<Input name="source" label="Source" placeholder="newsletter / slack / event" required className="w-44" />
						<Input name="label" label="Label" className="w-52" />
						<Button type="submit" size="sm" variant="outline" loading={pending}>
							Add link
						</Button>
					</form>
				)}
			</Card>
		</div>
	);
}
