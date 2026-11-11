// Everyone linked to the deal's brand or company, plus the parent company
// (moved out of page.tsx; spec 2026-10-20 §4.1 keeps it in Prep so the header's
// single contact doesn't hide the rest).

import Link from 'next/link';
import Card from '@/components/ui/Card';
import ScanAiButton from '../../ScanAiButton';
import { PERSON_ROLE_LABELS, type CompanyRow, type PersonLinkRow, type PersonRow } from '@/lib/revenue/shared';

function PersonLine({ id, name, title, email, role, primary }: { id: string; name: string; title: string | null; email: string | null; role: string | null; primary: boolean }) {
	return (
		<div className="flex items-start gap-2 text-xs">
			<div className="min-w-0 flex-1">
				<Link href={`/prospects/people/${id}`} className="font-medium text-slate-900 hover:underline dark:text-slate-100">
					{name}
				</Link>
				{primary && <span className="ml-1 text-2xs text-primary-700 dark:text-primary-300">primary</span>}
				<div className="truncate text-slate-500">{[role, title, email].filter(Boolean).join(' · ') || '—'}</div>
			</div>
			<ScanAiButton target="person" id={id} variant="link" className="shrink-0 pt-0.5" />
		</div>
	);
}

export default function PeopleCard({ brandId, person, people, company }: { brandId: string | null; person: PersonRow | null; people: (PersonLinkRow & { person: PersonRow | null })[]; company: CompanyRow | null }) {
	return (
		<Card className="space-y-2 text-sm">
			<div className="flex items-center justify-between">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">People</h2>
				{brandId && (
					<Link href={`/prospects/brands/${brandId}`} className="text-2xs text-primary-700 hover:underline dark:text-primary-300">
						Brand page
					</Link>
				)}
			</div>
			{people.length === 0 && !person && <p className="text-xs text-slate-500">No people linked yet.</p>}
			{people.length === 0 && person && <PersonLine name={person.display_name} title={person.title} email={person.email} id={person.id} role={null} primary />}
			{people.map((l) => (l.person ? <PersonLine key={l.id} name={l.person.display_name} title={l.person.title} email={l.person.email} id={l.person.id} role={PERSON_ROLE_LABELS[l.role]} primary={l.is_primary} /> : null))}
			{company && (
				<div className="pt-1 text-xs text-slate-500">
					Company: <span className="text-slate-700 dark:text-slate-300">{company.name}</span>
					{company.domain && <span> · {company.domain}</span>}
				</div>
			)}
		</Card>
	);
}
