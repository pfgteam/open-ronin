'use client';

// Client picker for /clients/analytics: a Select that navigates on change so
// the URL (?client=) stays the only view state (decision 3, URL params).

import { useRouter } from 'next/navigation';
import Select from '@/components/ui/Select';

interface Props {
	options: { value: string; label: string; family: string }[];
	value: string;
}

export default function ClientPicker({ options, value }: Props) {
	const router = useRouter();
	return (
		<Select
			size="sm"
			aria-label="Client"
			value={value}
			className="!w-64"
			onChange={(e) => {
				const v = e.target.value;
				router.push(v ? `/clients/analytics?client=${encodeURIComponent(v)}` : '/clients/analytics');
			}}
		>
			<option value="">Portfolio (all in scope)</option>
			{options.map((o) => (
				<option key={o.value} value={o.value}>
					{o.label} · {o.family}
				</option>
			))}
		</Select>
	);
}
