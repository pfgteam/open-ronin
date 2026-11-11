'use client';

// People on a brand / brands of a person, with the controls to tie more
// together. One card, two directions:
//   mode 'brand'  → lists the brand's people; "Add person" searches people
//   mode 'person' → lists the person's brands; "Link to brand" searches brands
// The add panel opens inline in the card (search → pick → role → primary).
// Any revenue viewer links and makes primary; Remove shows only to Prospects
// managers because RLS (0121) lets only them delete a link.

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { Plus, Star, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { controlFocus } from '@/components/ui/focus';
import { PERSON_ROLES, PERSON_ROLE_LABELS } from '@/lib/revenue/shared';
import { linkPerson, searchLinkTargets, setPrimaryLink, unlinkPerson } from './actions';

export interface LinkRow {
	id: string;
	person_id: string;
	/** null for a company-only link (person mode). */
	brand_id: string | null;
	/** The other side: the person's name (brand mode) or the brand's name (person mode). */
	label: string;
	href: string | null;
	sub: string | null;
	is_primary: boolean;
}

type Target = { id: string; label: string; sub: string | null };

export default function LinkPeopleCard({ mode, anchorId, links, canRemove, addProspectHref }: {
	mode: 'brand' | 'person';
	/** The brand id (brand mode) or the person id (person mode). */
	anchorId: string;
	links: LinkRow[];
	canRemove: boolean;
	/** Brand mode: where "not in Prospects yet" sends the rep. */
	addProspectHref?: string;
}) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [q, setQ] = useState('');
	const [results, setResults] = useState<Target[]>([]);
	const [searching, setSearching] = useState(false);
	const [picked, setPicked] = useState<Target | null>(null);
	const [role, setRole] = useState<string>('decision_maker');
	const [primary, setPrimary] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmId, setConfirmId] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const searchRef = useRef<HTMLInputElement>(null);
	const seq = useRef(0);

	const linkedIds = new Set(links.map((l) => (mode === 'brand' ? l.person_id : l.brand_id)).filter(Boolean) as string[]);
	const noun = mode === 'brand' ? 'person' : 'brand';

	// Debounced typeahead; a slower earlier answer never overwrites a newer one.
	useEffect(() => {
		if (!open || picked) return;
		const term = q.trim();
		if (term.length < 2) {
			setResults([]);
			setSearching(false);
			return;
		}
		const mine = ++seq.current;
		setSearching(true);
		const t = setTimeout(async () => {
			const r = await searchLinkTargets({ kind: mode === 'brand' ? 'person' : 'brand', q: term });
			if (mine !== seq.current) return;
			setResults(r);
			setSearching(false);
		}, 250);
		return () => clearTimeout(t);
	}, [q, open, picked, mode]);

	const openPanel = () => {
		setOpen(true);
		setError(null);
		setPrimary(mode === 'brand' && !links.some((l) => l.is_primary));
		setTimeout(() => searchRef.current?.focus(), 0);
	};
	const reset = () => {
		setOpen(false);
		setQ('');
		setResults([]);
		setPicked(null);
		setRole('decision_maker');
		setError(null);
	};

	const submit = () => {
		if (!picked) return;
		setError(null);
		start(async () => {
			const r = await linkPerson({
				person_id: mode === 'brand' ? picked.id : anchorId,
				brand_id: mode === 'brand' ? anchorId : picked.id,
				role,
				is_primary: primary,
			});
			if (!r.ok) return setError(r.error);
			reset();
			router.refresh();
		});
	};

	const makePrimary = (l: LinkRow) => {
		if (!l.brand_id) return;
		setError(null);
		setBusyId(l.id);
		start(async () => {
			const r = await setPrimaryLink({ id: l.id, person_id: l.person_id, brand_id: l.brand_id! });
			setBusyId(null);
			if (!r.ok) return setError(r.error);
			router.refresh();
		});
	};

	const remove = (l: LinkRow) => {
		setError(null);
		setBusyId(l.id);
		start(async () => {
			const r = await unlinkPerson({ id: l.id, person_id: l.person_id, brand_id: l.brand_id });
			setBusyId(null);
			setConfirmId(null);
			if (!r.ok) return setError(r.error);
			router.refresh();
		});
	};

	const visible = results.filter((r) => !linkedIds.has(r.id));

	return (
		<Card className="space-y-2 text-xs">
			<div className="flex items-center justify-between gap-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{mode === 'brand' ? 'People' : 'Brands and companies'}</h2>
				{!open && (
					<button type="button" onClick={openPanel} className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-primary-700 hover:bg-hover dark:text-primary-300', controlFocus)}>
						<Plus className="h-3.5 w-3.5" aria-hidden="true" />
						{mode === 'brand' ? 'Add person' : 'Link to brand'}
					</button>
				)}
			</div>

			{error && <Callout tone="error">{error}</Callout>}

			{links.length === 0 && !open && <p className="text-slate-500">{mode === 'brand' ? 'Nobody linked yet.' : 'Not linked to a brand yet.'}</p>}

			{links.map((l) => (
				<div key={l.id} className="group flex items-start gap-2">
					<div className="min-w-0 flex-1">
						{l.href ? (
							<Link href={l.href} className="font-medium text-slate-900 hover:underline dark:text-slate-100">{l.label}</Link>
						) : (
							<span className="font-medium text-slate-900 dark:text-slate-100">{l.label}</span>
						)}
						{l.is_primary && <span className="ml-1 text-2xs text-primary-700 dark:text-primary-300">primary</span>}
						{l.sub && <div className="truncate text-slate-500">{l.sub}</div>}
					</div>
					{confirmId === l.id ? (
						<span className="flex shrink-0 items-center gap-1">
							<span className="text-slate-600 dark:text-slate-400">Remove?</span>
							<Button type="button" variant="secondary" size="sm" onClick={() => remove(l)} loading={busyId === l.id}>Yes</Button>
							<Button type="button" variant="ghost" size="sm" onClick={() => setConfirmId(null)}>No</Button>
						</span>
					) : (
						<span className="flex shrink-0 items-center gap-0.5">
							{l.brand_id && !l.is_primary && (
								<button type="button" onClick={() => makePrimary(l)} disabled={busyId === l.id} title="Make primary contact" aria-label={`Make ${l.label} the primary contact`}
									className={clsx('rounded-md p-1 text-slate-400 hover:bg-hover hover:text-primary-700 disabled:opacity-50 dark:hover:text-primary-300', controlFocus)}>
									<Star className="h-3.5 w-3.5" aria-hidden="true" />
								</button>
							)}
							{canRemove && (
								<button type="button" onClick={() => setConfirmId(l.id)} title="Remove link" aria-label={`Remove ${l.label}`}
									className={clsx('rounded-md p-1 text-slate-400 hover:bg-hover hover:text-red-600 dark:hover:text-red-400', controlFocus)}>
									<X className="h-3.5 w-3.5" aria-hidden="true" />
								</button>
							)}
						</span>
					)}
				</div>
			))}

			{open && (
				<div className="space-y-2 rounded-md border border-slate-200 p-2 dark:border-slate-700">
					{!picked ? (
						<>
							<Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === 'brand' ? 'Search people by name or email' : 'Search brands by name or domain'}
								aria-label={`Search ${noun}s`} autoComplete="off" className="py-1.5 text-xs" />
							{searching && <p className="text-slate-500">Searching…</p>}
							{!searching && q.trim().length >= 2 && visible.length === 0 && (
								<p className="text-slate-500">
									No {noun} matches{results.length > visible.length ? ' that is not already linked' : ''}.
									{mode === 'brand' && addProspectHref && (
										<>
											{' '}
											<Link href={addProspectHref} className="text-primary-700 underline dark:text-primary-300">Add a new prospect on this brand</Link>
										</>
									)}
								</p>
							)}
							{visible.length > 0 && (
								<ul className="max-h-48 space-y-0.5 overflow-y-auto" role="listbox" aria-label={`Matching ${noun}s`}>
									{visible.map((r) => (
										<li key={r.id}>
											<button type="button" role="option" aria-selected="false" onClick={() => setPicked(r)} className={clsx('w-full rounded-md px-2 py-1 text-left hover:bg-hover', controlFocus)}>
												<span className="font-medium text-slate-900 dark:text-slate-100">{r.label}</span>
												{r.sub && <span className="block truncate text-slate-500">{r.sub}</span>}
											</button>
										</li>
									))}
								</ul>
							)}
						</>
					) : (
						<>
							<div className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1 dark:bg-slate-700/50">
								<span className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-slate-100">{picked.label}</span>
								<button type="button" onClick={() => setPicked(null)} className={clsx('text-primary-700 underline dark:text-primary-300', controlFocus)}>Change</button>
							</div>
							<Select label="Role at the brand" value={role} onChange={(e) => setRole(e.target.value)} className="py-1.5 text-xs">
								{PERSON_ROLES.map((r) => <option key={r} value={r}>{PERSON_ROLE_LABELS[r]}</option>)}
							</Select>
							<label className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
								<Checkbox checked={primary} onChange={(e) => setPrimary(e.target.checked)} />
								Primary contact for the brand
							</label>
						</>
					)}
					<div className="flex justify-end gap-2">
						<Button type="button" variant="ghost" size="sm" onClick={reset}>Cancel</Button>
						<Button type="button" size="sm" onClick={submit} disabled={!picked} loading={pending && !busyId}>
							{mode === 'brand' ? 'Add to brand' : 'Link'}
						</Button>
					</div>
				</div>
			)}
		</Card>
	);
}
