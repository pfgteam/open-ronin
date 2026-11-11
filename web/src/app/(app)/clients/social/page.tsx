import ComingSoon from '@/components/ui/ComingSoon';
import { Headphones } from 'lucide-react';

export default function Page() {
	return (
		<ComingSoon
			section="Clients"
			title="Social Listening"
			subtitle="Brand-mention monitoring per client"
			icon={Headphones}
			description="Aggregated mentions, sentiment, and conversation volume across web + social for each client."
			features={[
				{ label: 'Mention feed by client', status: 'planned' },
				{ label: 'Sentiment trend (12-week)', status: 'planned' },
				{ label: 'Share-of-voice vs competitors', status: 'planned' },
				{ label: 'Auto-alerts for negative sentiment spikes', status: 'planned' },
			]}
			source="Cision · Google Alerts · social platforms (TBD)"
		/>
	);
}
