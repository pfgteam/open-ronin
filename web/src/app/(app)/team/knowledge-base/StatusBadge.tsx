import Badge from '@/components/ui/Badge';
import type { RevisionStatus } from '@/lib/wiki/_lib';

const map: Record<RevisionStatus, { color: 'warning' | 'success' | 'danger'; label: string }> = {
	pending: { color: 'warning', label: 'Pending' },
	approved: { color: 'success', label: 'Published' },
	rejected: { color: 'danger', label: 'Rejected' },
};

export default function StatusBadge({ status }: { status: RevisionStatus }) {
	const m = map[status] ?? map.pending;
	return (
		<Badge color={m.color} className="text-2xs shrink-0">
			{m.label}
		</Badge>
	);
}
