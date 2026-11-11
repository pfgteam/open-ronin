'use client';

// Search box on the wiki home. Submits as ?q= so the server page runs the
// query (RLS-scoped) and the URL is shareable.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import SearchInput from '@/components/ui/SearchInput';

export default function WikiSearch({ initial }: { initial: string }) {
	const router = useRouter();
	const [value, setValue] = useState(initial);
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				const q = value.trim();
				router.push(q ? `/team/knowledge-base?q=${encodeURIComponent(q)}` : '/team/knowledge-base');
			}}
		>
			<SearchInput
				placeholder="Search wiki..."
				aria-label="Search wiki"
				className="w-64"
				value={value}
				onChange={(e) => setValue(e.target.value)}
			/>
		</form>
	);
}
