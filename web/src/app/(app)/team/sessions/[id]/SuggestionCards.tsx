'use client';

// Pending suggested-task cards on the call detail page (task 4's read-only
// rows cover accepted/dismissed ones; this component only ever receives
// status='pending' suggestions from the page).
//
// The Accept modal's open/closed state lives in the URL (?accept=<id>), the
// same convention ModalCard's other consumers use (EditFieldsModal,
// MetricsSection) — its own ESC/backdrop/close-button handlers call
// router.replace(closeHref) directly, so closing only works cleanly when
// that's the thing actually driving visibility.

import { useState, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Callout from '@/components/ui/Callout';
import ModalCard from '@/components/ui/ModalCard';
import { decideSuggestedTask } from './suggestionActions';

export interface PendingSuggestion {
	id: string;
	title: string;
	detail_md: string | null;
	suggested_owner_email: string | null;
}

export interface SuggestionOwner {
	id: string;
	name: string;
	email: string;
}

interface Props {
	suggestions: PendingSuggestion[];
	defaultOwnerId: string | null;
	owners: SuggestionOwner[];
	callId: string;
}

type Decided = { type: 'accepted'; taskId?: string } | { type: 'dismissed' };

export default function SuggestionCards({ suggestions, defaultOwnerId, owners }: Props) {
	const [decided, setDecided] = useState<Record<string, Decided>>({});

	if (suggestions.length === 0) {
		return <p className="text-sm text-slate-400">No suggested tasks from this analysis.</p>;
	}

	return (
		<div className="divide-y divide-slate-200 dark:divide-slate-700">
			{suggestions.map((s) => (
				<SuggestionCard
					key={s.id}
					suggestion={s}
					defaultOwnerId={defaultOwnerId}
					owners={owners}
					decided={decided[s.id] ?? null}
					onDecided={(d) => setDecided((prev) => ({ ...prev, [s.id]: d }))}
				/>
			))}
		</div>
	);
}

/** Suggested-owner display label: resolves to the matching internal
 *  attendee's name when there is one, otherwise falls back to the raw
 *  email — same rule the page's read-only rows use. */
function ownerLabel(email: string | null, owners: SuggestionOwner[]): string | null {
	if (!email) return null;
	const match = owners.find((o) => o.email.toLowerCase() === email.toLowerCase());
	return match?.name ?? email;
}

function SuggestionCard({
	suggestion,
	defaultOwnerId,
	owners,
	decided,
	onDecided,
}: {
	suggestion: PendingSuggestion;
	defaultOwnerId: string | null;
	owners: SuggestionOwner[];
	decided: Decided | null;
	onDecided: (d: Decided) => void;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [dismissPending, startDismiss] = useTransition();
	const [dismissError, setDismissError] = useState<string | null>(null);

	const isModalOpen = searchParams.get('accept') === suggestion.id;
	const openHref = `${pathname}?accept=${suggestion.id}`;

	function openModal() {
		router.push(openHref, { scroll: false });
	}

	function handleDismiss() {
		setDismissError(null);
		startDismiss(async () => {
			const result = await decideSuggestedTask({ suggestionId: suggestion.id, decision: 'dismiss' });
			if (!result.ok) {
				setDismissError(result.error);
				return;
			}
			onDecided({ type: 'dismissed' });
			router.refresh();
		});
	}

	if (decided?.type === 'accepted') {
		return (
			<div className="py-3 first:pt-0 last:pb-0">
				<p className="text-sm text-slate-700 dark:text-slate-300">
					Task created —{' '}
					{decided.taskId ? (
						<Link href={`/the-work/${decided.taskId}`} className="text-primary-600 hover:underline">
							view it
						</Link>
					) : (
						'view it in The Work'
					)}
					.
				</p>
			</div>
		);
	}

	if (decided?.type === 'dismissed') {
		return (
			<div className="py-3 first:pt-0 last:pb-0">
				<p className="text-sm text-slate-400">Dismissed.</p>
			</div>
		);
	}

	return (
		<div className="py-3 first:pt-0 last:pb-0">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-sm font-medium text-slate-800 dark:text-slate-200 break-words">{suggestion.title}</p>
					{suggestion.detail_md && (
						<p className="mt-1 text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words">
							{suggestion.detail_md}
						</p>
					)}
					<p className="mt-1 text-xs text-slate-500">
						Suggested owner: {ownerLabel(suggestion.suggested_owner_email, owners) ?? '—'}
					</p>
				</div>
				<div className="shrink-0 flex items-center gap-2">
					<Button variant="primary" size="sm" onClick={openModal}>
						Accept
					</Button>
					<Button variant="ghost" size="sm" onClick={handleDismiss} disabled={dismissPending}>
						Dismiss
					</Button>
				</div>
			</div>
			{dismissError && (
				<Callout tone="error" className="mt-2">
					{dismissError}
				</Callout>
			)}

			{isModalOpen && (
				<AcceptModal
					suggestion={suggestion}
					defaultOwnerId={defaultOwnerId}
					owners={owners}
					closeHref={pathname}
					onAccepted={(taskId) => {
						onDecided({ type: 'accepted', taskId });
						router.replace(pathname, { scroll: false });
						router.refresh();
					}}
				/>
			)}
		</div>
	);
}

function AcceptModal({
	suggestion,
	defaultOwnerId,
	owners,
	closeHref,
	onAccepted,
}: {
	suggestion: PendingSuggestion;
	defaultOwnerId: string | null;
	owners: SuggestionOwner[];
	closeHref: string;
	onAccepted: (taskId: string | undefined) => void;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [title, setTitle] = useState(suggestion.title);
	const [endsAt, setEndsAt] = useState('');

	// Resolve the suggested owner among this call's internal attendees by
	// email; fall back to the page's default (first internal attendee), then
	// to no selection at all (never guess).
	const suggestedMatch = suggestion.suggested_owner_email
		? owners.find((o) => o.email.toLowerCase() === suggestion.suggested_owner_email!.toLowerCase())
		: undefined;
	const [ownerId, setOwnerId] = useState(suggestedMatch?.id ?? defaultOwnerId ?? '');

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		startTransition(async () => {
			const result = await decideSuggestedTask({
				suggestionId: suggestion.id,
				decision: 'accept',
				title,
				ownerId: ownerId || undefined,
				endsAt: endsAt || null,
			});
			if (!result.ok) {
				setError(result.error);
				return;
			}
			onAccepted(result.taskId);
		});
	}

	return (
		<ModalCard title="Create task" subtitle={suggestion.detail_md ?? undefined} closeHref={closeHref}>
			<form onSubmit={handleSubmit} className="space-y-4">
				<Input
					label="Title"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					required
				/>
				<Select
					label="Owner"
					value={ownerId}
					onChange={(e) => setOwnerId(e.target.value)}
					required
				>
					<option value="" disabled>
						Select an owner…
					</option>
					{owners.map((o) => (
						<option key={o.id} value={o.id}>
							{o.name}
						</option>
					))}
				</Select>
				<Input
					label="Due date"
					type="date"
					value={endsAt}
					onChange={(e) => setEndsAt(e.target.value)}
				/>
				{error && <Callout tone="error">{error}</Callout>}
				<div className="flex items-center justify-end gap-2">
					<Button
						type="button"
						variant="ghost"
						onClick={() => router.replace(closeHref, { scroll: false })}
					>
						Cancel
					</Button>
					<Button type="submit" variant="primary" loading={pending}>
						Create task
					</Button>
				</div>
			</form>
		</ModalCard>
	);
}
