// /prospects/dashboards — the tracker replacements (0124, spec §11): Setter,
// Closer (2-call), Lead Gen & Marketing by channel, Exec funnel. Daily /
// weekly / monthly, per person or whole team, leaderboard. Numbers come
// from rev_daily_metrics() / rev_channel_metrics(); the sheet formulas live
// in lib/revenue/metrics.ts. "Today by rep" (2026-10-15) replaces My Day's
// "View as": one row per lane person, from rev_my_day + rev_daily_metrics.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Card from '@/components/ui/Card';
import FilterChipLink from '@/components/ui/FilterChipLink';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadChannelMetrics, loadConfig, loadDailyMetrics, loadLanes, loadMyDay, loadStaff } from '@/lib/revenue/server';
import { chicagoDay, closerDerived, execFunnel, fmtPct, rangeFor, setterDerived, sumBy } from '@/lib/revenue/metrics';
import { formatCents, LANE_LABELS, type Lane } from '@/lib/revenue/shared';
import { loadLastActivity, summarizeRep } from '@/lib/revenue/repToday';
import { pickTargets } from '@/lib/home/sales';
import { formatRelative } from '@/lib/format';
import NotAppliedCard from '../NotAppliedCard';

export const metadata = { title: 'Dashboards · Prospects' };
export const dynamic = 'force-dynamic';

type View = 'today' | 'setter' | 'closer' | 'channels' | 'exec';
type Period = 'day' | 'week' | 'month';

const th = 'text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2 whitespace-nowrap';
const td = 'px-3 py-1.5 tabular-nums text-right';

export default async function RevenueDashboards({ searchParams }: { searchParams: Promise<{ view?: string; period?: string; person?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const isManager = profile.role === 'admin' || profile.role === 'exec' || profile.role === 'manager';
	const view: View = sp.view === 'today' || sp.view === 'setter' || sp.view === 'closer' || sp.view === 'channels' || sp.view === 'exec' ? sp.view : isManager ? 'today' : 'setter';
	const period: Period = sp.period === 'week' || sp.period === 'month' ? sp.period : 'day';
	const today = chicagoDay();
	const { from, to } = rangeFor(period, today);
	const person = sp.person && /^[0-9a-f-]{36}$/i.test(sp.person) ? sp.person : undefined;
	const [rows, channel, lanes, staff, dbSize] = await Promise.all([
		loadDailyMetrics(supabase, from, to, person),
		view === 'channels' ? loadChannelMetrics(supabase, from, to) : Promise.resolve([]),
		loadLanes(supabase),
		loadStaff(supabase),
		supabase.from('rev_people').select('id', { count: 'exact', head: true }).then((r) => r.count ?? 0),
	]);
	const staffMap = Object.fromEntries(staff.map((s) => [s.id, s.name]));
	const lanePeople = (lane: string[]) => [...new Set(lanes.people.filter((p) => p.is_active && lane.includes(p.lane)).map((p) => p.user_id))];
	const href = (patch: Record<string, string | undefined>) => {
		const u = new URLSearchParams({ view, period, ...(person ? { person } : {}) });
		for (const [k, v] of Object.entries(patch)) v ? u.set(k, v) : u.delete(k);
		return `/prospects/dashboards?${u.toString()}`;
	};

	const totals = sumBy(rows);
	const people = view === 'setter' ? lanePeople(['setter', 'full_cycle']) : view === 'closer' ? lanePeople(['closer', 'full_cycle']) : lanePeople(['lead_gen', 'marketing']);
	const perPerson = people.map((uid) => ({ uid, name: staffMap[uid] ?? uid.slice(0, 8), t: sumBy(rows, (r) => r.user_id === uid) }));

	return (
		<>
			<PageHeader
				title="Revenue dashboards"
				description={`${from === to ? from : `${from} → ${to}`} · ${person ? staffMap[person] ?? 'one person' : 'whole team'} · replaces the Setter, 2-Call Close and CEO Metrics trackers`}
			/>
			<div className="flex flex-wrap items-center gap-2 mb-4">
				{(['today', 'setter', 'closer', 'channels', 'exec'] as View[]).map((v) => (
					<FilterChipLink key={v} href={href({ view: v })} active={view === v}>
						{v === 'today' ? 'Today by rep' : v === 'channels' ? 'Lead gen & marketing' : v === 'exec' ? 'Exec funnel' : v[0].toUpperCase() + v.slice(1)}
					</FilterChipLink>
				))}
				{view !== 'today' && (
				<>
				<span className="mx-2 text-slate-300">|</span>
				{(['day', 'week', 'month'] as Period[]).map((p) => (
					<FilterChipLink key={p} href={href({ period: p })} active={period === p}>
						{p === 'day' ? 'Today' : p === 'week' ? 'This week' : 'This month'}
					</FilterChipLink>
				))}
				<form action="/prospects/dashboards" className="ml-auto flex items-center gap-2">
					<input type="hidden" name="view" value={view} />
					<input type="hidden" name="period" value={period} />
					<select name="person" defaultValue={person ?? ''} className="text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5" aria-label="Person">
						<option value="">Whole team</option>
						{staff.map((s) => (
							<option key={s.id} value={s.id}>
								{s.name}
							</option>
						))}
					</select>
					<button type="submit" className="text-xs text-primary-700 dark:text-primary-300 underline">
						Filter
					</button>
				</form>
				</>
				)}
			</div>

			{view === 'today' && <TodayByRep supabase={supabase} lanes={lanes} staffMap={staffMap} />}
			{view === 'setter' && <SetterView totals={totals} perPerson={perPerson} />}
			{view === 'closer' && <CloserView totals={totals} perPerson={perPerson} />}
			{view === 'channels' && <ChannelsView rows={channel} perPerson={perPerson} />}
			{view === 'exec' && <ExecView totals={totals} dbSize={dbSize} />}
		</>
	);
}

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
	return (
		<Card padding="sm">
			<div className="text-2xs uppercase tracking-wide text-slate-500">{label}</div>
			<div className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
			{sub && <div className="text-2xs text-slate-500">{sub}</div>}
		</Card>
	);
}

function SetterView({ totals, perPerson }: { totals: Record<string, number>; perPerson: { uid: string; name: string; t: Record<string, number> }[] }) {
	const s = setterDerived(totals);
	const cols: [string, (d: ReturnType<typeof setterDerived>) => string | number][] = [
		['Leads', (d) => d.leads_assigned],
		['Dials', (d) => d.dials],
		['Answers', (d) => d.answers],
		['Convos', (d) => d.conversations],
		['Convo %', (d) => fmtPct(d.conversation_pct)],
		['Sets', (d) => d.sets],
		['Convo→Set', (d) => fmtPct(d.convo_to_set_pct)],
		['Live calls', (d) => d.live_calls],
		['Offered', (d) => d.offered],
		['Closed', (d) => d.closed],
		['Show %', (d) => fmtPct(d.show_pct)],
		['Offer %', (d) => fmtPct(d.offer_pct)],
		['Set→Close', (d) => fmtPct(d.set_to_close_pct)],
		['FE cash', (d) => formatCents(d.fe_cash * 100)],
	];
	return (
		<div className="space-y-4">
			<div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
				<Tile label="Dials" value={s.dials} />
				<Tile label="Conversations" value={s.conversations} sub={`${fmtPct(s.conversation_pct)} of dials`} />
				<Tile label="Sets" value={s.sets} sub={`${fmtPct(s.convo_to_set_pct)} of convos`} />
				<Tile label="Shows" value={s.live_calls} sub={`${fmtPct(s.show_pct)} show rate`} />
				<Tile label="Closed" value={s.closed} sub={`${fmtPct(s.set_to_close_pct)} set→close`} />
				<Tile label="FE cash" value={formatCents(s.fe_cash * 100)} />
			</div>
			<Leaderboard title="Setters" cols={cols} rows={perPerson.map((p) => ({ name: p.name, d: setterDerived(p.t), sort: p.t.sets ?? 0 }))} />
		</div>
	);
}

function CloserView({ totals, perPerson }: { totals: Record<string, number>; perPerson: { uid: string; name: string; t: Record<string, number> }[] }) {
	const c = closerDerived(totals);
	const cols: [string, (d: ReturnType<typeof closerDerived>) => string | number][] = [
		['Disc. booked', (d) => d.discovery_booked],
		['Disc. taken', (d) => d.discovery_taken],
		['Sales booked', (d) => d.sales_booked],
		['Sales taken', (d) => d.sales_taken],
		['Call 1 show', (d) => fmtPct(d.call1_show_pct)],
		['Call 2 sched', (d) => fmtPct(d.call2_sched_pct)],
		['Call 2 show', (d) => fmtPct(d.call2_show_pct)],
		['Offers', (d) => d.offers],
		['Signed', (d) => d.agreements_signed],
		['Offer %', (d) => fmtPct(d.offer_pct)],
		['Offer commit', (d) => fmtPct(d.offer_commit_pct)],
		['Close %', (d) => fmtPct(d.close_pct)],
		['Cash', (d) => formatCents(d.cash_collected * 100)],
		['MRR sold', (d) => formatCents(d.mrr_sold * 100)],
	];
	return (
		<div className="space-y-4">
			<div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
				<Tile label="Discovery taken" value={c.discovery_taken} sub={`${fmtPct(c.call1_show_pct)} call-1 show`} />
				<Tile label="Sales calls taken" value={c.sales_taken} sub={`${fmtPct(c.call2_show_pct)} call-2 show`} />
				<Tile label="Offers" value={c.offers} sub={`${fmtPct(c.offer_pct)} offer rate`} />
				<Tile label="Signed" value={c.agreements_signed} sub={`${fmtPct(c.offer_commit_pct)} offer→commit`} />
				<Tile label="Cash collected" value={formatCents(c.cash_collected * 100)} />
				<Tile label="MRR sold" value={formatCents(c.mrr_sold * 100)} />
			</div>
			<Leaderboard title="Closers" cols={cols} rows={perPerson.map((p) => ({ name: p.name, d: closerDerived(p.t), sort: p.t.won ?? 0 }))} />
		</div>
	);
}

function ChannelsView({ rows, perPerson }: { rows: { channel: string; source: string; metric: string; value: number }[]; perPerson: { uid: string; name: string; t: Record<string, number> }[] }) {
	const byChannel = new Map<string, Record<string, number>>();
	for (const r of rows) {
		const t = byChannel.get(r.channel) ?? {};
		t[r.metric] = (t[r.metric] ?? 0) + r.value;
		byChannel.set(r.channel, t);
	}
	const order = ['sent', 'replies', 'positive_replies', 'booked', 'shown', 'new_leads'];
	return (
		<div className="space-y-4">
			<Card padding="none" className="overflow-hidden">
				<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-slate-100">By channel</div>
				<table className="w-full text-xs">
					<thead>
						<tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
							<th className={th}>Channel</th>
							{order.map((m) => (
								<th key={m} className={`${th} text-right`}>
									{m.replace('_', ' ')}
								</th>
							))}
							<th className={`${th} text-right`}>Reply %</th>
							<th className={`${th} text-right`}>Positive %</th>
						</tr>
					</thead>
					<tbody>
						{[...byChannel.entries()].map(([ch, t]) => (
							<tr key={ch} className="border-b border-slate-100 dark:border-slate-700/60">
								<td className="px-3 py-1.5 font-medium text-slate-900 dark:text-slate-100">{ch}</td>
								{order.map((m) => (
									<td key={m} className={td}>
										{t[m] ?? 0}
									</td>
								))}
								<td className={td}>{fmtPct(t.sent ? Math.round(((t.replies ?? 0) / t.sent) * 1000) / 10 : null)}</td>
								<td className={td}>{fmtPct(t.replies ? Math.round(((t.positive_replies ?? 0) / t.replies) * 1000) / 10 : null)}</td>
							</tr>
						))}
						{byChannel.size === 0 && (
							<tr>
								<td colSpan={9} className="px-3 py-6 text-slate-500">
									No outreach logged in this period. Cost per lead / cost per call shown appear once ad spend (Meta / Google) is connected.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</Card>
			<Leaderboard
				title="Lead gen & marketing"
				cols={[
					['Sends', (d) => d.sends ?? 0],
					['DMs', (d) => d.dms ?? 0],
					['Emails', (d) => d.emails_sent ?? 0],
					['Replies', (d) => d.replies ?? 0],
					['Positive', (d) => d.positive_replies ?? 0],
					['Hand-offs', (d) => d.handoffs ?? 0],
					['New leads', (d) => d.new_leads ?? 0],
				]}
				rows={perPerson.map((p) => ({ name: p.name, d: p.t, sort: p.t.positive_replies ?? 0 }))}
			/>
		</div>
	);
}

function ExecView({ totals, dbSize }: { totals: Record<string, number>; dbSize: number }) {
	const f = execFunnel(totals, dbSize);
	return (
		<div className="space-y-4">
			<div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
				<Tile label="New leads" value={f.new_leads} />
				<Tile label="Database" value={f.database_size} sub="people in the engine" />
				<Tile label="First calls" value={`${f.first_calls_shown} / ${f.first_calls_booked}`} sub="shown / booked" />
				<Tile label="Second calls" value={`${f.secondary_calls_shown} / ${f.secondary_calls_booked}`} sub="shown / booked" />
				<Tile label="Offers" value={f.offers} />
				<Tile label="Units sold" value={f.units_sold} />
				<Tile label="MRR added" value={formatCents(f.mrr_added * 100)} />
				<Tile label="Total sales" value={formatCents(f.total_sales * 100)} />
				<Tile label="Leads → first call" value={fmtPct(f.leads_to_first_pct)} />
				<Tile label="First → sales call" value={fmtPct(f.first_to_sales_pct)} />
				<Tile label="Sales call → client" value={fmtPct(f.sales_to_client_pct)} />
			</div>
			<p className="text-2xs text-slate-500">Units by product (Open Ronin / Beacon / upsell) and ad spend land with P6 (contracts) and the ads connectors.</p>
		</div>
	);
}

function Leaderboard<D>({ title, cols, rows }: { title: string; cols: [string, (d: D) => string | number][]; rows: { name: string; d: D; sort: number }[] }) {
	const sorted = [...rows].sort((a, b) => b.sort - a.sort);
	return (
		<Card padding="none" className="overflow-hidden">
			<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-slate-100">{title} · leaderboard</div>
			<div className="overflow-x-auto">
				<table className="w-full text-xs">
					<thead>
						<tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
							<th className={th}>#</th>
							<th className={th}>Name</th>
							{cols.map(([label]) => (
								<th key={label} className={`${th} text-right`}>
									{label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{sorted.map((r, i) => (
							<tr key={r.name} className="border-b border-slate-100 dark:border-slate-700/60">
								<td className="px-3 py-1.5 text-slate-400 tabular-nums">{i + 1}</td>
								<td className="px-3 py-1.5 font-medium text-slate-900 dark:text-slate-100">{r.name}</td>
								{cols.map(([label, fn]) => (
									<td key={label} className={td}>
										{fn(r.d)}
									</td>
								))}
							</tr>
						))}
						{sorted.length === 0 && (
							<tr>
								<td colSpan={cols.length + 2} className="px-3 py-6 text-slate-500">
									Nobody is assigned to this lane yet (Admin → Prospects → Team).
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</Card>
	);
}

async function TodayByRep({ supabase, lanes, staffMap }: { supabase: Awaited<ReturnType<typeof createClient>>; lanes: Awaited<ReturnType<typeof loadLanes>>; staffMap: Record<string, string> }) {
	const byUser = new Map<string, string[]>();
	for (const p of lanes.people) if (p.is_active) byUser.set(p.user_id, [...(byUser.get(p.user_id) ?? []), p.lane]);
	const users = [...byUser.keys()];
	const today = chicagoDay();
	const week = rangeFor('week', today);
	const goal = lanes.rules.find((r) => r.key === 'speed_to_lead_goal')?.value ?? 5;
	const now = new Date();
	const [queues, dayRows, weekRows, last] = await Promise.all([
		// Marketing owns no deals; skip its queue read.
		Promise.all(users.map((u) => ((byUser.get(u) ?? []).every((l) => l === 'marketing') ? Promise.resolve(null) : loadMyDay(supabase, u, 500)))),
		loadDailyMetrics(supabase, today, today),
		loadDailyMetrics(supabase, week.from, week.to),
		loadLastActivity(supabase, users),
	]);
	const late = 'font-semibold text-red-600 dark:text-red-400';

	if (users.length === 0) return <Card><p className="text-sm text-slate-500">No one is assigned to a lane yet.</p></Card>;
	return (
		<Card padding="none" className="overflow-x-auto">
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b border-slate-200 dark:border-slate-700">
						<th className={th}>Rep</th>
						<th className={th}>Lane</th>
						<th className={`${th} text-right`}>Queue</th>
						<th className={`${th} text-right`}>New &gt; {goal} min</th>
						<th className={`${th} text-right`}>Overdue</th>
						<th className={`${th} text-right`}>No next action</th>
						<th className={th}>Today&apos;s targets</th>
						<th className={th}>Last activity</th>
					</tr>
				</thead>
				<tbody>
					{users.map((u, i) => {
						const q = queues[i];
						const s = q ? summarizeRep(q, now, goal) : null;
						const userLanes = byUser.get(u) ?? [];
						const tiles = pickTargets(lanes.targets, userLanes, u, sumBy(dayRows, (r) => r.user_id === u), sumBy(weekRows, (r) => r.user_id === u), 2);
						const la = last.get(u);
						return (
							<tr key={u} className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
								<td className="px-3 py-2 font-semibold whitespace-nowrap">
									<Link href={`/prospects?view=table&owner=${u}`} className="hover:underline">{staffMap[u] ?? 'Unknown'}</Link>
								</td>
								<td className="px-3 py-2 whitespace-nowrap">{userLanes.map((l) => LANE_LABELS[l as Lane] ?? l).join(' + ')}</td>
								<td className={td}>{s ? s.queue : '—'}</td>
								<td className={`${td} ${s?.slowNew ? late : ''}`}>{s ? s.slowNew : '—'}</td>
								<td className={`${td} ${s?.overdue ? late : ''}`}>{s ? s.overdue : '—'}</td>
								<td className={td}>{s ? s.noNext : '—'}</td>
								<td className="px-3 py-2">
									<span className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
										{tiles.map((t) => (
											<span key={t.key} className="tabular-nums whitespace-nowrap">{t.label}{t.period === 'week' ? ' (wk)' : ''} <b>{t.done}</b>/{t.target}</span>
										))}
										{tiles.length === 0 && '—'}
									</span>
								</td>
								<td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">{la ? `${formatRelative(la.occurred_at)} · ${la.kind}` : '—'}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</Card>
	);
}
