// Generic "coming soon" page for routes that have a slot in the nav but
// haven't been fully built yet. Keeps the IA navigable without 404s and
// makes it clear what the page will do once it ships.

import Card from '@/components/ui/Card';
import type { LucideIcon } from 'lucide-react';
import { Sparkles, Database, Clock } from 'lucide-react';

export interface ComingSoonFeature {
	label: string;
	description?: string;
	status?: 'planned' | 'in-progress' | 'data-needed';
}

interface ComingSoonProps {
	section: string; // e.g. "Projects"
	title: string; // e.g. "Calendar"
	subtitle?: string;
	description?: string;
	icon?: LucideIcon;
	features?: ComingSoonFeature[];
	source?: string; // e.g. "Airtable → Client Central → Payments"
	eta?: string;
}

const STATUS_STYLES: Record<string, string> = {
	planned: 'text-slate-400',
	'in-progress': 'text-amber-600 dark:text-amber-400',
	'data-needed': 'text-primary-600 dark:text-primary-400',
};

const STATUS_LABEL: Record<string, string> = {
	planned: 'planned',
	'in-progress': 'in progress',
	'data-needed': 'needs data',
};

export default function ComingSoon({
	section,
	title,
	subtitle,
	description,
	icon: Icon = Sparkles,
	features = [],
	source,
	eta,
}: ComingSoonProps) {
	return (
		<>
			<div className="mb-6">
				<p className="text-xs uppercase tracking-wide text-slate-400 mb-1">{section}</p>
				<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
					<Icon className="w-5 h-5 text-slate-400" />
					{title}
				</h1>
				{subtitle && (
					<p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
				)}
			</div>

			<Card className="border-dashed">
				{description && (
					<p className="text-sm text-slate-700 dark:text-slate-300 mb-4">{description}</p>
				)}

				{features.length > 0 && (
					<div>
						<p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
							What this page will do
						</p>
						<ul className="space-y-2 text-sm">
							{features.map((f, i) => (
								<li key={i} className="flex items-start gap-2">
									<span className="text-slate-300 mt-0.5">•</span>
									<div className="flex-1">
										<span className="text-slate-700 dark:text-slate-300">
											{f.label}
										</span>
										{f.description && (
											<span className="text-slate-500 dark:text-slate-400">
												{' — '}
												{f.description}
											</span>
										)}
										{f.status && (
											<span
												className={`ml-2 text-2xs uppercase tracking-wide ${STATUS_STYLES[f.status]}`}
											>
												{STATUS_LABEL[f.status]}
											</span>
										)}
									</div>
								</li>
							))}
						</ul>
					</div>
				)}

				{(source || eta) && (
					<div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
						{source && (
							<span className="inline-flex items-center gap-1">
								<Database className="w-3 h-3" />
								{source}
							</span>
						)}
						{eta && (
							<span className="inline-flex items-center gap-1">
								<Clock className="w-3 h-3" />
								{eta}
							</span>
						)}
					</div>
				)}
			</Card>
		</>
	);
}
