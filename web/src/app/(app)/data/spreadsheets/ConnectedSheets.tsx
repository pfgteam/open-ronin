'use client';

// Connected sheets tab: the sheet_sources rows with Sync now, Disconnect and
// an add by URL form. Results come back as sentences from the server
// actions; the toast shows them and router.refresh() repaints the server
// rendered rows (revalidatePath on the action side).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/format';
import { ExternalLink, RefreshCw, Trash2, Plus, Table2 } from 'lucide-react';
import {
	addSourceAction,
	removeSourceAction,
	syncAllAction,
	syncSourceAction,
	type ActionResult,
} from './actions';

export interface SourceView {
	id: string;
	google_sheet_id: string;
	display_name: string;
	tabs: string[];
	sync_interval_minutes: number | null;
	last_synced_at: string | null;
	last_sync_status: 'ok' | 'partial' | 'error' | null;
	last_sync_error: string | null;
	snapshot_rows: number;
}

interface Props {
	sources: SourceView[];
	serviceAccountEmail: string | null;
	canManage: boolean;
}

const INTERVALS = [
	{ value: 10, label: 'Every 10 minutes' },
	{ value: 30, label: 'Every 30 minutes' },
	{ value: 60, label: 'Every hour' },
	{ value: 360, label: 'Every 6 hours' },
	{ value: 1440, label: 'Once a day' },
];

function StatusBadge({ s }: { s: SourceView }) {
	if (s.last_sync_status === 'ok') return <Badge color="success">Synced</Badge>;
	if (s.last_sync_status === 'partial') return <Badge color="warning">Partial</Badge>;
	if (s.last_sync_status === 'error') return <Badge color="danger">Error</Badge>;
	return <Badge>Never synced</Badge>;
}

export default function ConnectedSheets({ sources, serviceAccountEmail, canManage }: Props) {
	const router = useRouter();
	const { toast } = useToast();
	const [pending, startTransition] = useTransition();
	const [busyId, setBusyId] = useState<string | null>(null);
	const [showAdd, setShowAdd] = useState(false);
	const [addError, setAddError] = useState<string | null>(null);

	function report(result: ActionResult) {
		toast({ message: result.message, variant: result.ok ? 'success' : 'error', duration: result.ok ? 5000 : 9000 });
		router.refresh();
	}

	function syncOne(id: string) {
		setBusyId(id);
		startTransition(async () => {
			report(await syncSourceAction(id));
			setBusyId(null);
		});
	}

	function syncAll() {
		setBusyId('*');
		startTransition(async () => {
			report(await syncAllAction());
			setBusyId(null);
		});
	}

	function remove(s: SourceView) {
		if (!window.confirm(`Disconnect "${s.display_name}"? Its snapshots are removed too. The Google Sheet itself is untouched.`)) return;
		setBusyId(s.id);
		startTransition(async () => {
			report(await removeSourceAction(s.id));
			setBusyId(null);
		});
	}

	function add(formData: FormData) {
		setAddError(null);
		setBusyId('add');
		startTransition(async () => {
			const result = await addSourceAction(formData);
			setBusyId(null);
			if (result.ok) {
				setShowAdd(false);
				report(result);
			} else {
				setAddError(result.message);
			}
		});
	}

	return (
		<div className="space-y-4">
			<Callout tone="info">
				{serviceAccountEmail ? (
					<>
						Share each sheet with <code className="font-mono text-xs">{serviceAccountEmail}</code> (Viewer is
						enough) before connecting it. Sheets are read only here; the sheet is the editor.
					</>
				) : (
					<>
						<span className="font-medium">GOOGLE_SERVICE_ACCOUNT_JSON is not set</span> in this environment, so
						nothing can sync. Add the key in Vercel and share each sheet with the service account.
					</>
				)}
			</Callout>

			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-xs text-slate-500 dark:text-slate-400">
					{sources.length} connected {sources.length === 1 ? 'sheet' : 'sheets'}. The schedule runs every 10 minutes
					and syncs each sheet on its own interval.
				</p>
				{canManage && (
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" onClick={syncAll} loading={pending && busyId === '*'} disabled={pending || sources.length === 0}>
							<RefreshCw className="w-3.5 h-3.5" />
							Sync all
						</Button>
						<Button size="sm" onClick={() => setShowAdd((v) => !v)} disabled={pending}>
							<Plus className="w-3.5 h-3.5" />
							Add sheet
						</Button>
					</div>
				)}
			</div>

			{showAdd && canManage && (
				<Card>
					<form action={add} className="space-y-3">
						<p className="text-sm font-medium text-slate-900 dark:text-slate-100">Connect a Google Sheet</p>
						<Input
							name="url"
							label="Sheet URL"
							placeholder="https://docs.google.com/spreadsheets/d/..."
							required
							autoFocus
						/>
						<Select name="interval" label="Sync interval" defaultValue="30">
							{INTERVALS.map((i) => (
								<option key={i.value} value={i.value}>
									{i.label}
								</option>
							))}
						</Select>
						<p className="text-xs text-slate-500 dark:text-slate-400">
							The title and every tab are read from Google on connect and the first snapshot is taken right away.
						</p>
						{addError && <Callout tone="error">{addError}</Callout>}
						<div className="flex items-center gap-2">
							<Button type="submit" size="sm" loading={pending && busyId === 'add'} disabled={pending}>
								Connect
							</Button>
							<Button type="button" variant="ghost" size="sm" onClick={() => setShowAdd(false)} disabled={pending}>
								Cancel
							</Button>
						</div>
					</form>
				</Card>
			)}

			{sources.length === 0 && (
				<Card>
					<p className="text-sm text-slate-600 dark:text-slate-400">No sheets connected yet.</p>
				</Card>
			)}

			<div className="space-y-2">
				{sources.map((s) => {
					const busy = pending && (busyId === s.id || busyId === '*');
					return (
						<Card key={s.id} padding="md">
							<div className="flex items-start justify-between gap-4">
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2 mb-1 flex-wrap">
										<p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">{s.display_name}</p>
										<StatusBadge s={s} />
									</div>
									<p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">{s.google_sheet_id}</p>
									<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
										<span>Tabs: {s.tabs.length > 0 ? s.tabs.join(', ') : 'all'}</span>
										<span>Every {s.sync_interval_minutes ?? 30}m</span>
										<span>
											Last synced {s.last_synced_at ? formatDate(s.last_synced_at, 'MMM d, yyyy h:mm a') : 'never'}
										</span>
										<span className="tabular-nums">{s.snapshot_rows} rows in snapshot</span>
									</div>
									{s.last_sync_error && (
										<p className="mt-1 text-xs text-red-600 dark:text-red-400 break-words">{s.last_sync_error}</p>
									)}
								</div>
								<div className="flex items-center gap-1 shrink-0">
									<Link
										href={`/data/spreadsheets?tab=snapshots&source=${s.id}`}
										className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
									>
										<Table2 className="w-3.5 h-3.5" />
										Snapshot
									</Link>
									<a
										href={`https://docs.google.com/spreadsheets/d/${s.google_sheet_id}`}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md text-primary-600 dark:text-primary-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
									>
										Open in Google Sheets
										<ExternalLink className="w-3 h-3" />
									</a>
									{canManage && (
										<>
											<Button variant="outline" size="sm" onClick={() => syncOne(s.id)} loading={busy} disabled={pending}>
												<RefreshCw className="w-3.5 h-3.5" />
												Sync now
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => remove(s)}
												disabled={pending}
												aria-label={`Disconnect ${s.display_name}`}
												title="Disconnect"
											>
												<Trash2 className="w-3.5 h-3.5" />
											</Button>
										</>
									)}
								</div>
							</div>
						</Card>
					);
				})}
			</div>
		</div>
	);
}
