'use client';

import { useState, useTransition } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Plus, Pencil, X, Check, Move } from 'lucide-react';
import { createDepartment, createSubTeam, renameTag, reparentSubTeam, deleteTag, setDepartmentOrg } from './actions';
import { FALLBACK_COLOR } from '@/lib/colors';

interface Tag {
	id: string; slug: string; label: string; color: string | null;
	category: string | null; parent_tag_id: string | null; is_system: boolean; position: number;
}

interface Props {
	/** Org level (0084): MAIN_ORG, Beacon, Premium. Empty until the migration is applied. */
	orgs: Tag[];
	departments: Tag[];
	subTeams: Tag[];
	usage: Record<string, number>;
}

export default function TagsAdminView({ orgs, departments, subTeams, usage }: Props) {
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [newDeptOpen, setNewDeptOpen] = useState(false);
	const [newDeptLabel, setNewDeptLabel] = useState('');
	const [newSubFor, setNewSubFor] = useState<string | null>(null); // department id
	const [newSubLabel, setNewSubLabel] = useState('');
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editLabel, setEditLabel] = useState('');
	const [reparentingId, setReparentingId] = useState<string | null>(null);

	const subsByDept = new Map<string, Tag[]>();
	for (const s of subTeams) {
		if (!s.parent_tag_id) continue;
		const arr = subsByDept.get(s.parent_tag_id) ?? [];
		arr.push(s);
		subsByDept.set(s.parent_tag_id, arr);
	}

	function run(fn: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) {
		setError(null);
		startTransition(async () => {
			const res = await fn();
			if (!res.ok) { setError(res.error ?? 'Something went wrong.'); return; }
			onOk?.();
		});
	}

	function handleCreateDept() {
		if (!newDeptLabel.trim()) return;
		run(() => createDepartment(newDeptLabel), () => { setNewDeptLabel(''); setNewDeptOpen(false); });
	}

	function handleCreateSub(deptId: string) {
		if (!newSubLabel.trim()) return;
		run(() => createSubTeam(newSubLabel, deptId), () => { setNewSubLabel(''); setNewSubFor(null); });
	}

	function startEdit(t: Tag) { setEditingId(t.id); setEditLabel(t.label); setError(null); }

	function handleRename() {
		if (!editingId || !editLabel.trim()) return;
		run(() => renameTag(editingId, editLabel), () => { setEditingId(null); setEditLabel(''); });
	}

	function handleReparent(subId: string, newDeptId: string) {
		run(() => reparentSubTeam(subId, newDeptId), () => setReparentingId(null));
	}

	function handleSetOrg(deptId: string, orgId: string) {
		run(() => setDepartmentOrg(deptId, orgId || null));
	}

	function handleDelete(t: Tag) {
		if (!confirm(`Delete "${t.label}"? This can't be undone.`)) return;
		run(() => deleteTag(t.id));
	}

	return (
		<div className="space-y-4">
			{error && (
				<div className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">
					{error}
				</div>
			)}

			<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				{departments.map((dept) => {
					const subs = (subsByDept.get(dept.id) ?? []).sort((a, b) => a.position - b.position);
					const org = orgs.find((o) => o.id === dept.parent_tag_id) ?? null;
					return (
						<Card key={dept.id}>
							<div className="flex items-center justify-between gap-2 mb-2">
								{editingId === dept.id ? (
									<InlineEditRow
										value={editLabel}
										onChange={setEditLabel}
										onSave={handleRename}
										onCancel={() => setEditingId(null)}
										pending={pending}
									/>
								) : (
									<div className="flex items-center gap-2 min-w-0">
										<span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: dept.color ?? FALLBACK_COLOR }} />
										<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{dept.label}</h2>
										{usage[dept.id] > 0 && (
											<span className="text-2xs text-slate-600 dark:text-slate-400 shrink-0">{usage[dept.id]} in use</span>
										)}
									</div>
								)}
								{editingId !== dept.id && (
									<div className="flex items-center gap-1 shrink-0">
										{orgs.length > 0 && (
											<select
												value={org?.id ?? ''}
												onChange={(e) => handleSetOrg(dept.id, e.target.value)}
												disabled={pending}
												aria-label={`Org for ${dept.label}`}
												title="Which org this department belongs to (0084)"
												className={`text-2xs rounded-md border px-1.5 py-1 bg-white dark:bg-slate-800 ${org ? 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300' : 'border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400'}`}
											>
												<option value="">Org not set</option>
												{orgs.map((o) => (
													<option key={o.id} value={o.id}>{o.label}</option>
												))}
											</select>
										)}
										<button onClick={() => startEdit(dept)} className="text-slate-400 hover:text-primary-600 p-1 rounded-md transition-colors" title="Rename">
											<Pencil className="w-3.5 h-3.5" />
										</button>
										<button onClick={() => handleDelete(dept)} disabled={pending} className="text-slate-400 hover:text-red-600 p-1 rounded-md transition-colors" title="Delete">
											<X className="w-3.5 h-3.5" />
										</button>
									</div>
								)}
							</div>

							<div className="space-y-1">
								{subs.length === 0 && newSubFor !== dept.id && (
									<p className="text-2xs text-slate-600 dark:text-slate-400 italic">No sub-departments yet.</p>
								)}
								{subs.map((s) => (
									<div key={s.id} className="flex items-center justify-between gap-2 py-1 px-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/50 group transition-colors">
										{editingId === s.id ? (
											<InlineEditRow
												value={editLabel}
												onChange={setEditLabel}
												onSave={handleRename}
												onCancel={() => setEditingId(null)}
												pending={pending}
											/>
										) : reparentingId === s.id ? (
											<select
												autoFocus
												defaultValue=""
												onChange={(e) => e.target.value && handleReparent(s.id, e.target.value)}
												onBlur={() => setReparentingId(null)}
												className="w-full text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-1"
											>
												<option value="" disabled>Move to…</option>
												{departments.filter((d) => d.id !== dept.id).map((d) => (
													<option key={d.id} value={d.id}>{d.label}</option>
												))}
											</select>
										) : (
											<>
												<span className="text-xs text-slate-700 dark:text-slate-300 truncate flex-1">
													{s.label}
													{usage[s.id] > 0 && <span className="text-2xs text-slate-600 dark:text-slate-400 ml-1.5">{usage[s.id]} in use</span>}
												</span>
												<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
													<button onClick={() => setReparentingId(s.id)} className="text-slate-400 hover:text-primary-600 p-1 rounded-md transition-colors" title="Move to another department">
														<Move className="w-3 h-3" />
													</button>
													<button onClick={() => startEdit(s)} className="text-slate-400 hover:text-primary-600 p-1 rounded-md transition-colors" title="Rename">
														<Pencil className="w-3 h-3" />
													</button>
													<button onClick={() => handleDelete(s)} disabled={pending} className="text-slate-400 hover:text-red-600 p-1 rounded-md transition-colors" title="Delete">
														<X className="w-3 h-3" />
													</button>
												</div>
											</>
										)}
									</div>
								))}

								{newSubFor === dept.id ? (
									<div className="flex items-center gap-1.5 pt-1">
										<Input
											autoFocus
											value={newSubLabel}
											onChange={(e) => setNewSubLabel(e.target.value)}
											onKeyDown={(e) => { if (e.key === 'Enter') handleCreateSub(dept.id); if (e.key === 'Escape') setNewSubFor(null); }}
											placeholder="Sub-department name"
											className="text-xs"
										/>
										<button onClick={() => handleCreateSub(dept.id)} disabled={pending} className="text-primary-600 hover:text-primary-700 p-1 transition-colors"><Check className="w-4 h-4" /></button>
										<button onClick={() => setNewSubFor(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1 transition-colors"><X className="w-4 h-4" /></button>
									</div>
								) : (
									<button
										onClick={() => { setNewSubFor(dept.id); setNewSubLabel(''); }}
										className="mt-1 text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 inline-flex items-center gap-1 transition-colors"
									>
										<Plus className="w-3 h-3" /> Add sub-department
									</button>
								)}
							</div>
						</Card>
					);
				})}
			</div>

			{newDeptOpen ? (
				<Card>
					<div className="flex items-center gap-1.5">
						<Input
							autoFocus
							value={newDeptLabel}
							onChange={(e) => setNewDeptLabel(e.target.value)}
							onKeyDown={(e) => { if (e.key === 'Enter') handleCreateDept(); if (e.key === 'Escape') setNewDeptOpen(false); }}
							placeholder="Department name"
						/>
						<Button onClick={handleCreateDept} loading={pending}>Add</Button>
						<button onClick={() => setNewDeptOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2 transition-colors"><X className="w-4 h-4" /></button>
					</div>
				</Card>
			) : (
				<Button variant="outline" onClick={() => setNewDeptOpen(true)}>
					<Plus className="w-4 h-4" /> Add department
				</Button>
			)}
		</div>
	);
}

function InlineEditRow({
	value, onChange, onSave, onCancel, pending,
}: { value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void; pending: boolean }) {
	return (
		<div className="flex items-center gap-1.5 flex-1">
			<Input
				autoFocus
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel(); }}
				className="text-xs"
			/>
			<button onClick={onSave} disabled={pending} aria-label="Save" className="text-primary-600 hover:text-primary-700 p-1 transition-colors"><Check className="w-3.5 h-3.5" /></button>
			<button onClick={onCancel} aria-label="Cancel" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1 transition-colors"><X className="w-3.5 h-3.5" /></button>
		</div>
	);
}
