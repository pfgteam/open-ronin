'use client';

// Studio board / week calendar over fw_studio_items (F4b).

import Link from 'next/link';
import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import type { ChannelRow, StudioItem } from '@/lib/flywheel/shared';
import ActionForm from '../ActionForm';
import { scheduleAsset } from '../productionActions';

const COLUMNS: { key: string; label: string; match: (s: string) => boolean }[] = [
	{ key: 'planned', label: 'Planned', match: (s) => ['planned', 'drafting', 'script_ready'].includes(s) },
	{ key: 'review', label: 'In review / verification', match: (s) => ['in_review', 'verification', 'awaiting_client', 'changes_requested'].includes(s) },
	{ key: 'approved', label: 'Approved / scheduled', match: (s) => ['approved', 'queued', 'handed_off', 'scheduled', 'recorded', 'edited'].includes(s) },
	{ key: 'live', label: 'Published / live', match: (s) => ['live', 'posted', 'published'].includes(s) },
];

function hrefOf(i: StudioItem): string {
	if (i.item_kind === 'page') return `/flywheel/${i.program_id}/pages/${i.item_id}`;
	if (i.item_kind === 'video') return `/flywheel/${i.program_id}/videos/${i.item_id}`;
	return `/flywheel/${i.program_id}?tab=clusters`;
}

export default function StudioBoard({ items, people, view, weekStart, channels }: { items: StudioItem[]; people: { id: string; name: string }[]; view: 'week' | 'board'; weekStart: string; channels: ChannelRow[] }) {
	const [open, setOpen] = useState<string | null>(null);
	const chLabel = (k: string | null) => channels.find((c) => c.key === k)?.label ?? k ?? '';
	const card = (i: StudioItem) => {
		const key = `${i.item_kind}:${i.item_id}`;
		const late = i.due_at && !['live', 'posted', 'published'].includes(i.status) && new Date(i.due_at) < new Date();
		return (
			<li key={key} className="rounded-md border border-slate-200 dark:border-slate-700 p-2 text-xs bg-white dark:bg-slate-800">
				<button type="button" className="w-full text-left" onClick={() => setOpen(open === key ? null : key)}>
					<div className="flex items-center justify-between gap-1">
						<span className="font-medium text-slate-900 dark:text-slate-100 truncate">{i.title}</span>
						<Badge color={i.item_kind === 'page' ? 'primary' : i.item_kind === 'video' ? 'accent' : 'default'}>{i.item_kind === 'citation' ? chLabel(i.channel_key) : i.item_kind}</Badge>
					</div>
					<div className="text-2xs text-slate-500">
						{i.client_name}
						{i.cluster_number ? ` · C${i.cluster_number}` : ''}
						{i.page_number ? ` · p${i.page_number}` : ''} · {i.status}
						{i.humanized ? ' · humanized' : ''}
						{i.scheduled_for ? ` · ${i.scheduled_for.slice(0, 10)}` : ''}
						{late ? <span className="text-red-600 dark:text-red-400"> · past 72 h</span> : ''}
					</div>
					{i.keyword && <div className="text-2xs text-slate-600 dark:text-slate-400 truncate">“{i.keyword}”</div>}
				</button>
				{open === key && (
					<ActionForm action={scheduleAsset} success="Saved." className="mt-2 space-y-1.5">
						<input type="hidden" name="kind" value={i.item_kind} />
						<input type="hidden" name="id" value={i.item_id} />
						<input type="hidden" name="program_id" value={i.program_id} />
						<Input name="scheduled_for" type="datetime-local" defaultValue={i.scheduled_for ? i.scheduled_for.slice(0, 16) : ''} />
						{i.item_kind !== 'video' && (
							<>
								<Input name="keyword" placeholder="Keyword for this piece" defaultValue={i.keyword ?? ''} />
								<Select name="assignee_id" size="sm" defaultValue={i.assignee_id ?? ''}>
									<option value="">Unassigned</option>
									{people.map((p) => (
										<option key={p.id} value={p.id}>
											{p.name}
										</option>
									))}
								</Select>
							</>
						)}
						<Input name="publish_url" placeholder={i.item_kind === 'video' ? 'YouTube URL' : 'Live URL (to publish)'} defaultValue={i.live_url ?? ''} />
						<div className="flex flex-wrap gap-1">
							<Button type="submit" size="sm" variant="outline">
								Save
							</Button>
							{!['live', 'posted', 'published'].includes(i.status) && (
								<Button type="submit" name="mark_published" value="on" size="sm">
									Mark {i.item_kind === 'page' ? 'live' : i.item_kind === 'citation' ? 'posted' : 'published'}
								</Button>
							)}
							<Link href={hrefOf(i)} className="text-primary-600 hover:underline self-center">
								open
							</Link>
						</div>
					</ActionForm>
				)}
			</li>
		);
	};
	if (view === 'board') {
		return (
			<div className="grid gap-3 md:grid-cols-4">
				{COLUMNS.map((c) => {
					const list = items.filter((i) => c.match(i.status));
					return (
						<Card key={c.key} padding="md">
							<h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
								{c.label} <span className="text-slate-400">({list.length})</span>
							</h2>
							<ul className="space-y-2">{list.slice(0, 80).map(card)}</ul>
						</Card>
					);
				})}
			</div>
		);
	}
	const days = Array.from({ length: 7 }, (_, k) => new Date(new Date(weekStart + 'T00:00:00Z').getTime() + k * 86_400_000).toISOString().slice(0, 10));
	const dateOf = (i: StudioItem) => (i.scheduled_for ?? i.published_at ?? i.due_at ?? i.updated_at).slice(0, 10);
	const unscheduled = items.filter((i) => !i.scheduled_for && !i.published_at);
	return (
		<div className="space-y-4">
			<div className="grid gap-2 md:grid-cols-7">
				{days.map((d) => {
					const list = items.filter((i) => (i.scheduled_for || i.published_at) && dateOf(i) === d);
					return (
						<Card key={d} padding="md">
							<h2 className="text-2xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
								{new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} <span className="text-slate-400">({list.length})</span>
							</h2>
							<ul className="space-y-2">{list.map(card)}</ul>
						</Card>
					);
				})}
			</div>
			{unscheduled.length > 0 && (
				<Card>
					<h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Unscheduled this week&apos;s pool ({unscheduled.length})</h2>
					<ul className="grid gap-2 md:grid-cols-3 lg:grid-cols-4">{unscheduled.slice(0, 60).map(card)}</ul>
				</Card>
			)}
		</div>
	);
}
