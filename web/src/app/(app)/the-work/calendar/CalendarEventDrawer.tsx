'use client';

// Right-side drawer for creating + editing calendar events. Mirrors the
// look of WorkItemDrawer for consistency across the section.
//
// Triggered by:
//   - Top-right "Add event" button (mode='create', no defaults)
//   - Clicking an empty time slot (mode='create', pre-filled with slot time)
//   - Clicking an existing event (mode='edit', pre-filled with event data)
//
// Has a "Link to a task" combobox so the user can attach the event to a
// work_item — that work_item's id goes into calendar_events.project_id
// (after 0009, "tasks" live in `projects` with kind='task').

import { useEffect, useState, useTransition } from 'react';
import { X, Trash2, Link2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useToast, UNDO_WINDOW_MS } from '@/components/ui/Toast';
import { upsertCalendarEvent, deleteCalendarEvent } from './actions';

export interface EventDraft {
	id?: string;
	title?: string;
	description_md?: string | null;
	starts_at?: string;
	ends_at?: string;
	all_day?: boolean;
	category_key?: string | null;
	location?: string | null;
	url?: string | null;
	project_id?: string | null;
	airtable_contract_id?: string | null;
	attendee_external?: string[];
	visibility?: string | null;          // 'default' = visible to teammates | 'private' = masked to non-owners
}

interface TaskOption { id: string; name: string; kind: string }
interface Category { key: string; label: string; color: string | null }

interface Props {
	open: boolean;
	mode: 'create' | 'edit';
	draft: EventDraft | null;
	categories: Category[];
	taskOptions: TaskOption[];                // user's open assigned tasks for the link dropdown
	onClose: () => void;
	onSaved?: () => void;
	// Called BEFORE the delete action awaits — caller can do optimistic UI
	// (hide the event in the grid immediately + close drawer). The handler
	// is async-aware: it can return a rollback callback that gets invoked
	// if the server-side delete fails.
	onOptimisticDelete?: (id: string) => (() => void) | void;
}

export default function CalendarEventDrawer({
	open, mode, draft, categories, taskOptions, onClose, onSaved, onOptimisticDelete,
}: Props) {
	const [pending, startTransition] = useTransition();
	const { toast, undoWindow } = useToast();
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	// Date + time split so each field is its own picker. ISO assembled on save.
	const [startDate, setStartDate] = useState('');
	const [startTime, setStartTime] = useState('');
	const [endDate, setEndDate] = useState('');
	const [endTime, setEndTime] = useState('');
	const [allDay, setAllDay] = useState(false);
	const [categoryKey, setCategoryKey] = useState('');
	const [location, setLocation] = useState('');
	const [taskId, setTaskId] = useState('');
	const [isPrivate, setIsPrivate] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Reset form whenever drawer reopens with a new draft
	useEffect(() => {
		if (!open) return;
		setTitle(draft?.title ?? '');
		setDescription(draft?.description_md ?? '');
		const sd = parseIso(draft?.starts_at);
		const ed = parseIso(draft?.ends_at);
		setStartDate(sd.date);
		setStartTime(sd.time);
		setEndDate(ed.date);
		setEndTime(ed.time);
		setAllDay(draft?.all_day ?? false);
		setCategoryKey(draft?.category_key ?? '');
		setLocation(draft?.location ?? '');
		setTaskId(draft?.project_id ?? '');
		setIsPrivate(draft?.visibility === 'private');
		setError(null);
	}, [open, draft]);

	// ESC to close
	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, onClose]);

	if (!open) return null;

	function handleSave() {
		const t = title.trim();
		if (!t) { setError('Title is required.'); return; }
		if (!startDate || !startTime || !endDate || !endTime) { setError('Start and end date/time are required.'); return; }
		const startIso = new Date(`${startDate}T${startTime}`).toISOString();
		const endIso = new Date(`${endDate}T${endTime}`).toISOString();
		if (new Date(endIso) <= new Date(startIso)) { setError('End must be after start.'); return; }
		setError(null);
		startTransition(async () => {
			const res = await upsertCalendarEvent({
				id: draft?.id,
				title: t,
				description_md: description || null,
				starts_at: startIso,
				ends_at: endIso,
				all_day: allDay,
				category_key: categoryKey || null,
				location: location || null,
				project_id: taskId || null,
				visibility: isPrivate ? 'private' : 'default',
			});
			if (!res.ok) { setError(res.error); return; }
			if (onSaved) onSaved();
			onClose();
		});
	}

	function handleDelete() {
		if (!draft?.id) return;
		const id = draft.id;
		const label = draft.title?.trim() || 'event';

		// House rule (ui/Toast): undo window instead of a confirm() dialog.
		// deleteCalendarEvent is NOT reversible — it drops the row and fans the
		// delete out to Google — so the undo cannot restore afterwards. Instead
		// the commit is DEFERRED to the end of the window: hide the event now,
		// fire the real delete only when the window closes untouched, and let
		// Undo cancel it before it ever runs.
		const rollback = onOptimisticDelete?.(id);
		onClose();

		let cancelled = false;
		const timer = setTimeout(async () => {
			if (cancelled) return;
			const res = await deleteCalendarEvent(id);
			if (!res.ok) {
				if (typeof rollback === 'function') rollback();
				toast({ message: `Could not delete ${label}: ${res.error}`, variant: 'error' });
			}
			if (onSaved) onSaved();
		}, UNDO_WINDOW_MS);

		undoWindow({
			message: `Deleting “${label}”`,
			committedMessage: `Deleted “${label}”`,
			undo: () => {
				cancelled = true;
				clearTimeout(timer);
				if (typeof rollback === 'function') rollback();
			},
		});
	}

	return (
		<div className="fixed inset-0 z-40">
			<div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
			<div className="absolute right-0 top-0 h-full w-full max-w-[440px] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-panel overflow-y-auto">
				<div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 py-2.5 flex items-center justify-between">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
						{mode === 'edit' ? 'Edit event' : 'New event'}
					</h2>
					<button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700/45 transition-colors" aria-label="Close">
						<X className="w-4 h-4" />
					</button>
				</div>

				<div className="p-4 space-y-3">
					<div>
						<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Title *</label>
						<Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is this?" autoFocus />
					</div>

					<div className="grid grid-cols-[1fr_100px] gap-2">
						<div>
							<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Start date *</label>
							<input
								type="date"
								value={startDate}
								onChange={(e) => setStartDate(e.target.value)}
								className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
							/>
						</div>
						<div>
							<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Time</label>
							<input
								type="time"
								step={300}
								value={startTime}
								onChange={(e) => setStartTime(e.target.value)}
								disabled={allDay}
								className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
							/>
						</div>
					</div>
					<div className="grid grid-cols-[1fr_100px] gap-2">
						<div>
							<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">End date *</label>
							<input
								type="date"
								value={endDate}
								onChange={(e) => setEndDate(e.target.value)}
								className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
							/>
						</div>
						<div>
							<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Time</label>
							<input
								type="time"
								step={300}
								value={endTime}
								onChange={(e) => setEndTime(e.target.value)}
								disabled={allDay}
								className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
							/>
						</div>
					</div>

					<div className="flex items-center gap-4">
						<label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
							<input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
							All day
						</label>
						<label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400" title="Teammates see the time block but the title is masked as 'Private'.">
							<input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
							Private (mask title for teammates)
						</label>
					</div>

					<div className="grid grid-cols-2 gap-2">
						<div>
							<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Category</label>
							<select
								value={categoryKey}
								onChange={(e) => setCategoryKey(e.target.value)}
								className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
							>
								<option value="">— Uncategorized</option>
								{categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
							</select>
						</div>
						<div>
							<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Location</label>
							<Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" />
						</div>
					</div>

					{/* Task link — the primary "this event = working on X" affordance */}
					<div>
						<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block inline-flex items-center gap-1">
							<Link2 className="w-3 h-3" /> Link to task
						</label>
						<select
							value={taskId}
							onChange={(e) => setTaskId(e.target.value)}
							className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
						>
							<option value="">— Not linked</option>
							{taskOptions.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name} {t.kind !== 'task' ? `(${t.kind})` : ''}
								</option>
							))}
						</select>
						<p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">
							Linking marks this time as work on the task — used for time tracking + AI attribution.
						</p>
					</div>

					<div>
						<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Notes</label>
						<textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={3}
							className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
						/>
					</div>

					{error && (
						<div className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md px-2 py-1.5">
							{error}
						</div>
					)}

					<div className="flex items-center justify-between pt-1">
						{mode === 'edit' && draft?.id ? (
							<button
								type="button"
								onClick={handleDelete}
								disabled={pending}
								className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700 px-2 py-1 transition-colors"
							>
								<Trash2 className="w-3 h-3" /> Delete
							</button>
						) : <span />}
						<div className="flex items-center gap-2">
							<Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
							<Button onClick={handleSave} loading={pending}>
								{pending ? 'Saving…' : (mode === 'create' ? 'Create event' : 'Save')}
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function parseIso(iso?: string | null): { date: string; time: string } {
	if (!iso) return { date: '', time: '' };
	const d = new Date(iso);
	const pad = (n: number) => n.toString().padStart(2, '0');
	return {
		date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
		time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
	};
}
