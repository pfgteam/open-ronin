'use client';

// Page editor + Citation Ledger (F1).

import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { CITATION_STATUSES, CITATION_STATUS_COLORS, CITATION_STATUS_LABELS, PAGE_KINDS, PAGE_KIND_LABELS, PAGE_NEXT, PAGE_STATUS_LABELS, POSTER_KINDS, POSTER_KIND_LABELS, type ChannelRow, type CitationRow, type FactRow, type PageRow } from '@/lib/flywheel/shared';
import ActionForm from '../../../ActionForm';
import { planCitations, saveCitation, savePage } from '../../../actions';

export function PageEditor({ page, programId }: { page: PageRow; programId: string }) {
	const next = PAGE_NEXT[page.status];
	return (
		<>
			<Card>
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Status</h2>
				<ActionForm action={savePage} success="Status updated." className="flex flex-wrap gap-1.5">
					<input type="hidden" name="id" value={page.id} />
					<input type="hidden" name="program_id" value={programId} />
					{next.length === 0 && <p className="text-xs text-slate-500">Live. Nothing further.</p>}
					{next.map((s) => (
						<Button key={s} type="submit" name="status" value={s} size="sm" variant={s === 'changes_requested' ? 'ghost' : 'outline'}>
							→ {PAGE_STATUS_LABELS[s]}
						</Button>
					))}
				</ActionForm>
				<p className="text-2xs text-slate-500 mt-2">
					{page.sent_to_client_at ? `Sent to client ${page.sent_to_client_at.slice(0, 10)}` : 'Not sent to client'}
					{page.auto_approve_at ? ` · silent approval ${page.auto_approve_at.slice(0, 10)}` : ''}
					{page.verified_at ? ` · verified ${page.verified_at.slice(0, 10)}` : ''}
					{page.approved_at ? ` · approved ${page.approved_at.slice(0, 10)} (${page.approved_by ?? ''})` : ''}
					{page.handed_off_at ? ` · handed off ${page.handed_off_at.slice(0, 10)}${page.handed_off_to ? ` to ${page.handed_off_to}` : ''}` : ''}
					{page.live_at ? ` · live ${page.live_at.slice(0, 10)}` : ''}
				</p>
			</Card>
			<Card>
				<ActionForm action={savePage} success="Page saved." className="grid gap-3 md:grid-cols-4">
					<input type="hidden" name="id" value={page.id} />
					<input type="hidden" name="program_id" value={programId} />
					<Select label="Kind" name="kind" defaultValue={page.kind}>
						{PAGE_KINDS.map((k) => (
							<option key={k} value={k}>
								{PAGE_KIND_LABELS[k]}
							</option>
						))}
					</Select>
					<div className="md:col-span-3">
						<Input label="Verbatim keyword" name="keyword" defaultValue={page.keyword} required />
					</div>
					<div className="md:col-span-3">
						<Input label="Title (H1 leads with the keyword)" name="title" defaultValue={page.title ?? ''} />
					</div>
					<Input label="Chapter #" name="chapter_index" type="number" min={1} max={20} defaultValue={page.chapter_index ?? ''} />
					<div className="md:col-span-2">
						<Input label="Meta title" name="meta_title" defaultValue={page.meta_title ?? ''} />
					</div>
					<Input label="Words min" name="word_target_min" type="number" defaultValue={page.word_target_min ?? ''} />
					<Input label="Words max" name="word_target_max" type="number" defaultValue={page.word_target_max ?? ''} />
					<div className="md:col-span-4">
						<Textarea label="Quick Answer block" name="quick_answer_md" rows={3} defaultValue={page.quick_answer_md ?? ''} />
					</div>
					<div className="md:col-span-4">
						<Textarea label="Body (markdown; F4 drafts it from the seed-video chapter)" name="body_md" rows={14} defaultValue={page.body_md ?? ''} />
					</div>
					<div className="md:col-span-2">
						<Textarea label="Internal links (one per line)" name="internal_links" rows={3} defaultValue={page.internal_links.join('\n')} />
					</div>
					<div className="md:col-span-2 space-y-2">
						<Input label="Handed off to (client / developer)" name="handed_off_to" defaultValue={page.handed_off_to ?? ''} />
						<Input label="Live URL" name="live_url" defaultValue={page.live_url ?? ''} placeholder="https://" />
						<Input label="Target citations" name="target_citations" type="number" min={1} max={60} defaultValue={page.target_citations ?? 20} />
					</div>
					<div className="md:col-span-4">
						<Textarea label="Internal notes" name="notes_md" rows={2} defaultValue={page.notes_md ?? ''} />
					</div>
					<div className="md:col-span-4">
						<Button type="submit" size="sm">
							Save page
						</Button>
					</div>
				</ActionForm>
			</Card>
		</>
	);
}

export function CitationLedger({ programId, page, citations, channels, facts, people }: { programId: string; page: PageRow; citations: CitationRow[]; channels: ChannelRow[]; facts: FactRow[]; people: { id: string; name: string }[] }) {
	const [editing, setEditing] = useState<string | null>(null);
	const factOf = (id: string | null) => facts.find((f) => f.id === id)?.fact ?? null;
	return (
		<Card>
			<div className="flex items-center justify-between mb-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Citation Ledger · page {page.number}</h2>
				<ActionForm action={planCitations} success="Planned rows added at each channel's minimum.">
					<input type="hidden" name="page_id" value={page.id} />
					<input type="hidden" name="program_id" value={programId} />
					<Button type="submit" size="sm" variant="outline">
						Plan citations (fill to channel minimums)
					</Button>
				</ActionForm>
			</div>
			<table className="w-full text-sm">
				<thead>
					<tr className="text-left text-2xs uppercase tracking-wide text-slate-500">
						<th className="py-1 pr-2">Channel</th>
						<th className="py-1 pr-2">Title / URL</th>
						<th className="py-1 pr-2">Status</th>
						<th className="py-1 pr-2">Posted</th>
						<th className="py-1 pr-2">Fact</th>
						<th className="py-1 pr-2">Models</th>
						<th className="py-1"></th>
					</tr>
				</thead>
				<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
					{citations.map((c) => (
						<tr key={c.id} className="align-top">
							<td className="py-1.5 pr-2 text-slate-700 dark:text-slate-300">{channels.find((x) => x.key === c.channel_key)?.label ?? c.channel_key}</td>
							<td className="py-1.5 pr-2 max-w-xs">
								<div className="text-slate-900 dark:text-slate-100 truncate">{c.title ?? '—'}</div>
								{c.url && (
									<a href={c.url} target="_blank" rel="noreferrer" className="text-2xs text-primary-600 hover:underline break-all">
										{c.url}
									</a>
								)}
							</td>
							<td className="py-1.5 pr-2"><Badge color={CITATION_STATUS_COLORS[c.status]}>{CITATION_STATUS_LABELS[c.status]}</Badge></td>
							<td className="py-1.5 pr-2 text-slate-600 dark:text-slate-400">{c.posted_on ?? '—'}</td>
							<td className="py-1.5 pr-2 text-2xs text-slate-600 dark:text-slate-400 max-w-[180px] truncate" title={factOf(c.fact_id) ?? ''}>{factOf(c.fact_id) ?? '—'}</td>
							<td className="py-1.5 pr-2 text-2xs text-slate-600 dark:text-slate-400">{c.models_surfacing.join(', ') || '—'}</td>
							<td className="py-1.5">
								<Button type="button" size="sm" variant="ghost" onClick={() => setEditing(editing === c.id ? null : c.id)}>
									{editing === c.id ? 'Close' : 'Edit'}
								</Button>
							</td>
						</tr>
					))}
					{citations.length === 0 && (
						<tr>
							<td colSpan={7} className="py-3 text-xs text-slate-500">
								No citations planned. Click “Plan citations” for the 8-channel template.
							</td>
						</tr>
					)}
				</tbody>
			</table>
			{editing && (
				<div className="mt-3 border-t border-slate-200 dark:border-slate-700 pt-3">
					<CitationForm programId={programId} page={page} citation={citations.find((c) => c.id === editing) ?? null} channels={channels} facts={facts} people={people} onDone={() => setEditing(null)} />
				</div>
			)}
			<div className="mt-3 border-t border-slate-200 dark:border-slate-700 pt-3">
				<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Add a citation</h3>
				<CitationForm programId={programId} page={page} citation={null} channels={channels} facts={facts} people={people} />
			</div>
		</Card>
	);
}

function CitationForm({ programId, page, citation, channels, facts, people, onDone }: { programId: string; page: PageRow; citation: CitationRow | null; channels: ChannelRow[]; facts: FactRow[]; people: { id: string; name: string }[]; onDone?: () => void }) {
	return (
		<ActionForm action={saveCitation} success={citation ? 'Citation saved.' : 'Citation added.'} className="grid gap-2 md:grid-cols-6" onDone={onDone} resetOnSuccess={!citation}>
			<input type="hidden" name="program_id" value={programId} />
			<input type="hidden" name="cluster_id" value={page.cluster_id} />
			<input type="hidden" name="page_id" value={page.id} />
			{citation && <input type="hidden" name="id" value={citation.id} />}
			<Select label="Channel" name="channel_key" size="sm" defaultValue={citation?.channel_key ?? channels[0]?.key}>
				{channels.filter((c) => c.is_active).map((c) => (
					<option key={c.key} value={c.key}>
						{c.label}
					</option>
				))}
			</Select>
			<Select label="Status" name="status" size="sm" defaultValue={citation?.status ?? 'planned'}>
				{CITATION_STATUSES.map((s) => (
					<option key={s} value={s}>
						{CITATION_STATUS_LABELS[s]}
					</option>
				))}
			</Select>
			<div className="md:col-span-2">
				<Input label="Title" name="title" defaultValue={citation?.title ?? ''} />
			</div>
			<div className="md:col-span-2">
				<Input label="URL" name="url" defaultValue={citation?.url ?? ''} placeholder="https://" />
			</div>
			<Input label="Posted on" name="posted_on" type="date" defaultValue={citation?.posted_on ?? ''} />
			<Input label="Keyword" name="keyword" defaultValue={citation?.keyword ?? page.keyword} />
			<div className="md:col-span-2">
				<Select label="Fact used" name="fact_id" size="sm" defaultValue={citation?.fact_id ?? ''}>
					<option value="">—</option>
					{facts.map((f) => (
						<option key={f.id} value={f.id}>
							{f.fact.slice(0, 80)}
						</option>
					))}
				</Select>
			</div>
			<Select label="Poster" name="poster_kind" size="sm" defaultValue={citation?.poster_kind ?? 'person'}>
				{POSTER_KINDS.map((k) => (
					<option key={k} value={k}>
						{POSTER_KIND_LABELS[k]}
					</option>
				))}
			</Select>
			<Select label="Posted by" name="poster_id" size="sm" defaultValue={citation?.poster_id ?? ''}>
				<option value="">—</option>
				{people.map((p) => (
					<option key={p.id} value={p.id}>
						{p.name}
					</option>
				))}
			</Select>
			<div className="md:col-span-2">
				<Input label="Account / handle" name="poster_handle" defaultValue={citation?.poster_handle ?? ''} />
			</div>
			<div className="md:col-span-2">
				<Input label="Models now surfacing the brand (comma separated)" name="models_surfacing" defaultValue={citation?.models_surfacing.join(', ') ?? ''} />
			</div>
			<div className="md:col-span-2">
				<Input label="Notes" name="notes_md" defaultValue={citation?.notes_md ?? ''} />
			</div>
			<div className="md:col-span-6">
				<Textarea label="Draft (markdown; F4 drafts per channel and checks the execution rules)" name="draft_md" rows={citation ? 6 : 3} defaultValue={citation?.draft_md ?? ''} />
			</div>
			<div className="md:col-span-6 flex gap-2">
				<Button type="submit" size="sm">
					{citation ? 'Save' : 'Add'}
				</Button>
				{citation && (
					<Button type="submit" name="remove" value="on" size="sm" variant="ghost">
						Remove
					</Button>
				)}
			</div>
		</ActionForm>
	);
}
