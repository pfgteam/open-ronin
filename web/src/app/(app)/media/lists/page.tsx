import ComingSoon from '@/components/ui/ComingSoon';
import { ListChecks } from 'lucide-react';

export default function Page() {
	return (
		<ComingSoon
			section="Media"
			title="Build Lists"
			subtitle="Targeted media lists for upcoming pitches"
			icon={ListChecks}
			description="Build, save, and re-use journalist + outlet lists for specific pitches or campaigns."
			features={[
				{ label: 'Create list from filter (beat, outlet tier, geo)', status: 'planned' },
				{ label: 'Add/remove journalists ad-hoc', status: 'planned' },
				{ label: 'Save + share with team', status: 'planned' },
				{ label: 'Use list as Send Pitch target', status: 'planned' },
			]}
			source="Media Outlets · Media Contacts · Cision"
		/>
	);
}
