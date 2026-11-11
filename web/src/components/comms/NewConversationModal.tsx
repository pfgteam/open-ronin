'use client';

// Small create forms for the rail's "New channel" / "New DM" buttons. Local
// state rather than ModalCard's URL-driven open/close: the chat page already
// owns ?c= and a second query param for a transient form isn't worth it.

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Checkbox from '@/components/ui/Checkbox';
import { useToast } from '@/components/ui/Toast';
import { createConversation, listActiveProfiles } from '@/lib/comms/client';
import { profileName, type ProfileOption } from '@/lib/comms/types';
import { useAuthStore } from '@/stores/auth';
import Avatar from './Avatar';

interface Props {
	mode: 'channel' | 'dm';
	onClose: () => void;
	onCreated: (conversationId: string) => void;
}

function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
}

export default function NewConversationModal({ mode, onClose, onCreated }: Props) {
	const { toast } = useToast();
	const { user } = useAuthStore();
	const [title, setTitle] = useState('');
	const [isPrivate, setIsPrivate] = useState(false);
	const [filter, setFilter] = useState('');
	const [selected, setSelected] = useState<string[]>([]);
	const [profiles, setProfiles] = useState<ProfileOption[]>([]);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		void listActiveProfiles()
			.then((rows) => setProfiles(rows.filter((p) => p.id !== user?.id)))
			.catch(() => setProfiles([]));
	}, [user?.id]);

	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose();
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	const q = filter.trim().toLowerCase();
	const options = useMemo(
		() => profiles.filter((p) => !q || profileName(p).toLowerCase().includes(q) || p.email.toLowerCase().includes(q)),
		[profiles, q],
	);
	const selectedProfiles = profiles.filter((p) => selected.includes(p.id));

	function toggle(id: string) {
		setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
	}

	const canSave = mode === 'channel' ? title.trim().length > 0 : selected.length > 0;

	async function save() {
		if (!canSave || saving) return;
		setSaving(true);
		try {
			const id =
				mode === 'channel'
					? await createConversation({ kind: 'channel', title: title.trim(), slug: slugify(title), isPrivate, memberIds: selected })
					: await createConversation({
							kind: selected.length > 1 ? 'group' : 'dm',
							title: selectedProfiles.map(profileName).join(', '),
							memberIds: selected,
						});
			toast({ message: mode === 'channel' ? 'Channel created' : 'Conversation started' });
			onCreated(id);
		} catch (e) {
			toast({ message: e instanceof Error ? e.message : 'Could not create conversation', variant: 'error' });
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 overflow-y-auto">
			<div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
			<div
				role="dialog"
				aria-modal="true"
				aria-label={mode === 'channel' ? 'New channel' : 'New direct message'}
				className="relative w-full max-w-md bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-panel my-auto"
			>
				<div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
					<div>
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{mode === 'channel' ? 'New channel' : 'New direct message'}</h2>
						<p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">
							{mode === 'channel' ? 'Channels are open to the team unless marked private.' : 'Pick one person for a DM, or several for a group.'}
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="shrink-0 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/45 transition-colors"
					>
						<X className="w-4 h-4" />
					</button>
				</div>
				<div className="p-4 space-y-3">
					{mode === 'channel' && (
						<>
							<Input label="Name" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. design-reviews" autoFocus />
							{title && <p className="text-2xs text-slate-600 dark:text-slate-400 -mt-1">#{slugify(title) || '…'}</p>}
							<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
								<Checkbox checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
								Private (invite only)
							</label>
						</>
					)}
					<div>
						<p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{mode === 'channel' ? 'Invite people (optional)' : 'People'}</p>
						{selectedProfiles.length > 0 && (
							<div className="flex flex-wrap gap-1 mb-1.5">
								{selectedProfiles.map((p) => (
									<button
										key={p.id}
										type="button"
										onClick={() => toggle(p.id)}
										className="inline-flex items-center gap-1 rounded-full bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300 px-2 py-0.5 text-2xs hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors"
									>
										{profileName(p)} <X className="w-2.5 h-2.5" />
									</button>
								))}
							</div>
						)}
						<Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search people…" autoFocus={mode === 'dm'} />
						<ul className="mt-1 max-h-52 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700">
							{options.map((p) => {
								const on = selected.includes(p.id);
								return (
									<li key={p.id}>
										<button
											type="button"
											onClick={() => toggle(p.id)}
											className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${on ? 'bg-primary-50 dark:bg-primary-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-700/45'}`}
										>
											<Avatar name={profileName(p)} url={p.photo_url ?? p.avatar_url} size="sm" />
											<span className="min-w-0 flex-1">
												<span className="block text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{profileName(p)}</span>
												{p.title && <span className="block text-2xs text-slate-600 dark:text-slate-400 truncate">{p.title}</span>}
											</span>
										</button>
									</li>
								);
							})}
							{options.length === 0 && <li className="px-2.5 py-3 text-xs text-slate-400">No one matches.</li>}
						</ul>
					</div>
				</div>
				<div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200 dark:border-slate-700">
					<Button variant="ghost" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button size="sm" loading={saving} disabled={!canSave} onClick={() => void save()}>
						{mode === 'channel' ? 'Create channel' : 'Start'}
					</Button>
				</div>
			</div>
		</div>
	);
}
