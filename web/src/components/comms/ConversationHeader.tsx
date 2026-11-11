'use client';

// Header for an open conversation: title/topic, participant stack with a
// popover listing everyone (agents marked with a Bot icon + blurb), and the
// membership actions (Add people / Add agent / Leave / Join).

import { useEffect, useRef, useState } from 'react';
import { Bot, Hash, Lock, LogOut, UserPlus, Users } from 'lucide-react';
import Button from '@/components/ui/Button';
import Popover from '@/components/ui/Popover';
import { useToast } from '@/components/ui/Toast';
import { addAgent, addMember, joinConversation, leaveConversation, listActiveProfiles, listAgents } from '@/lib/comms/client';
import { profileName, type Agent, type Conversation, type Participant, type ProfileOption } from '@/lib/comms/types';
import Avatar from './Avatar';

export function conversationTitle(c: Conversation): string {
	return c.title ?? c.slug ?? 'Untitled';
}

interface Props {
	conversation: Conversation;
	participants: Participant[];
	onMembershipChange: () => void;
}

export default function ConversationHeader({ conversation, participants, onMembershipChange }: Props) {
	const { toast } = useToast();
	const [peopleOpen, setPeopleOpen] = useState(false);
	const [addOpen, setAddOpen] = useState<'people' | 'agent' | null>(null);
	const [profiles, setProfiles] = useState<ProfileOption[] | null>(null);
	const [agents, setAgents] = useState<Agent[] | null>(null);
	const [filter, setFilter] = useState('');
	const [busy, setBusy] = useState(false);
	const peopleRef = useRef<HTMLButtonElement>(null);
	const addPeopleRef = useRef<HTMLButtonElement>(null);
	const addAgentRef = useRef<HTMLButtonElement>(null);

	// Lazy-load the pickers' option lists the first time a picker opens.
	useEffect(() => {
		if (addOpen === 'people' && profiles === null) void listActiveProfiles().then(setProfiles).catch(() => setProfiles([]));
		if (addOpen === 'agent' && agents === null) void listAgents().then(setAgents).catch(() => setAgents([]));
	}, [addOpen, profiles, agents]);

	const memberProfileIds = new Set(participants.filter((p) => p.profile_id).map((p) => p.profile_id));
	const memberAgentSlugs = new Set(participants.filter((p) => p.agent_identity_slug).map((p) => p.agent_identity_slug));
	const humans = participants.filter((p) => p.participant_type !== 'agent');
	const agentRows = participants.filter((p) => p.participant_type === 'agent');

	async function run(label: string, fn: () => Promise<unknown>) {
		setBusy(true);
		try {
			await fn();
			toast({ message: label });
			onMembershipChange();
		} catch (e) {
			toast({ message: e instanceof Error ? e.message : 'Something went wrong', variant: 'error' });
		} finally {
			setBusy(false);
		}
	}

	const q = filter.trim().toLowerCase();
	const profileOptions = (profiles ?? []).filter((p) => !memberProfileIds.has(p.id) && (!q || profileName(p).toLowerCase().includes(q) || p.email.toLowerCase().includes(q)));
	const agentOptions = (agents ?? []).filter((a) => !memberAgentSlugs.has(a.slug) && (!q || a.display_name.toLowerCase().includes(q) || a.slug.includes(q)));

	const KindIcon = conversation.kind === 'channel' ? (conversation.is_private ? Lock : Hash) : Users;

	return (
		<div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-slate-200 dark:border-slate-700">
			<KindIcon className="w-4 h-4 text-slate-400 shrink-0" />
			<div className="min-w-0 flex-1">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{conversationTitle(conversation)}</h2>
				{conversation.topic && <p className="text-2xs text-slate-600 dark:text-slate-400 truncate">{conversation.topic}</p>}
			</div>

			<button
				ref={peopleRef}
				type="button"
				onClick={() => setPeopleOpen((v) => !v)}
				className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/45 transition-colors"
				aria-label={`${participants.length} participants`}
			>
				<span className="flex -space-x-1.5">
					{participants.slice(0, 4).map((p) => (
						<Avatar key={p.id} name={p.display_name} url={p.avatar_url} isAgent={p.participant_type === 'agent'} size="xs" className="ring-2 ring-white dark:ring-slate-800" />
					))}
				</span>
				<span className="tabular-nums">{participants.length}</span>
			</button>
			<Popover open={peopleOpen} onClose={() => setPeopleOpen(false)} anchorRef={peopleRef} placement="bottom-end" width="w-80">
				<div className="py-1 max-h-96 overflow-y-auto">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
						Participants
					</div>
					{agentRows.length > 0 && (
						<ul className="py-1 border-b border-slate-200 dark:border-slate-700">
							{agentRows.map((p) => (
								<li key={p.id} className="px-3 py-1.5 flex items-start gap-2 hover:bg-hover transition-colors">
									<Avatar name={p.display_name} url={p.avatar_url} isAgent size="sm" />
									<div className="min-w-0 flex-1">
										<p className="text-xs font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1">
											{p.display_name ?? p.agent_identity_slug}
											<Bot className="w-3 h-3 text-accent-600" />
										</p>
										{p.subtitle && <p className="text-2xs text-slate-600 dark:text-slate-400 line-clamp-2">{p.subtitle}</p>}
									</div>
									{conversation.is_member && p.agent_identity_slug && (
										<button
											type="button"
											disabled={busy}
											onClick={() => void run('Agent removed', () => leaveConversation(conversation.id, p.agent_identity_slug))}
											className="text-2xs text-slate-600 dark:text-slate-400 hover:text-red-600 transition-colors"
										>
											Remove
										</button>
									)}
								</li>
							))}
						</ul>
					)}
					<ul className="py-1">
						{humans.map((p) => (
							<li key={p.id} className="px-3 py-1.5 flex items-center gap-2 hover:bg-hover transition-colors">
								<Avatar name={p.display_name} url={p.avatar_url} size="sm" />
								<div className="min-w-0">
									<p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{p.display_name ?? 'Unknown'}</p>
									{p.subtitle && <p className="text-2xs text-slate-600 dark:text-slate-400 truncate">{p.subtitle}</p>}
								</div>
							</li>
						))}
						{humans.length === 0 && <li className="px-3 py-3 text-xs text-slate-400">No people yet.</li>}
					</ul>
				</div>
			</Popover>

			{conversation.is_member ? (
				<>
					<span ref={addPeopleRef} className="inline-flex">
						<Button variant="outline" size="sm" onClick={() => { setFilter(''); setAddOpen(addOpen === 'people' ? null : 'people'); }}>
							<UserPlus className="w-3.5 h-3.5" /> Add people
						</Button>
					</span>
					<span ref={addAgentRef} className="inline-flex">
						<Button variant="outline" size="sm" onClick={() => { setFilter(''); setAddOpen(addOpen === 'agent' ? null : 'agent'); }}>
							<Bot className="w-3.5 h-3.5" /> Add agent
						</Button>
					</span>
					{conversation.kind !== 'dm' && (
						<Button variant="ghost" size="sm" disabled={busy} onClick={() => void run('Left conversation', () => leaveConversation(conversation.id))} aria-label="Leave">
							<LogOut className="w-3.5 h-3.5" />
						</Button>
					)}
				</>
			) : (
				<Button size="sm" loading={busy} onClick={() => void run('Joined', () => joinConversation(conversation.id))}>
					Join
				</Button>
			)}

			<Popover open={addOpen !== null} onClose={() => setAddOpen(null)} anchorRef={addOpen === 'agent' ? addAgentRef : addPeopleRef} placement="bottom-end" width="w-72">
				<div className="p-2">
					<input
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						placeholder={addOpen === 'agent' ? 'Search agents…' : 'Search people…'}
						className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400"
					/>
					<ul className="mt-1 max-h-64 overflow-y-auto">
						{addOpen === 'agent'
							? agentOptions.map((a) => (
									<li key={a.slug}>
										<button
											type="button"
											disabled={busy}
											onClick={() => void run(`${a.display_name} added`, () => addAgent(conversation.id, a.slug)).then(() => setAddOpen(null))}
											className="w-full flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/45 transition-colors"
										>
											<Avatar name={a.display_name} url={a.avatar_url} isAgent size="sm" />
											<span className="min-w-0">
												<span className="block text-xs font-medium text-slate-900 dark:text-slate-100">{a.display_name}</span>
												{a.blurb && <span className="block text-2xs text-slate-600 dark:text-slate-400 line-clamp-2">{a.blurb}</span>}
											</span>
										</button>
									</li>
								))
							: profileOptions.map((p) => (
									<li key={p.id}>
										<button
											type="button"
											disabled={busy}
											onClick={() => void run(`${profileName(p)} added`, () => addMember(conversation.id, p.id)).then(() => setAddOpen(null))}
											className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/45 transition-colors"
										>
											<Avatar name={profileName(p)} url={p.photo_url ?? p.avatar_url} size="sm" />
											<span className="min-w-0">
												<span className="block text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{profileName(p)}</span>
												{p.title && <span className="block text-2xs text-slate-600 dark:text-slate-400 truncate">{p.title}</span>}
											</span>
										</button>
									</li>
								))}
						{((addOpen === 'agent' && agents !== null && agentOptions.length === 0) || (addOpen === 'people' && profiles !== null && profileOptions.length === 0)) && (
							<li className="px-2 py-3 text-xs text-slate-400">Nothing to add.</li>
						)}
					</ul>
				</div>
			</Popover>
		</div>
	);
}
