'use client';

// Editable users table for /admin/users. Admin/exec viewers get inline
// role + department dropdowns and an Active toggle; everyone else sees the
// same read-only badges as before. Updates are optimistic with rollback on
// error, and errors always carry a correction hint (honest-feedback rule).

import { useState } from 'react';
import Link from 'next/link';
import { Mail } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { formatRelative } from '@/lib/format';
import { updateUserProfile, type UserRole } from './actions';
import type { DepartmentTag } from '@/lib/people/departments';

const ROLES: UserRole[] = ['exec', 'admin', 'manager', 'contributor'];

// The hardcoded department list is gone (0089) — the options come from the
// tags table via the server component, so this screen can no longer offer a
// department the rest of the app does not recognise.

export interface ProfileRow {
	id: string;
	email: string;
	first_name: string | null;
	last_name: string | null;
	title: string | null;
	department_tag_id: string | null;
	role: UserRole;
	is_active: boolean;
	/** 0117 — absent until the migration lands; treated as false. */
	calibration_excluded?: boolean | null;
	created_at: string;
}

function roleColor(role: string): 'default' | 'success' | 'warning' | 'danger' | 'primary' {
	if (role === 'exec') return 'danger';
	if (role === 'admin') return 'warning';
	if (role === 'manager') return 'primary';
	return 'default';
}

interface UsersTableProps {
	initialRows: ProfileRow[];
	viewerId: string;
	viewerCanEdit: boolean;
	/** Department tags in canon order — the dropdown's options. */
	departments: DepartmentTag[];
}

export default function UsersTable({
	initialRows,
	viewerId,
	viewerCanEdit,
	departments,
}: UsersTableProps) {
	const [rows, setRows] = useState<ProfileRow[]>(initialRows);
	const [savingId, setSavingId] = useState<string | null>(null);
	const { toast } = useToast();
	const deptLabel = new Map(departments.map((d) => [d.id, d.label]));

	async function applyChange(
		row: ProfileRow,
		patch: Partial<Pick<ProfileRow, 'role' | 'department_tag_id' | 'is_active' | 'calibration_excluded'>>,
		label: string,
	) {
		// Optimistic: apply locally, roll back if the server rejects.
		const before = rows;
		setRows((list) => list.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
		setSavingId(row.id);

		const result = await updateUserProfile({
			userId: row.id,
			role: patch.role,
			departmentTagId: patch.department_tag_id,
			isActive: patch.is_active,
			calibrationExcluded: patch.calibration_excluded ?? undefined,
		});

		setSavingId(null);
		if (!result.ok) {
			setRows(before);
			toast({ message: result.error, variant: 'error', duration: 8000 });
			return;
		}
		toast({ message: `${label} updated for ${row.email}.`, variant: 'success' });
	}

	return (
		<Card padding="none" className="overflow-hidden">
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
							{['Name', 'Email', 'Department', 'Title', 'Role', 'Status', 'Calibration', 'Created'].map((h) => (
								<th
									key={h}
									className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5"
								>
									{h}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.length === 0 ? (
							<tr>
								<td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-500">
									No users yet.
								</td>
							</tr>
						) : (
							rows.map((u) => {
								const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || '—';
								const isSelf = u.id === viewerId;
								const saving = savingId === u.id;
								return (
									<tr
										key={u.id}
										className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
									>
										<td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
											{/* Same record as the profile page — the row IS the profile. */}
											<Link href={`/team/${u.id}`} className="hover:text-primary-600 hover:underline underline-offset-2 transition-colors">
												{name}
											</Link>
											{isSelf && (
												<span className="ml-1.5 text-2xs text-slate-600 dark:text-slate-400 font-normal">(you)</span>
											)}
										</td>
										<td className="px-4 py-3">
											<a
												href={`mailto:${u.email}`}
												className="inline-flex items-center gap-1.5 text-primary-600 hover:underline"
											>
												<Mail className="w-3 h-3" />
												{u.email}
											</a>
										</td>
										<td className="px-4 py-3 text-slate-700 dark:text-slate-300">
											{viewerCanEdit ? (
												<Select
													size="sm"
													aria-label="Department"
													value={u.department_tag_id ?? ''}
													disabled={saving}
													onChange={(e) =>
														void applyChange(
															u,
															{ department_tag_id: e.target.value === '' ? null : e.target.value },
															'Department',
														)
													}
												>
													<option value="">—</option>
													{departments.map((d) => (
														<option key={d.id} value={d.id}>
															{d.label}
														</option>
													))}
												</Select>
											) : (
												(u.department_tag_id ? deptLabel.get(u.department_tag_id) : null) ?? '—'
											)}
										</td>
										<td className="px-4 py-3 text-slate-500">{u.title ?? '—'}</td>
										<td className="px-4 py-3">
											{viewerCanEdit ? (
												// Self role changes are blocked server-side (anti-lockout);
												// disable the control so the rule is visible, not a surprise.
												<Select
													size="sm"
													aria-label="Role"
													value={u.role}
													disabled={saving || isSelf}
													title={isSelf ? "You can't change your own role — ask another admin." : undefined}
													onChange={(e) =>
														void applyChange(u, { role: e.target.value as UserRole }, 'Role')
													}
												>
													{ROLES.map((r) => (
														<option key={r} value={r}>
															{r}
														</option>
													))}
												</Select>
											) : (
												<Badge color={roleColor(u.role)}>{u.role}</Badge>
											)}
										</td>
										<td className="px-4 py-3">
											{viewerCanEdit ? (
												<button
													type="button"
													disabled={saving || isSelf}
													title={isSelf ? "You can't deactivate yourself." : 'Toggle active'}
													onClick={() =>
														void applyChange(u, { is_active: !u.is_active }, 'Status')
													}
													className="disabled:cursor-not-allowed"
												>
													<Badge color={u.is_active ? 'success' : 'default'}>
														{u.is_active ? 'Active' : 'Inactive'}
													</Badge>
												</button>
											) : (
												<Badge color={u.is_active ? 'success' : 'default'}>
													{u.is_active ? 'Active' : 'Inactive'}
												</Badge>
											)}
										</td>
										<td className="px-4 py-3">
											{/* 0117: excluded = active in the org chart, never assessed. */}
											{viewerCanEdit ? (
												<button
													type="button"
													disabled={saving}
													title={u.calibration_excluded ? 'Include in calibration' : 'Exclude from calibration'}
													onClick={() =>
														void applyChange(u, { calibration_excluded: !u.calibration_excluded }, 'Calibration')
													}
													className="disabled:cursor-not-allowed"
												>
													<Badge color={u.calibration_excluded ? 'warning' : 'default'}>
														{u.calibration_excluded ? 'Excluded' : 'Assessed'}
													</Badge>
												</button>
											) : (
												<Badge color={u.calibration_excluded ? 'warning' : 'default'}>
													{u.calibration_excluded ? 'Excluded' : 'Assessed'}
												</Badge>
											)}
										</td>
										<td className="px-4 py-3 text-slate-500 whitespace-nowrap">
											{formatRelative(u.created_at)}
										</td>
									</tr>
								);
							})
						)}
					</tbody>
				</table>
			</div>
		</Card>
	);
}
