'use client';

// Markdown editor for proposing a new page or an edit. Plain textarea with a
// live preview tab (same renderer as the article), a change summary, and one
// submit that lands the work as a PENDING revision. No WYSIWYG on purpose:
// the approval flow shows a line diff, and diffs of markdown are readable.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Callout from '@/components/ui/Callout';
import { clsx } from 'clsx';
import { Eye, Pencil, Send } from 'lucide-react';
import WikiMarkdown from './WikiMarkdown';
import { slugify, type WikiPageRef } from '@/lib/wiki/wikilinks';
import type { ActionResult } from './actions';

interface Props {
	mode: 'create' | 'edit';
	spaceSlug: string;
	/** create: the target space id; edit: unused. */
	spaceId?: string;
	/** edit: the live page id. */
	pageId?: string;
	initialTitle: string;
	initialBody: string;
	/** create: pages in the space, offered as parent. */
	parentOptions?: { id: string; title: string }[];
	pages: WikiPageRef[];
	cancelHref: string;
	action: (formData: FormData) => Promise<ActionResult>;
}

const HELP = 'Markdown. Link other articles with [[Page Title]] or [[space/slug]]; a link to a page that does not exist yet shows red and offers to create it.';

export default function WikiEditor(p: Props) {
	const router = useRouter();
	const [title, setTitle] = useState(p.initialTitle);
	const [body, setBody] = useState(p.initialBody);
	const [reason, setReason] = useState('');
	const [parent, setParent] = useState('');
	const [tab, setTab] = useState<'write' | 'preview'>('write');
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	const dirty = title !== p.initialTitle || body !== p.initialBody;
	const slug = slugify(title);

	function submit() {
		setError(null);
		const fd = new FormData();
		fd.set('title', title);
		fd.set('body_md', body);
		fd.set('reason', reason);
		if (p.mode === 'create') {
			fd.set('space_id', p.spaceId ?? '');
			fd.set('space_slug', p.spaceSlug);
			fd.set('parent_page_id', parent);
		} else {
			fd.set('page_id', p.pageId ?? '');
		}
		startTransition(async () => {
			const res = await p.action(fd);
			if (!res.ok) {
				setError(res.error);
				return;
			}
			router.push(res.href ?? p.cancelHref);
		});
	}

	return (
		<div className="space-y-4">
			{error && <Callout tone="error">{error}</Callout>}

			<Card>
				<div className="space-y-3">
					<Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
					{p.mode === 'create' && (
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
							<div className="text-xs text-slate-500 dark:text-slate-400 self-end pb-2">
								Address: <span className="font-mono text-slate-700 dark:text-slate-300">/{p.spaceSlug}/{slug || '…'}</span>
							</div>
							{p.parentOptions && p.parentOptions.length > 0 && (
								<Select label="Parent page (optional)" value={parent} onChange={(e) => setParent(e.target.value)}>
									<option value="">None (top level)</option>
									{p.parentOptions.map((o) => (
										<option key={o.id} value={o.id}>
											{o.title}
										</option>
									))}
								</Select>
							)}
						</div>
					)}
				</div>
			</Card>

			<Card padding="none">
				<div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-700">
					<div className="flex items-center gap-1">
						<TabButton active={tab === 'write'} onClick={() => setTab('write')} icon={<Pencil className="w-3 h-3" />}>
							Write
						</TabButton>
						<TabButton active={tab === 'preview'} onClick={() => setTab('preview')} icon={<Eye className="w-3 h-3" />}>
							Preview
						</TabButton>
					</div>
					<span className="text-2xs text-slate-600 dark:text-slate-400 tabular-nums">{body.length.toLocaleString()} chars</span>
				</div>
				{tab === 'write' ? (
					<textarea
						value={body}
						onChange={(e) => setBody(e.target.value)}
						spellCheck
						placeholder={HELP}
						className={clsx(
							'w-full min-h-[28rem] p-3 font-mono text-sm leading-relaxed resize-y',
							'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500',
							'rounded-b-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500',
						)}
					/>
				) : (
					<div className="p-4 min-h-[28rem]">
						{body.trim() ? (
							<WikiMarkdown source={body} currentSpace={p.spaceSlug} pages={p.pages} />
						) : (
							<p className="text-sm text-slate-400">Nothing to preview yet.</p>
						)}
					</div>
				)}
			</Card>

			<Card>
				<div className="flex flex-col sm:flex-row sm:items-end gap-3">
					<div className="flex-1">
						<Input
							label="Summary of the change"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							maxLength={500}
							placeholder={p.mode === 'create' ? 'Why this page belongs in the wiki' : 'What changed and why'}
						/>
					</div>
					<div className="flex items-center gap-2 shrink-0">
						<Button type="button" variant="outline" size="md" onClick={() => router.push(p.cancelHref)} disabled={pending}>
							Cancel
						</Button>
						<Button type="button" size="md" onClick={submit} loading={pending} disabled={!dirty || !title.trim()}>
							<Send className="w-3.5 h-3.5" /> Submit for review
						</Button>
					</div>
				</div>
				<p className="text-2xs text-slate-600 dark:text-slate-400 mt-2">
					Changes go live after a wiki approver publishes them. You can withdraw a pending change from Recent changes.
				</p>
			</Card>
		</div>
	);
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={clsx(
				'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
				active
					? 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100'
					: 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/45',
			)}
		>
			{icon} {children}
		</button>
	);
}
