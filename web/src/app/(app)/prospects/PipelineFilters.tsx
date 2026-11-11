'use client';

// The one filter bar for /prospects (board + table): pipeline, stage, owner,
// source, status and search, all written to the URL (spec §4.2). Selects
// apply on change; search is debounced 300 ms. Page resets to 1 on any change.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { shouldSyncSearchFromUrl } from '@/lib/revenue/searchSync';
import FilterChipLink from '@/components/ui/FilterChipLink';
import SearchInput from '@/components/ui/SearchInput';
import Select from '@/components/ui/Select';
import { pipelineHref, type PipelineFilters as Filters } from '@/lib/revenue/listParams';
import { SOURCES, SOURCE_LABELS, type Source } from '@/lib/revenue/shared';

export default function PipelineFilters({ f, pipelines, stageGroups, staff, showStage }: {
	f: Filters;
	pipelines: { slug: string; name: string }[];
	stageGroups: { pipeline: string; stages: { id: string; name: string }[] }[];
	staff: { id: string; name: string }[];
	showStage: boolean;
}) {
	const router = useRouter();
	const go = (patch: Partial<Filters>) => router.replace(pipelineHref(f, patch), { scroll: false });
	const [q, setQ] = useState(f.q ?? '');
	const typed = useRef(false);
	// Last value we pushed to the URL: its echo must not overwrite what the user kept typing.
	const pushed = useRef<string | null | undefined>(undefined);
	useEffect(() => {
		if (shouldSyncSearchFromUrl(f.q, pushed.current)) setQ(f.q ?? '');
	}, [f.q]);
	useEffect(() => {
		if (!typed.current) return;
		const next = q.trim() || null;
		if (next === f.q) return;
		const t = setTimeout(() => {
			pushed.current = next;
			router.replace(pipelineHref(f, { q: next }), { scroll: false });
		}, 300);
		return () => clearTimeout(t);
	}, [q, f, router]);

	return (
		<div className="mb-3 flex flex-wrap items-center gap-2">
			<Select size="sm" aria-label="Pipeline" value={f.pipeline ?? ''} onChange={(e) => go({ pipeline: e.target.value || null })} className="w-44">
				<option value="">All pipelines</option>
				{pipelines.map((p) => (
					<option key={p.slug} value={p.slug}>{p.name}</option>
				))}
			</Select>
			{showStage && (
				<Select size="sm" aria-label="Stage" value={f.stage ?? ''} onChange={(e) => go({ stage: e.target.value || null })} className="w-48">
					<option value="">Any stage</option>
					{stageGroups.length === 1
						? stageGroups[0].stages.map((s) => (
								<option key={s.id} value={s.id}>{s.name}</option>
							))
						: stageGroups.map((g) => (
								<optgroup key={g.pipeline} label={g.pipeline}>
									{g.stages.map((s) => (
										<option key={s.id} value={s.id}>{s.name}</option>
									))}
								</optgroup>
							))}
				</Select>
			)}
			<Select size="sm" aria-label="Owner" value={f.owner ?? ''} onChange={(e) => go({ owner: e.target.value || null })} className="w-44">
				<option value="">Anyone</option>
				<option value="me">Me</option>
				{staff.map((s) => (
					<option key={s.id} value={s.id}>{s.name}</option>
				))}
			</Select>
			<Select size="sm" aria-label="Source" value={f.source ?? ''} onChange={(e) => go({ source: (e.target.value || null) as Source | null })} className="w-40">
				<option value="">Any source</option>
				{SOURCES.map((s) => (
					<option key={s} value={s}>{SOURCE_LABELS[s]}</option>
				))}
			</Select>
			{(['open', 'won', 'lost', 'all'] as const).map((s) => (
				<FilterChipLink key={s} href={pipelineHref(f, { status: s })} active={f.status === s}>
					{s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
				</FilterChipLink>
			))}
			<SearchInput
				aria-label="Search deal, person or brand"
				placeholder="Search deal, person or brand…"
				value={q}
				onChange={(e) => {
					typed.current = true;
					setQ(e.target.value);
				}}
				className="w-64"
			/>
		</div>
	);
}
