// Shown to a signed-in account that is not internal staff (0118): clients
// and external users are never assessed and never see results.

import Card from '@/components/ui/Card';
import { Lock } from 'lucide-react';

export default function NotStaffCard() {
	return (
		<Card>
			<div className="text-center py-12 text-slate-500">
				<Lock className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
				<p className="text-sm">Calibration is for Open Ronin staff accounts.</p>
			</div>
		</Card>
	);
}
