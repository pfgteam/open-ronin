'use client';

// A page's contextual request button: opens "+ New" with one option
// preselected and the page's record as context (newMenuEvents.ts).

import { Send } from 'lucide-react';
import Button from '@/components/ui/Button';
import { openNewMenu, type NewMenuPreset } from './newMenuEvents';

export default function RequestButton({
	label,
	option,
	context,
	variant = 'secondary',
}: {
	label: string;
	option: string;
	context?: NewMenuPreset['context'];
	variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
}) {
	return (
		<Button size="sm" variant={variant} onClick={() => openNewMenu({ option, context })}>
			<Send className="w-3.5 h-3.5" aria-hidden="true" />
			{label}
		</Button>
	);
}
