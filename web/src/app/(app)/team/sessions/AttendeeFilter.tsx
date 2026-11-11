'use client';

// "Select by person" filter for /team/sessions: narrows the calls list to
// sessions where the chosen profile is an attendee (?person=<profile id>).
// Everything else in the URL (month, type, tab) is preserved; the page is
// reset because the filtered set has its own page count.

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import Select from '@/components/ui/Select';

export interface AttendeeOption {
	id: string;
	label: string;
}

export default function AttendeeFilter({ people, selected }: { people: AttendeeOption[]; selected: string | null }) {
	const router = useRouter();
	const params = useSearchParams();
	const [pending, startTransition] = useTransition();

	function change(value: string) {
		const next = new URLSearchParams(params.toString());
		if (value) next.set('person', value);
		else next.delete('person');
		next.delete('p');
		startTransition(() => router.replace(`/team/sessions?${next.toString()}`));
	}

	return (
		<Select
			size="sm"
			aria-label="Filter sessions by attendee"
			value={selected ?? ''}
			disabled={pending}
			onChange={(e) => change(e.target.value)}
			className="min-w-40"
		>
			<option value="">All attendees</option>
			{people.map((p) => (
				<option key={p.id} value={p.id}>
					{p.label}
				</option>
			))}
		</Select>
	);
}
