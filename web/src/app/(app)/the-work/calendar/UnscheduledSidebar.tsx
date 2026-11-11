'use client';

// Sidebar pool of unscheduled todos for the current user. Each row is
// a @dnd-kit draggable; the calendar grid is the drop zone. Dropping on
// a time slot calls scheduleTaskAt() to create a calendar_event linked
// to the task.
//
// "Unscheduled" = assigned to me + open status + no existing
// calendar_event with project_id pointing at this work_item.
//
// dnd-kit uses an internal auto-incrementing counter for aria-describedby
// IDs, which differs between SSR and client hydration → causes mismatch.
// We gate the draggable rendering behind a useMounted hook so dnd-kit
// only wires up after hydration. Pre-mount we render a static placeholder
// so the sidebar doesn't pop in.

import { useEffect, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { GripVertical, Calendar as CalIcon } from 'lucide-react';
import Link from 'next/link';

function useMounted() {
	const [mounted, setMounted] = useState(false);
	useEffect(() => { setMounted(true); }, []);
	return mounted;
}

export interface UnscheduledTask {
	id: string;
	name: string;
	kind: string;
	priority: string | null;
	ends_at: string | null;
	parent_name: string | null;
}

interface Props {
	tasks: UnscheduledTask[];
	collapsed?: boolean;
	onToggleCollapse?: () => void;
}

export default function UnscheduledSidebar({ tasks, collapsed }: Props) {
	if (collapsed) return null;

	const overdue = tasks.filter((t) => t.ends_at && new Date(t.ends_at) < startOfToday());
	const today = tasks.filter((t) => t.ends_at && sameDay(new Date(t.ends_at), new Date()));
	const upcoming = tasks.filter((t) => t.ends_at && new Date(t.ends_at) > endOfToday());
	const noDate = tasks.filter((t) => !t.ends_at);

	return (
		<aside className="w-64 shrink-0 border-l border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 overflow-y-auto">
			<div className="sticky top-0 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur px-3 py-2 border-b border-slate-200 dark:border-slate-700 z-10">
				<div className="flex items-center justify-between">
					<h3 className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-semibold">Unscheduled · {tasks.length}</h3>
				</div>
				<p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">Drag onto a time slot to schedule</p>
			</div>

			<div className="p-2 space-y-3">
				{overdue.length > 0 && <Section label="Overdue" tasks={overdue} accentClass="text-red-600 dark:text-red-400" />}
				{today.length > 0   && <Section label="Today"   tasks={today}   accentClass="text-amber-600 dark:text-amber-400" />}
				{upcoming.length > 0 && <Section label="Upcoming" tasks={upcoming} accentClass="text-slate-500" />}
				{noDate.length > 0   && <Section label="No due date" tasks={noDate} accentClass="text-slate-400" />}
				{tasks.length === 0 && (
					<div className="text-2xs text-slate-600 dark:text-slate-400 text-center py-8">
						<CalIcon className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700 mb-2" />
						Nothing unscheduled. Inbox zero.
					</div>
				)}
			</div>
		</aside>
	);
}

interface SectionProps { label: string; tasks: UnscheduledTask[]; accentClass: string }
function Section({ label, tasks, accentClass }: SectionProps) {
	return (
		<div>
			<div className={`text-2xs uppercase tracking-wide font-medium ${accentClass} px-1 mb-1`}>{label}</div>
			<ul className="space-y-1">
				{tasks.map((t) => <TaskChip key={t.id} task={t} />)}
			</ul>
		</div>
	);
}

function TaskChip({ task }: { task: UnscheduledTask }) {
	const mounted = useMounted();
	if (!mounted) return <TaskChipStatic task={task} />;
	return <TaskChipDraggable task={task} />;
}

function TaskChipStatic({ task }: { task: UnscheduledTask }) {
	// Server-rendered + initial client paint: no dnd-kit wiring → no aria-describedby
	// → no hydration mismatch. Replaced with the draggable version after mount.
	return (
		<li className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 group">
			<TaskChipContent task={task} />
		</li>
	);
}

function TaskChipDraggable({ task }: { task: UnscheduledTask }) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: `task:${task.id}`,
		data: { kind: 'unscheduled-task', taskId: task.id },
	});
	return (
		<li
			ref={setNodeRef}
			{...attributes}
			{...listeners}
			className={`rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 group cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-50' : ''}`}
		>
			<TaskChipContent task={task} />
		</li>
	);
}

function TaskChipContent({ task }: { task: UnscheduledTask }) {
	return (
		<div className="flex items-start gap-1.5">
			<GripVertical className="w-3 h-3 text-slate-300 dark:text-slate-700 mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
			<div className="flex-1 min-w-0">
				<Link
					href={`/the-work/${task.id}`}
					className="text-xs font-medium text-slate-900 dark:text-slate-100 hover:text-primary-600 leading-snug line-clamp-2 block transition-colors"
					onClick={(e) => e.stopPropagation()}
				>
					{task.name}
				</Link>
				<div className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
					<span>{task.kind}</span>
					{task.parent_name && <><span className="text-slate-300">·</span><span className="truncate">{task.parent_name}</span></>}
					{task.priority && <><span className="text-slate-300">·</span><span className={task.priority === 'urgent' ? 'text-red-500' : task.priority === 'high' ? 'text-amber-500' : ''}>{task.priority}</span></>}
				</div>
			</div>
		</div>
	);
}

function startOfToday(): Date { const d = new Date(); d.setHours(0,0,0,0); return d; }
function endOfToday(): Date   { const d = new Date(); d.setHours(23,59,59,999); return d; }
function sameDay(a: Date, b: Date): boolean {
	return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
