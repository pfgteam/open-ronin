// The filter rail — the left quarter of the Apollo layout.
//
// Everything here describes the NEXT search. It never re-fetches on change and
// never touches the results column: the only thing that runs a search is the
// Run button. That separation is the point of the layout — the operator reads
// one dataset while composing the next.
//
// Both forms post to the SAME unchanged server actions (createJob /
// createTradeShowJob) with the same field names they always had. This file
// moved them and gave every control a defaultValue; it did not change the
// contract with the actions.
//
// A server component: forms post to server actions, and the mode tabs are
// Links, so there is no client state to hold.

import Link from 'next/link';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Checkbox from '@/components/ui/Checkbox';
import { Search, Store, Linkedin, Building2 } from 'lucide-react';
import { inputClass, selectClass } from '@/app/(app)/team/_form';
import {
	COMPANY_SIZE,
	EMAIL_STATUS,
	FUNCTION_AREA,
	INDUSTRY,
	LOCATION,
	REVENUE,
	SENIORITY,
	estimateCostUsd,
} from '@/lib/scrapers/leadPreset';
import { estimateTradeShowCostUsd } from '@/lib/scrapers/tradeShowPreset';
import {
	COMPANY_HEADCOUNT as LI_HEADCOUNT,
	FUNCTION_AREA as LI_FUNCTION_AREA,
	INDUSTRY as LI_INDUSTRY,
	LINKEDIN_MAX_PER_QUERY,
	PROFILES_PER_SEARCH_PAGE,
	SENIORITY as LI_SENIORITY,
	YEARS_EXPERIENCE as LI_YEARS_EXPERIENCE,
	estimateCostUsd as estimateLinkedinCostUsd,
} from '@/lib/scrapers/linkedinPreset';
import { createJob, createTradeShowJob, createLinkedinJob, createAcquisitionJob } from './actions';
import { label } from './jobDisplay';
import type { LeadFilters } from '@/lib/scrapers/filterParams';
import {
	ACQUISITION_LOCATIONS,
	DEFAULT_EMPLOYEE_MAX,
	DEFAULT_EMPLOYEE_MIN,
	SERVICES,
	TITLE_SET,
	estimateAcquisitionCostUsd,
} from '@/lib/scrapers/acquisitionPreset';

/** The rail's modes. A named union rather than the boolean this used to
 *  be: two modes fit in a boolean, three do not, and the alternative was a
 *  second boolean prop beside the first. Maps to `?mode=`, where anything
 *  unrecognised falls back to 'search'. 'acquisition' (0060) renders only
 *  for holders of the acquisitions capability. */
export type ScrapeMode = 'search' | 'show' | 'linkedin' | 'acquisition';

/** Which tab families the viewer may see. Decided by capability in the page
 *  and passed down, never inferred from role here. */
export interface RailAccess {
	leads: boolean;
	acquisitions: boolean;
}

/** One option: either a bare string (the B2B/trade-show presets, prettified
 *  via `label()`) or a `{value,label}` pair (the LinkedIn presets, which are
 *  LinkedIn's own ids and must post the id, not the display text). */
type GroupOption = string | { value: string; label: string };

/** Checkbox group, NOT <select multiple>.
 *
 *  The first real job came back with 2 leads because every filter carried a
 *  single value: <select multiple> needs Ctrl/Cmd-click and nobody discovers
 *  that. Repeated checkboxes with the same `name` post identically
 *  (formData.getAll), so the server action is unchanged — but picking four
 *  industries is now obvious instead of hidden.
 *
 *  Options are either plain strings (prettified with `label()` from
 *  jobDisplay) or `{value,label}` pairs (the LinkedIn presets, whose value is
 *  an opaque LinkedIn id that must post as-is while the label does the
 *  prettifying). One component covers both rather than duplicating the
 *  fieldset/scroll/divide markup for a second, near-identical component. */
function FilterGroup({
	name,
	title,
	options,
	selected,
}: {
	name: string;
	title: string;
	options: readonly GroupOption[];
	selected: readonly string[];
}) {
	const rows = options.map((o) => (typeof o === 'string' ? { value: o, label: label(o) } : o));
	return (
		<fieldset className="min-w-0">
			<legend className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
				{title}
			</legend>
			<div className="max-h-40 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-700">
				{rows.map((o) => (
					<label
						key={o.value}
						className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-hover transition-colors cursor-pointer"
					>
						<Checkbox name={name} value={o.value} defaultChecked={selected.includes(o.value)} />
						<span className="truncate">{o.label}</span>
					</label>
				))}
			</div>
		</fieldset>
	);
}

function ModeTabs({ mode, jobQuery, access }: { mode: ScrapeMode; jobQuery: string; access: RailAccess }) {
	const tab = (active: boolean) =>
		`flex-1 px-2 py-2 text-2xs font-medium border-b-2 -mb-px transition-colors text-center ${
			active
				? 'border-primary-500 text-slate-900 dark:text-slate-100'
				: 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
		}`;
	// The selected run rides along, so switching how you search never throws
	// away the results you were reading.
	const suffix = jobQuery ? `&${jobQuery}` : '';
	return (
		<div className="flex items-center mb-4 border-b border-slate-200 dark:border-slate-700 -mt-1">
			{access.leads && (
				<>
					<Link href={`/media/lead-scraper?mode=search${suffix}`} className={tab(mode === 'search')}>
						<Search className="w-3 h-3 inline mr-1" /> B2B database
					</Link>
					<Link href={`/media/lead-scraper?mode=show${suffix}`} className={tab(mode === 'show')}>
						<Store className="w-3 h-3 inline mr-1" /> Trade show
					</Link>
					<Link href={`/media/lead-scraper?mode=linkedin${suffix}`} className={tab(mode === 'linkedin')}>
						<Linkedin className="w-3 h-3 inline mr-1" /> LinkedIn
					</Link>
				</>
			)}
			{/* Capability-gated, not role-gated (0060): the tab exists only for
			    people the database will actually serve. No is_admin() shortcut. */}
			{access.acquisitions && (
				<Link href={`/media/lead-scraper?mode=acquisition${suffix}`} className={tab(mode === 'acquisition')}>
					<Building2 className="w-3 h-3 inline mr-1" /> Acquisitions
				</Link>
			)}
		</div>
	);
}

/** The Acquisitions rail: agency owners as acquisition targets. Posts to
 *  createAcquisitionJob, which stores kind 'acquisition' / preset
 *  'agency_owners'. Field names carry an `acq_` prefix so they can never be
 *  confused with the B2B form's on the server. */
function AcquisitionForm({ maxResults }: { maxResults: number }) {
	return (
		<form action={createAcquisitionJob} className="space-y-4">
			<p className="text-2xs text-slate-600 dark:text-slate-400 -mt-1">
				Finds agency owners and their firm data as acquisition targets. Always targets agency
				industries and owner-level titles; pick a geography (required) and narrow by services,
				headcount and years in business.
			</p>

			<FilterGroup name="acq_services" title="Services" options={SERVICES} selected={[]} />

			<div className="grid grid-cols-2 gap-2">
				<label className="block">
					<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
						Employees from
					</span>
					<input
						name="acq_employeeMin"
						type="number"
						min={1}
						max={5000}
						defaultValue={DEFAULT_EMPLOYEE_MIN}
						className={inputClass}
					/>
				</label>
				<label className="block">
					<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
						to
					</span>
					<input
						name="acq_employeeMax"
						type="number"
						min={1}
						max={5000}
						defaultValue={DEFAULT_EMPLOYEE_MAX}
						className={inputClass}
					/>
				</label>
			</div>

			<FilterGroup name="acq_location" title="Location" options={ACQUISITION_LOCATIONS} selected={['united states']} />

			<label className="block">
				<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
					Cities
				</span>
				<textarea name="acq_city" rows={2} placeholder="HQ, Alex" className={inputClass} />
			</label>

			<FilterGroup name="acq_titles" title="Owner titles" options={TITLE_SET} selected={[...TITLE_SET]} />

			<label className="block">
				<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
					Years in business (min)
				</span>
				<input name="acq_minYears" type="number" min={0} max={150} placeholder="e.g. 5" className={inputClass} />
				<span className="block text-2xs text-slate-600 dark:text-slate-400 mt-1">
					Applied at import: firms with a known founded year that is too recent are skipped;
					firms with no founded year stay in for review.
				</span>
			</label>

			<label className="block">
				<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
					Max records
				</span>
				<input name="max_results" type="number" min={1} max={5000} defaultValue={maxResults} className={inputClass} />
			</label>

			<Callout tone="info">
				Approved rows land in acquisition targets, never in Clients or Prospects. Export the CSV
				into the deal model sheet — that stays the working surface.
			</Callout>

			<div className="space-y-2">
				<Button type="submit" className="w-full justify-center">
					<Building2 className="w-3.5 h-3.5" /> Run search · ≈ $
					{estimateAcquisitionCostUsd(maxResults).toFixed(2)}
				</Button>
				<p className="text-2xs text-slate-600 dark:text-slate-400">
					Billed per record — 250 ≈ ${estimateAcquisitionCostUsd(250).toFixed(2)}, 1000 ≈ $
					{estimateAcquisitionCostUsd(1000).toFixed(2)}. Cron picks the job up within ~5 minutes,
					or press Run now.
				</p>
			</div>
		</form>
	);
}

export default function FilterRail({
	mode,
	filters,
	dirty,
	jobQuery,
	access,
}: {
	mode: ScrapeMode;
	filters: LeadFilters;
	/** The rail's filters differ from the selected run's. Drives the notice —
	 *  never a re-fetch. */
	dirty: boolean;
	/** The current `?job=` param, serialised, so mode tabs preserve it. */
	jobQuery: string;
	access: RailAccess;
}) {
	return (
		<>
			<ModeTabs mode={mode} jobQuery={jobQuery} access={access} />

			{mode === 'acquisition' ? (
				<AcquisitionForm maxResults={filters.maxResults} />
			) : mode === 'show' ? (
				<form action={createTradeShowJob} className="space-y-4">
					<label className="block">
						<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
							Exhibitor list URL
						</span>
						<input
							name="show_url"
							type="url"
							required
							placeholder="https://tbse26.mapyourshow.com/8_0/explore/exhibitor-gallery.cfm"
							className={inputClass}
						/>
						<span className="block text-2xs text-slate-600 dark:text-slate-400 mt-1">
							The page that lists the exhibitors. Covers 27+ directory platforms — Map Your Show,
							Koelnmesse, Messe Frankfurt, Reed Expo, Informa Markets, A2Z Events and more. Use the
							English version of the URL when the fair offers one.
						</span>
					</label>

					<label className="block">
						<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
							Max exhibitors
						</span>
						<input name="max_results" type="number" min={1} max={5000} defaultValue={250} className={inputClass} />
					</label>

					<div className="space-y-2">
						<label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
							<Checkbox name="lookup_emails" defaultChecked />
							Look up emails (free)
						</label>
						<label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
							<Checkbox name="booth_sizes" />
							Booth sizes (+$0.001 each)
						</label>
					</div>

					<div className="space-y-2">
						<Button type="submit" className="w-full justify-center">
							<Store className="w-3.5 h-3.5" /> Scrape list · ≈ $
							{estimateTradeShowCostUsd(250).toFixed(2)}
						</Button>
						<p className="text-2xs text-slate-600 dark:text-slate-400">
							Billed per exhibitor — 250 ≈ ${estimateTradeShowCostUsd(250).toFixed(2)}, 1000 ≈ $
							{estimateTradeShowCostUsd(1000).toFixed(2)}. Cron picks the job up within ~5 minutes,
							or press Run now.
						</p>
					</div>
				</form>
			) : mode === 'linkedin' ? (
				<form action={createLinkedinJob} className="space-y-4">
					<p className="text-2xs text-slate-600 dark:text-slate-400 -mt-1">
						Filters combine with <strong>AND</strong>; values inside one filter combine with{' '}
						<strong>OR</strong>. Add a search query or pick at least one filter below.
					</p>

					<label className="block">
						<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
							Scrape mode
						</span>
						<select name="mode" className={selectClass} defaultValue="Full">
							<option value="Full">Full — $0.004/profile</option>
							<option value="Full + email search">Full + email search — $0.010/profile</option>
						</select>
					</label>

					<label className="block">
						<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
							Search query
						</span>
						<input
							name="searchQuery"
							type="text"
							placeholder="Founder, Head of Marketing"
							className={inputClass}
						/>
						<span className="block text-2xs text-slate-600 dark:text-slate-400 mt-1">
							Supports LinkedIn search operators.
						</span>
					</label>

					<FilterGroup name="li_seniority" title="Seniority" options={LI_SENIORITY} selected={[]} />
					<FilterGroup name="li_functionArea" title="Function" options={LI_FUNCTION_AREA} selected={[]} />
					<FilterGroup name="li_industry" title="Industry" options={LI_INDUSTRY} selected={[]} />
					<FilterGroup name="li_headcount" title="Company headcount" options={LI_HEADCOUNT} selected={[]} />
					<FilterGroup
						name="li_yearsExperience"
						title="Years of experience"
						options={LI_YEARS_EXPERIENCE}
						selected={[]}
					/>

					<label className="block">
						<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
							Locations
						</span>
						<textarea
							name="li_locations"
							rows={2}
							placeholder="United States, United Kingdom"
							className={inputClass}
						/>
						<span className="block text-2xs text-slate-600 dark:text-slate-400 mt-1">
							LinkedIn is literal about location text — &quot;UK&quot; resolves to Ukraine, write
							&quot;United Kingdom&quot;.
						</span>
					</label>
					<label className="block">
						<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
							Job titles
						</span>
						<textarea
							name="li_jobTitles"
							rows={2}
							placeholder="Head of Brand, Founder"
							className={inputClass}
						/>
					</label>
					<label className="block">
						<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
							Companies
						</span>
						<textarea
							name="li_companies"
							rows={2}
							placeholder="Open Ronin"
							className={inputClass}
						/>
					</label>
					<label className="block">
						<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
							Schools
						</span>
						<textarea
							name="li_schools"
							rows={2}
							placeholder="University of Michigan"
							className={inputClass}
						/>
					</label>

					<label className="block">
						<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
							Max profiles
						</span>
						<input
							name="max_results"
							type="number"
							min={1}
							max={5000}
							defaultValue={filters.maxResults}
							className={inputClass}
						/>
					</label>

					<Callout tone="info">
						One query returns at most {LINKEDIN_MAX_PER_QUERY.toLocaleString()} profiles regardless
						of what you ask for, and search pages are billed per {PROFILES_PER_SEARCH_PAGE} profiles.
					</Callout>

					<div className="space-y-2">
						<Button type="submit" className="w-full justify-center">
							<Linkedin className="w-3.5 h-3.5" /> Run search · ≈ $
							{estimateLinkedinCostUsd(filters.maxResults, 'Full').toFixed(2)}
						</Button>
						<p className="text-2xs text-slate-600 dark:text-slate-400">
							Estimate assumes Full mode at {filters.maxResults} profiles — ≈ $
							{estimateLinkedinCostUsd(filters.maxResults, 'Full').toFixed(2)} Full · $
							{estimateLinkedinCostUsd(filters.maxResults, 'Full + email search').toFixed(2)} with
							email search. Switching the scrape mode above changes the real bill; this figure
							cannot update until you press Run. Cron picks the job up within ~5 minutes.
						</p>
					</div>
				</form>
			) : (
				<form action={createJob} className="space-y-4">
					<p className="text-2xs text-slate-600 dark:text-slate-400 -mt-1">
						Filters combine with <strong>AND</strong>; values inside one filter combine with{' '}
						<strong>OR</strong>. Tick several boxes per column to widen the funnel — leave a column
						empty to not filter on it at all.
					</p>

					<FilterGroup name="seniority" title="Seniority" options={SENIORITY} selected={filters.seniority ?? []} />
					<FilterGroup name="functionArea" title="Function" options={FUNCTION_AREA} selected={filters.functionArea ?? []} />
					<FilterGroup name="industry" title="Industry" options={INDUSTRY} selected={filters.industry ?? []} />
					<FilterGroup name="size" title="Company size" options={COMPANY_SIZE} selected={filters.size ?? []} />
					<FilterGroup name="location" title="Location" options={LOCATION} selected={filters.location ?? []} />

					<label className="block">
						<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
							Job titles
						</span>
						<textarea
							name="jobTitle"
							rows={2}
							placeholder="Head of Brand, Founder"
							className={inputClass}
							defaultValue={(filters.jobTitle ?? []).join(', ')}
						/>
					</label>
					<label className="block">
						<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
							Company keywords
						</span>
						<textarea
							name="keywords"
							rows={2}
							placeholder="supplements, skincare"
							className={inputClass}
							defaultValue={(filters.keywords ?? []).join(', ')}
						/>
					</label>
					<label className="block">
						<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
							Cities
						</span>
						<textarea
							name="city"
							rows={2}
							placeholder="HQ, Alex"
							className={inputClass}
							defaultValue={(filters.city ?? []).join(', ')}
						/>
					</label>

					<label className="block">
						<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
							Email status
						</span>
						<select
							name="emailStatus"
							className={selectClass}
							defaultValue={filters.emailStatus?.[0] ?? 'validated'}
						>
							{EMAIL_STATUS.map((s) => (
								<option key={s} value={s}>{label(s)}</option>
							))}
						</select>
					</label>

					<div className="grid grid-cols-2 gap-2">
						<label className="block">
							<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
								Min revenue{' '}
								<span className="text-amber-600 dark:text-amber-400 normal-case">(narrows)</span>
							</span>
							<select name="minRevenue" className={selectClass} defaultValue={filters.minRevenue ?? ''}>
								<option value="">Any</option>
								{REVENUE.map((r) => <option key={r} value={r}>{r}</option>)}
							</select>
						</label>
						<label className="block">
							<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
								Max revenue
							</span>
							<select name="maxRevenue" className={selectClass} defaultValue={filters.maxRevenue ?? ''}>
								<option value="">Any</option>
								{REVENUE.map((r) => <option key={r} value={r}>{r}</option>)}
							</select>
						</label>
					</div>

					<label className="block">
						<span className="block text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
							Max leads
						</span>
						<input
							name="max_results"
							type="number"
							min={1}
							max={5000}
							defaultValue={filters.maxResults}
							className={inputClass}
						/>
					</label>

					{dirty && (
						<Callout tone="info">
							These filters do not describe the run shown on the right. Nothing has been re-fetched —
							press Run search to execute them as a new search.
						</Callout>
					)}

					<div className="space-y-2">
						<Button type="submit" className="w-full justify-center">
							<Search className="w-3.5 h-3.5" /> Run search · ≈ $
							{estimateCostUsd(filters.maxResults).toFixed(2)}
						</Button>
						<p className="text-2xs text-slate-600 dark:text-slate-400">
							Billed per lead — 250 ≈ ${estimateCostUsd(250).toFixed(2)}, 1000 ≈ $
							{estimateCostUsd(1000).toFixed(2)}, 5000 ≈ ${estimateCostUsd(5000).toFixed(2)}. Cron
							picks the job up within ~5 minutes.
						</p>
					</div>
				</form>
			)}
		</>
	);
}
