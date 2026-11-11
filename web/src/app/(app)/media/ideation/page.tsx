import ComingSoon from '@/components/ui/ComingSoon';
import { Lightbulb } from 'lucide-react';

export default function Page() {
	return (
		<ComingSoon
			section="Media"
			title="Pitch Ideation"
			subtitle="AI-assisted pitch angle brainstorming"
			icon={Lightbulb}
			description="Pitch lab where publicists workshop angles — fed by client message house, awareness days, trending topics."
			features={[
				{ label: 'AI-suggested angles per client + season', status: 'planned' },
				{ label: 'Awareness Days proactive picks (60-day rule)', status: 'planned' },
				{ label: 'Trending topic pickup from news', status: 'planned' },
				{ label: 'Save angle → seed Send Pitch flow', status: 'planned' },
			]}
			source="Ollama (on-prem) · Awareness Days · Client Metrics message house"
		/>
	);
}
