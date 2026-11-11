// The Media Scraper's filter rail (0102) — the left quarter, same layout
// contract as ../lead-scraper/FilterRail.tsx: everything here describes the
// NEXT run, nothing re-fetches, only the Run button spends money.
//
// Three modes, one per media preset:
//   journalists  Google News by beat -> journalist + outlet rows with evidence
//   waterfall    name + outlet domain -> most-likely email
//   outlets      outlet websites -> newsroom mailboxes and socials
//
// A server component: forms post to server actions; mode tabs are Links.

import Link from 'next/link';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Checkbox from '@/components/ui/Checkbox';
import { Newspaper, Mail, Globe } from 'lucide-react';
import { inputClass, selectClass } from '@/app/(app)/team/_form';
import { estimateNewsJournalistsCostUsd, MAX_ARTICLES_PER_QUERY } from '@/lib/scrapers/newsJournalistsPreset';
import { estimateEmailWaterfallCostUsd } from '@/lib/scrapers/emailWaterfallPreset';
import { estimateOutletCrawlCostUsd, MAX_PAGES_PER_DOMAIN } from '@/lib/scrapers/outletCrawlPreset';
import { createNewsJournalistsJob, createEmailWaterfallJob, createOutletCrawlJob } from './actions';

export type MediaMode = 'journalists' | 'waterfall' | 'outlets';

const labelClass = 'block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1';
const hintClass = 'block text-2xs text-slate-600 dark:text-slate-400 mt-1';

function ModeTabs({ mode, jobQuery }: { mode: MediaMode; jobQuery: string }) {
	const tab = (active: boolean) =>
		`flex-1 px-2 py-2 text-2xs font-medium border-b-2 -mb-px transition-colors text-center ${
			active
				? 'border-primary-500 text-slate-900 dark:text-slate-100'
				: 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
		}`;
	const suffix = jobQuery ? `&${jobQuery}` : '';
	return (
		<div className="flex items-center mb-4 border-b border-slate-200 dark:border-slate-700 -mt-1">
			<Link href={`/media/media-scraper?mode=journalists${suffix}`} className={tab(mode === 'journalists')}>
				<Newspaper className="w-3 h-3 inline mr-1" /> Journalists
			</Link>
			<Link href={`/media/media-scraper?mode=waterfall${suffix}`} className={tab(mode === 'waterfall')}>
				<Mail className="w-3 h-3 inline mr-1" /> Find emails
			</Link>
			<Link href={`/media/media-scraper?mode=outlets${suffix}`} className={tab(mode === 'outlets')}>
				<Globe className="w-3 h-3 inline mr-1" /> Outlets
			</Link>
		</div>
	);
}

export default function MediaFilterRail({
	mode,
	jobQuery,
	defaultMaxResults,
	/** Preloaded from the selected run so "rerun this beat" is one click. */
	defaultQueries = [],
}: {
	mode: MediaMode;
	jobQuery: string;
	defaultMaxResults: number;
	defaultQueries?: string[];
}) {
	const sampleCost = estimateNewsJournalistsCostUsd({ queries: defaultQueries.length ? defaultQueries : ['beat'], maxArticlesPerQuery: MAX_ARTICLES_PER_QUERY }, defaultMaxResults);
	return (
		<>
			<ModeTabs mode={mode} jobQuery={jobQuery} />

			{mode === 'journalists' && (
				<form action={createNewsJournalistsJob} className="space-y-4">
					<p className="text-2xs text-slate-600 dark:text-slate-400 -mt-1">
						One Google News search per beat. Each article becomes a journalist row (or an outlet row
						when there is no byline) with the article as evidence.
					</p>

					<label className="block">
						<span className={labelClass}>Beats / topics</span>
						<textarea
							name="queries"
							rows={4}
							required
							placeholder={'sustainable packaging\nplant-based snacks\nclean beauty'}
							defaultValue={defaultQueries.join('\n')}
							className={inputClass}
						/>
						<span className={hintClass}>One per line, up to 20. Combine a category with a geography or angle for a tighter list.</span>
					</label>

					<div className="grid grid-cols-2 gap-2">
						<label className="block">
							<span className={labelClass}>Last N days</span>
							<input name="freshness_days" type="number" min={1} max={365} defaultValue={14} className={inputClass} />
						</label>
						<label className="block">
							<span className={labelClass}>Articles / beat</span>
							<input name="articles_per_query" type="number" min={1} max={MAX_ARTICLES_PER_QUERY} defaultValue={MAX_ARTICLES_PER_QUERY} className={inputClass} />
						</label>
					</div>

					<div className="grid grid-cols-2 gap-2">
						<label className="block">
							<span className={labelClass}>Country</span>
							<input name="country" defaultValue="US" maxLength={2} className={inputClass} />
						</label>
						<label className="block">
							<span className={labelClass}>Language</span>
							<select name="language" className={selectClass} defaultValue="en">
								<option value="en">English</option>
								<option value="es">Spanish</option>
								<option value="pt">Portuguese</option>
								<option value="fr">French</option>
								<option value="de">German</option>
							</select>
						</label>
					</div>

					<label className="block">
						<span className={labelClass}>Extra author / contact pages</span>
						<select name="extra_pages" className={selectClass} defaultValue="1">
							<option value="0">0 — article only (cheapest)</option>
							<option value="1">1 — author or contact page</option>
							<option value="2">2 — author + newsroom pages</option>
						</select>
					</label>

					<label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
						<Checkbox name="include_no_contact" defaultChecked />
						Keep journalists with no public email (use Find emails next)
					</label>

					<label className="block">
						<span className={labelClass}>Max rows</span>
						<input name="max_results" type="number" min={1} max={5000} defaultValue={defaultMaxResults} className={inputClass} />
					</label>

					<div className="space-y-2">
						<Button type="submit" className="w-full justify-center">
							<Newspaper className="w-3.5 h-3.5" /> Run search · ≈ ${sampleCost.toFixed(2)}
						</Button>
						<p className="text-2xs text-slate-600 dark:text-slate-400">
							$0.12 per run plus $0.0023 per row (up to 25 rows per beat). Cron picks the job up within
							~5 minutes, or press Run now.
						</p>
					</div>
				</form>
			)}

			{mode === 'waterfall' && (
				<form action={createEmailWaterfallJob} className="space-y-4">
					<p className="text-2xs text-slate-600 dark:text-slate-400 -mt-1">
						Name plus outlet domain in, most-likely email out (website scrape, pattern detection,
						Gravatar). Or press <strong>Find emails</strong> on a journalist run to queue everyone in it
						who is missing one.
					</p>
					<label className="block">
						<span className={labelClass}>People</span>
						<textarea
							name="people"
							rows={6}
							required
							placeholder={'Alex Rivera, example.com\nJane Doe, startup.io'}
							className={inputClass}
						/>
						<span className={hintClass}>One per line: First Last, domain. Up to 1,000.</span>
					</label>
					<label className="block">
						<span className={labelClass}>Beats to tag (optional)</span>
						<input name="beats" placeholder="sustainable packaging, clean beauty" className={inputClass} />
					</label>
					<label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
						<Checkbox name="check_github" />
						Also search GitHub commits (tech outlets only; slower)
					</label>
					<div className="space-y-2">
						<Button type="submit" className="w-full justify-center">
							<Mail className="w-3.5 h-3.5" /> Find emails
						</Button>
						<p className="text-2xs text-slate-600 dark:text-slate-400">
							$0.005 per person — 50 people ≈ ${estimateEmailWaterfallCostUsd(50).toFixed(2)}, 500 ≈ $
							{estimateEmailWaterfallCostUsd(500).toFixed(2)}.
						</p>
					</div>
				</form>
			)}

			{mode === 'outlets' && (
				<form action={createOutletCrawlJob} className="space-y-4">
					<p className="text-2xs text-slate-600 dark:text-slate-400 -mt-1">
						Crawls each outlet&apos;s contact, about, staff, masthead and newsroom pages for published
						mailboxes and social profiles. One row per outlet.
					</p>
					<label className="block">
						<span className={labelClass}>Outlet websites</span>
						<textarea name="websites" rows={6} required placeholder={'sfweekly.com\nesgdive.com\nsunset.com'} className={inputClass} />
						<span className={hintClass}>One per line or comma separated. Up to 1,000.</span>
					</label>
					<div className="grid grid-cols-2 gap-2">
						<label className="block">
							<span className={labelClass}>Pages per site</span>
							<input name="pages_per_domain" type="number" min={1} max={MAX_PAGES_PER_DOMAIN} defaultValue={6} className={inputClass} />
						</label>
						<label className="block">
							<span className={labelClass}>Beats to tag</span>
							<input name="beats" placeholder="optional" className={inputClass} />
						</label>
					</div>
					<label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
						<Checkbox name="include_phones" />
						Include phone numbers
					</label>
					<div className="space-y-2">
						<Button type="submit" className="w-full justify-center">
							<Globe className="w-3.5 h-3.5" /> Crawl outlets
						</Button>
						<p className="text-2xs text-slate-600 dark:text-slate-400">
							$0.002 per outlet — 100 ≈ ${estimateOutletCrawlCostUsd(100).toFixed(2)}. About 5 to 8 sites a
							minute at 6 pages each.
						</p>
					</div>
				</form>
			)}

			<Callout tone="info" className="mt-4">
				Approving a journalist creates or updates a Contact with the journalist role, the outlet in
				Media Outlets, and a media profile (beats, articles, email status). Nothing reaches Airtable.
			</Callout>
		</>
	);
}
