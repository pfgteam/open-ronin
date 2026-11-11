import ComingSoon from '@/components/ui/ComingSoon';
import { Inbox } from 'lucide-react';

export default function Page() {
	return (
		<ComingSoon
			section="Media"
			title="Requests"
			subtitle="Inbound media requests"
			icon={Inbox}
			description="HARO-style inbound feed — journalists requesting sources. Auto-matched to clients by topic."
			features={[
				{ label: 'Live inbound queue from Qwoted / HARO / Source of Sources', status: 'data-needed' },
				{ label: 'Auto-tag to relevant clients by topic match', status: 'planned' },
				{ label: 'Assign to publicist + draft response', status: 'planned' },
				{ label: 'Response SLA tracking', status: 'planned' },
			]}
			source="Qwoted · Connectively (HARO) · Source of Sources"
		/>
	);
}
