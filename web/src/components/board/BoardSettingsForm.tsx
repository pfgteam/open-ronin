'use client';

// Board settings + New board (spec §4.2 screens 4 and 6). One form: name,
// section, data (item types, quarter, department), grouping, default view,
// columns (show/hide, order) and custom columns. Statuses are not editable:
// they are canonical per item type.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, Eye, EyeOff, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { controlFocus } from '@/components/ui/focus';
import { PARENT_KIND_FOR } from '@/app/(app)/the-work/hierarchy';
import { KIND_LABELS } from '@/lib/work/boards/groups';
import { allColumns, groupableColumns } from '@/lib/work/boards/columns';
import { BOARD_SECTIONS, type ColumnConfig, type CustomColumn, type CustomColumnType } from '@/lib/work/boards/types';
import { addCustomColumn, archiveBoard, createBoard, deleteCustomColumn, updateBoard, type BoardSettingsInput } from '@/app/(app)/the-work/b/boardActions';
import { BOARDS_CHANGED_EVENT } from '@/components/nav/workBoards';
import ClientSelect from '@/components/work/ClientSelect';

const KIND_CHOICES = ['goal', 'priority', 'project', 'task', 'recurring', 'process', 'assignment', 'campaign'];
const TEMPLATES: { label: string; hint: string; kinds: string[]; group: string; columns: string[] }[] = [
	{ label: 'Projects', hint: 'type = project', kinds: ['project'], group: 'parent', columns: ['owner', 'status', 'timeline', 'due', 'progress'] },
	{ label: 'Tasks', hint: 'type = task', kinds: ['task'], group: 'parent', columns: ['owner', 'status', 'due', 'followers'] },
	{ label: 'Assignments', hint: 'client work', kinds: ['assignment'], group: 'client', columns: ['owner', 'status', 'client', 'due'] },
	{ label: 'Goals & Priorities', hint: 'priorities by goal', kinds: ['priority'], group: 'parent', columns: ['owner', 'status', 'quarter', 'progress'] },
	{ label: 'Recurring', hint: 'recurring + process', kinds: ['recurring', 'process'], group: 'kind', columns: ['owner', 'status', 'department'] },
];
const TYPE_LABELS: Record<CustomColumnType, string> = { text: 'Text', number: 'Number', date: 'Date', dropdown: 'Dropdown', person: 'Person', link: 'Link', checkbox: 'Checkbox' };

export interface BoardSettingsFormProps {
	mode: 'create' | 'edit';
	boardId?: string;
	slug?: string;
	isSystem?: boolean;
	initial: BoardSettingsInput;
	customColumns: CustomColumn[];
	departments: { id: string; label: string }[];
}

export default function BoardSettingsForm(p: BoardSettingsFormProps) {
	const router = useRouter();
	const { toast } = useToast();
	const [v, setV] = useState<BoardSettingsInput>(p.initial);
	const [custom, setCustom] = useState(p.customColumns);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [newCol, setNewCol] = useState<{ label: string; type: CustomColumnType; options: string }>({ label: '', type: 'text', options: '' });
	const [confirmArchive, setConfirmArchive] = useState(false);

	const set = <K extends keyof BoardSettingsInput>(k: K, val: BoardSettingsInput[K]) => setV((x) => ({ ...x, [k]: val }));

	// Ordered column list: configured first, then anything not yet listed (hidden).
	const columns: ColumnConfig[] = useMemo(() => {
		const all = allColumns(custom);
		const known = new Set(all.map((c) => c.key));
		const listed = v.columns.filter((c) => known.has(c.key));
		const rest = all.filter((c) => !listed.some((l) => l.key === c.key)).map((c) => ({ key: c.key, visible: false }));
		return [...listed, ...rest];
	}, [v.columns, custom]);
	const defs = useMemo(() => new Map(allColumns(custom).map((c) => [c.key, c])), [custom]);

	const groupChoices = useMemo(() => {
		const out: { key: string; label: string }[] = [];
		const parentKind = v.kinds.map((k) => PARENT_KIND_FOR[k]).find(Boolean);
		if (parentKind) out.push({ key: 'parent', label: KIND_LABELS[parentKind] ?? parentKind });
		if (v.kinds.length > 1) out.push({ key: 'kind', label: 'Type' });
		for (const c of groupableColumns(custom)) if (c.key !== 'parent' && c.key !== 'kind') out.push({ key: c.key, label: c.label });
		return out;
	}, [v.kinds, custom]);

	const move = (i: number, d: -1 | 1) => {
		const list = [...columns];
		const j = i + d;
		if (j < 0 || j >= list.length) return;
		[list[i], list[j]] = [list[j], list[i]];
		set('columns', list);
	};

	const save = async () => {
		setBusy(true); setError(null);
		const input = { ...v, columns, group_by: groupChoices.some((g) => g.key === v.group_by) ? v.group_by : groupChoices[0]?.key ?? 'status' };
		const res = p.mode === 'create' ? await createBoard(input) : await updateBoard(p.boardId!, input);
		setBusy(false);
		if (!res.ok) { setError(res.error); return; }
		window.dispatchEvent(new Event(BOARDS_CHANGED_EVENT));
		const slug = p.mode === 'create' ? (res.data as { slug: string }).slug : p.slug!;
		toast({ message: p.mode === 'create' ? 'Board created' : 'Board saved', variant: 'success' });
		router.push(`/the-work/b/${slug}`);
	};

	const addColumn = async () => {
		if (!p.boardId) return;
		const res = await addCustomColumn(p.boardId, { label: newCol.label, type: newCol.type, options: newCol.options.split(',') });
		if (!res.ok) { toast({ message: res.error, variant: 'error' }); return; }
		setCustom((c) => [...c, { id: res.data.id, key: res.data.key, label: newCol.label.trim(), type: newCol.type, options: {}, position: 999 }]);
		set('columns', [...columns.filter((c) => c.key !== res.data.key), { key: res.data.key, visible: true }]);
		setNewCol({ label: '', type: 'text', options: '' });
		toast({ message: `Column "${newCol.label.trim()}" added to this board only. Save to keep its position.`, variant: 'success' });
	};

	return (
		<div className="max-w-3xl space-y-5 pb-16">
			{p.mode === 'create' && (
				<section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
					<h2 className="mb-2 text-sm font-semibold">Start from</h2>
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
						{TEMPLATES.map((t) => {
							const on = t.kinds.join() === v.kinds.join();
							return (
								<button key={t.label} type="button" aria-pressed={on}
									onClick={() => setV((x) => ({ ...x, kinds: t.kinds, group_by: t.group, columns: t.columns.map((key) => ({ key, visible: true })) }))}
									className={clsx('rounded-lg border p-3 text-left', controlFocus, on ? 'border-primary-600 bg-primary-50 dark:bg-primary-950' : 'border-slate-200 dark:border-slate-700 hover:bg-hover')}>
									<span className="block text-sm font-semibold">{t.label}</span>
									<span className="block text-xs text-slate-500">{t.hint}</span>
								</button>
							);
						})}
					</div>
					<p className="mt-2 text-xs text-slate-500">A board doesn&rsquo;t copy items: it shows the work items that match its filter.</p>
				</section>
			)}

			<section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-4">
				<h2 className="text-sm font-semibold">General</h2>
				<Input label="Name" value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="Media team · Q4 pitches" />
				<div>
					<span className="text-sm font-medium text-slate-700 dark:text-slate-300">Section in the menu</span>
					<div role="radiogroup" aria-label="Section" className="mt-1 flex flex-wrap gap-1.5">
						{BOARD_SECTIONS.filter((s) => s.key !== 'queue').map((s) => (
							<button key={s.key} type="button" role="radio" aria-checked={v.section === s.key} onClick={() => set('section', s.key)}
								className={clsx('rounded-full border px-3 py-1 text-sm', controlFocus, v.section === s.key ? 'border-primary-600 bg-primary-50 font-semibold text-primary-800 dark:bg-primary-950 dark:text-primary-300' : 'border-slate-300 dark:border-slate-600')}>
								{s.label}
							</button>
						))}
					</div>
				</div>
			</section>

			<section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-4">
				<h2 className="text-sm font-semibold">Data</h2>
				<fieldset>
					<legend className="text-sm font-medium text-slate-700 dark:text-slate-300">Item types</legend>
					<div className="mt-1 flex flex-wrap gap-3">
						{KIND_CHOICES.map((k) => (
							<label key={k} className="flex items-center gap-1.5 text-sm">
								<input type="checkbox" className="accent-primary-600" checked={v.kinds.includes(k)}
									onChange={(e) => set('kinds', e.target.checked ? [...v.kinds, k] : v.kinds.filter((x) => x !== k))} />
								{KIND_LABELS[k] ?? k}
							</label>
						))}
					</div>
				</fieldset>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<Select label="Quarter" value={v.quarter} onChange={(e) => set('quarter', e.target.value as 'current' | 'any')}>
						<option value="current">Current quarter</option>
						<option value="any">Any quarter</option>
					</Select>
					<Select label="Department" value={v.department_tag_ids[0] ?? ''} onChange={(e) => set('department_tag_ids', e.target.value ? [e.target.value] : [])}>
						<option value="">All departments</option>
						{p.departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
					</Select>
					<ClientSelect label="Client" emptyLabel="All clients" value={v.client_id ?? ''} onChange={(id) => set('client_id', id || null)} />
					<Select label="Default view" value={v.default_view} onChange={(e) => set('default_view', e.target.value as BoardSettingsInput['default_view'])}>
						<option value="table">Table</option><option value="kanban">Kanban</option><option value="timeline">Timeline</option><option value="calendar">Calendar</option>
					</Select>
				</div>
				<Select label="Group by" value={groupChoices.some((g) => g.key === v.group_by) ? v.group_by : groupChoices[0]?.key ?? 'status'} onChange={(e) => set('group_by', e.target.value)}>
					{groupChoices.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
				</Select>
				<label className="flex items-start gap-2 text-sm">
					<input type="checkbox" className="mt-0.5 accent-primary-600" checked={v.show_done} onChange={(e) => set('show_done', e.target.checked)} />
					<span>
						Show done items by default
						<span className="block text-xs text-slate-500">Completed items stay on the board. The &ldquo;Show done&rdquo; chip can still hide them.</span>
					</span>
				</label>
			</section>

			<section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
				<h2 className="text-sm font-semibold">Columns</h2>
				<p className="mb-3 text-xs text-slate-500">Show, hide and order this board&rsquo;s columns. Status is fixed per item type: it feeds KPIs and the compute engine.</p>
				<ul className="space-y-1">
					{columns.map((c, i) => {
						const def = defs.get(c.key);
						if (!def) return null;
						return (
							<li key={c.key} className={clsx('flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5', !c.visible && 'opacity-60')}>
								<span className="flex-1 truncate text-sm font-medium">{def.label}</span>
								<span className="text-xs text-slate-500">{def.custom ? `${TYPE_LABELS[def.custom.type]} · custom` : 'Built-in'}</span>
								<button type="button" onClick={() => move(i, -1)} aria-label={`Move ${def.label} up`} className={clsx('rounded-md p-1 hover:bg-slate-100 dark:hover:bg-slate-700', controlFocus)}><ArrowUp className="w-3.5 h-3.5" aria-hidden="true" /></button>
								<button type="button" onClick={() => move(i, 1)} aria-label={`Move ${def.label} down`} className={clsx('rounded-md p-1 hover:bg-slate-100 dark:hover:bg-slate-700', controlFocus)}><ArrowDown className="w-3.5 h-3.5" aria-hidden="true" /></button>
								<button type="button" aria-pressed={c.visible} onClick={() => set('columns', columns.map((x) => (x.key === c.key ? { ...x, visible: !x.visible } : x)))}
									aria-label={c.visible ? `Hide ${def.label}` : `Show ${def.label}`} className={clsx('rounded-md p-1 hover:bg-slate-100 dark:hover:bg-slate-700', controlFocus)}>
									{c.visible ? <Eye className="w-3.5 h-3.5" aria-hidden="true" /> : <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />}
								</button>
								{def.custom && p.mode === 'edit' && (
									<button type="button" aria-label={`Delete ${def.label}`} className={clsx('rounded-md p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950', controlFocus)}
										onClick={async () => {
											const res = await deleteCustomColumn(def.custom!.id);
											if (!res.ok) { toast({ message: res.error, variant: 'error' }); return; }
											setCustom((x) => x.filter((cc) => cc.id !== def.custom!.id));
											set('columns', columns.filter((x) => x.key !== c.key));
										}}>
										<Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
									</button>
								)}
							</li>
						);
					})}
				</ul>
				{p.mode === 'edit' ? (
					<div className="mt-4 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-3">
						<h3 className="mb-2 text-sm font-semibold">New custom column</h3>
						<div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem]">
							<Input label="Name" value={newCol.label} onChange={(e) => setNewCol((x) => ({ ...x, label: e.target.value }))} placeholder="Budget" />
							<Select label="Type" value={newCol.type} onChange={(e) => setNewCol((x) => ({ ...x, type: e.target.value as CustomColumnType }))}>
								{(Object.keys(TYPE_LABELS) as CustomColumnType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
							</Select>
						</div>
						{newCol.type === 'dropdown' && (
							<div className="mt-2"><Input label="Options (comma separated)" value={newCol.options} onChange={(e) => setNewCol((x) => ({ ...x, options: e.target.value }))} placeholder="Brief, Draft, Review, Live" /></div>
						)}
						<Button variant="outline" size="sm" className="mt-2" onClick={addColumn} disabled={!newCol.label.trim()}>Add column</Button>
						<p className="mt-1 text-xs text-slate-500">The column exists only on this board.</p>
					</div>
				) : <p className="mt-3 text-xs text-slate-500">Custom columns can be added once the board exists.</p>}
			</section>

			{error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
			<div className="flex items-center gap-2">
				<Button onClick={save} loading={busy}>{p.mode === 'create' ? 'Create board' : 'Save board'}</Button>
				<Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
				{p.mode === 'edit' && !p.isSystem && (
					confirmArchive ? (
						<span className="ml-auto flex items-center gap-2 text-sm">Archive this board? Items stay where they are.
							<Button variant="outline" size="sm" className="text-red-600" onClick={async () => {
								const res = await archiveBoard(p.boardId!);
								if (!res.ok) { toast({ message: res.error, variant: 'error' }); return; }
								window.dispatchEvent(new Event(BOARDS_CHANGED_EVENT));
								router.push('/the-work');
							}}>Archive</Button>
							<Button variant="ghost" size="sm" onClick={() => setConfirmArchive(false)}>Keep</Button>
						</span>
					) : <Button variant="ghost" className="ml-auto text-red-600 dark:text-red-400" onClick={() => setConfirmArchive(true)}>Archive board</Button>
				)}
			</div>
		</div>
	);
}
