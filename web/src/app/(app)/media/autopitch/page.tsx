import ComingSoon from '@/components/ui/ComingSoon';
import { Zap } from 'lucide-react';

export default function Page() {
	return (
		<ComingSoon
			section="Media"
			title="Autopitch"
			subtitle="Automated pitching pipeline (with human review)"
			icon={Zap}
			description="AI drafts pitches matched to targeted journalists, queued for human review before send. Three-step wizard per Function Map spec."
			features={[
				{ label: 'AI-drafted pitch matched to journalist + outlet', status: 'planned' },
				{ label: 'Mandatory human review step', status: 'planned' },
				{ label: 'Queue per publicist', status: 'planned' },
				{ label: 'Track open / reply / convert rate per template', status: 'planned' },
			]}
			source="Ollama · AWS SES · Cision · Build Lists"
			eta="v2 — needs AI integration"
		/>
	);
}
