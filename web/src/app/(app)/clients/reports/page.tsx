import ComingSoon from '@/components/ui/ComingSoon';
import { FileText } from 'lucide-react';

export default function Page() {
	return (
		<ComingSoon
			section="Clients"
			title="Reports"
			subtitle="Activity reports + monthly recaps"
			icon={FileText}
			description="Generated PR activity reports per client — monthly delivery summary, placements, ROI."
			features={[
				{ label: 'Auto-generated monthly activity report', status: 'planned' },
				{ label: 'PDF + PPTX export', status: 'planned' },
				{ label: 'Schedule send to client POC', status: 'planned' },
				{ label: 'Per-month archive', status: 'in-progress' },
			]}
			source="Client Media · Activity Reports table · Report Runs"
		/>
	);
}
