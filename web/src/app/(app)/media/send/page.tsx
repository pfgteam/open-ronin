import ComingSoon from '@/components/ui/ComingSoon';
import { Send } from 'lucide-react';

export default function Page() {
	return (
		<ComingSoon
			section="Media"
			title="Send Pitch"
			subtitle="Manual pitch send + tracking"
			icon={Send}
			description="Three-step wizard: pick targets → draft + AI review → send. Always human-reviewed before going out."
			features={[
				{ label: 'Step 1: select journalist(s) or Build List', status: 'planned' },
				{ label: 'Step 2: AI pre-review (tone, length, fit)', status: 'planned' },
				{ label: 'Step 3: send via AWS SES + log to Media Opps', status: 'planned' },
				{ label: 'Track opens, replies, declines', status: 'planned' },
				{ label: 'Reply framework prompts when journalist responds', status: 'planned' },
			]}
			source="AWS SES · Media Contacts · Media Opportunities"
		/>
	);
}
