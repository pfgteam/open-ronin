// Admin → Hiring → Onboarding (0134): the progressive-framework template
// (items per phase, owner, due day) and the DISC question bank. Read-only
// here — the template is seeded by the migration; edit items per plan on
// /team/onboarding/<person>, and change the seed with a migration so every
// future hire gets the same ladder.

import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import Link from 'next/link';
import type { OnboardingTemplateRow } from '@/lib/hiring/server';
import { ONBOARDING_KIND_LABELS, ONBOARDING_OWNER_LABELS, ONBOARDING_PHASES } from '@/lib/hiring/onboarding';

export default function OnboardingTab({ templates, discCount }: { templates: OnboardingTemplateRow[]; discCount: number }) {
	return (
		<div className="space-y-4">
			<Card className="space-y-1">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">How onboarding runs</h2>
				<p className="text-xs text-slate-600 dark:text-slate-400">
					Converting a hire creates a plan from this template (start = offer start, manager = offer manager). The hire is held out of calibration until day 60; the hiring cron lifts the hold and enrols them in the open cycle. Items bell their owner when overdue. The 60-Day Plan daily check-in form and the DISC questionnaire live on the plan page. Attendance policies: <Link href="/admin/attendance" className="text-primary-600 hover:underline">Admin → Attendance</Link>. Plans: <Link href="/team/onboarding" className="text-primary-600 hover:underline">Team → Onboarding</Link>.
				</p>
			</Card>
			{([1, 2, 3] as const).map((ph) => (
				<Card key={ph} padding="none">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{ONBOARDING_PHASES[ph].label}</h2>
						<span className="text-2xs text-slate-500">{ONBOARDING_PHASES[ph].days}</span>
					</div>
					<ul className="divide-y divide-slate-200 dark:divide-slate-700">
						{templates.filter((t) => t.phase === ph).map((t) => (
							<li key={t.key} className="px-3 py-2 text-sm">
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-medium text-slate-900 dark:text-slate-100">{t.label}</span>
									<Badge>{ONBOARDING_KIND_LABELS[t.kind] ?? t.kind}</Badge>
									<Badge color="primary">{ONBOARDING_OWNER_LABELS[t.owner_role] ?? t.owner_role}</Badge>
									{!t.is_active && <Badge color="warning">inactive</Badge>}
									<span className="text-2xs text-slate-500 ml-auto">day {t.window_from_day != null ? `${t.window_from_day}–` : ''}{t.due_day} · {t.employment.join(', ')}</span>
								</div>
								{t.description && <p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">{t.description}</p>}
							</li>
						))}
					</ul>
				</Card>
			))}
			<Card>
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">DISC question bank</h2>
				<p className="text-xs text-slate-600 dark:text-slate-400">{discCount} forced-choice groups (four adjectives, most / least like me). Scoring: per trait (most − least + n) / 4n, style = primary trait plus any trait at 25% or more. A DISC-style indicator we own, with no per-test fee (decision 2); a paid provider (Truity / Crystal / TTI) can be added behind the manual-entry path later.</p>
			</Card>
		</div>
	);
}
