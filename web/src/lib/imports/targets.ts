// The target allowlist. Every table an import may write, with its typed
// column map and natural key. Pure data, no server imports: the Target and
// Map steps render from this on the client.
//
// Adding a target here is not enough on its own: the engine
// (lib/imports/engine.ts) needs a handler that knows how to look rows up by
// the natural key and how to write them, and the migration CHECK on
// import_batches.target needs the new key. All three in one PR.

import type { FieldSchema } from '@/lib/data/adapter';
import type { ColumnSpec, ColumnType, TargetInfo, TargetKey } from './types';

const CONTACT_ROLES = [
	'media', 'client', 'prospect', 'partnership', 'industry', 'team',
	'influencer', 'podcaster', 'journalist', 'speaker', 'vendor', 'event',
] as const;

const PROSPECT_STAGES = ['lead', 'qualified', 'proposal', 'negotiating', 'won', 'lost'] as const;

const MEDIA_TYPES = ['Online', 'Podcast', 'Print', 'TV/Broadcast', 'Radio', 'Newsletter'] as const;

const ALIAS_SOURCES = [
	'airtable_client_central', 'airtable_client_media', 'ghl', 'sheet_client_list', 'manual',
] as const;

const contacts: ColumnSpec[] = [
	{ key: 'display_name', label: 'Display name', type: 'text', required: true, aliases: ['name', 'full name', 'contact', 'contact name'] },
	{ key: 'first_name', label: 'First name', type: 'text', aliases: ['first', 'given name', 'forename'] },
	{ key: 'last_name', label: 'Last name', type: 'text', aliases: ['last', 'surname', 'family name'] },
	{ key: 'email', label: 'Email', type: 'email', naturalKey: true, aliases: ['email address', 'e mail', 'work email', 'primary email'] },
	{ key: 'phone', label: 'Phone', type: 'phone', aliases: ['phone number', 'mobile', 'cell', 'telephone', 'tel'] },
	{ key: 'title', label: 'Title', type: 'text', aliases: ['job title', 'role', 'position'] },
	{ key: 'organization', label: 'Organization', type: 'text', aliases: ['company', 'org', 'outlet', 'employer', 'publication'] },
	{ key: 'linkedin_url', label: 'LinkedIn', type: 'url', aliases: ['linkedin', 'linkedin profile'] },
	{ key: 'twitter_handle', label: 'X handle', type: 'text', aliases: ['twitter', 'x', 'twitter handle', 'x handle'] },
	{ key: 'notes_md', label: 'Notes', type: 'text', aliases: ['notes', 'note', 'comments'] },
	{
		key: 'roles',
		label: 'Roles',
		type: 'list',
		values: CONTACT_ROLES,
		aliases: ['role', 'contact roles', 'type', 'contact type', 'tags'],
		help: 'Written to contact_roles. A re import adds roles and never removes one.',
	},
];

const prospects: ColumnSpec[] = [
	{ key: 'name', label: 'Name', type: 'text', required: true, naturalKey: true, aliases: ['prospect', 'company', 'prospect name', 'company name'] },
	{ key: 'stage', label: 'Stage', type: 'enum', values: PROSPECT_STAGES, aliases: ['status', 'pipeline stage'] },
	{ key: 'source', label: 'Source', type: 'text', aliases: ['lead source', 'origin', 'channel'] },
	{ key: 'industry', label: 'Industry', type: 'text', aliases: ['vertical', 'sector'] },
	{ key: 'estimated_mrr_cents', label: 'Estimated MRR', type: 'currency_cents', aliases: ['mrr', 'estimated mrr', 'monthly value', 'deal value'] },
	{ key: 'pitched_at', label: 'Pitched on', type: 'date', aliases: ['pitched', 'pitch date', 'date pitched'] },
	{ key: 'notes_md', label: 'Notes', type: 'text', aliases: ['notes', 'note', 'comments'] },
];

const media_outlets: ColumnSpec[] = [
	{ key: 'name', label: 'Outlet name', type: 'text', required: true, aliases: ['outlet', 'publication', 'media outlet', 'title'] },
	{ key: 'domain', label: 'Domain', type: 'text', required: true, naturalKey: true, aliases: ['website domain', 'site', 'url domain'] },
	{ key: 'website', label: 'Website', type: 'url', aliases: ['url', 'site url', 'homepage'] },
	{ key: 'location', label: 'Location', type: 'text', aliases: ['city', 'region', 'country', 'market'] },
	{ key: 'media_types', label: 'Media types', type: 'list', values: MEDIA_TYPES, aliases: ['type', 'media type', 'format'] },
	{ key: 'categories', label: 'Categories', type: 'list', aliases: ['category', 'beats', 'topics', 'coverage'] },
	{ key: 'tier', label: 'Tier', type: 'text', aliases: ['media tier', 'outlet tier'] },
	{ key: 'bio', label: 'Bio', type: 'text', aliases: ['description', 'about', 'summary'] },
];

const client_aliases: ColumnSpec[] = [
	{
		key: 'client_name',
		label: 'Client',
		type: 'text',
		required: true,
		aliases: ['client', 'client name', 'display name', 'account'],
		help: 'Matched to clients_v2 by name, exact and case insensitive. Rows with no match are rejected.',
	},
	{ key: 'source', label: 'Source system', type: 'enum', values: ALIAS_SOURCES, required: true, naturalKey: true, aliases: ['system', 'alias source'] },
	{ key: 'external_id', label: 'External id', type: 'text', required: true, naturalKey: true, aliases: ['id', 'record id', 'external', 'airtable id', 'ghl id'] },
	{ key: 'raw_name', label: 'Name in that system', type: 'text', aliases: ['raw', 'alias', 'name as spelled', 'alias name'] },
	{ key: 'confidence', label: 'Confidence', type: 'number', aliases: ['score', 'match confidence'], help: '0 to 1. Blank means 1, an exact curated match.' },
];

const metrics: ColumnSpec[] = [
	{ key: 'subject_type', label: 'Subject type', type: 'enum', values: ['user', 'client', 'team'], required: true, naturalKey: true, aliases: ['type', 'subject'] },
	{
		key: 'subject_email',
		label: 'Person email',
		type: 'email',
		naturalKey: true,
		aliases: ['email', 'user email', 'person', 'publicist email'],
		help: 'For subject type user: resolved to the profile with that email.',
	},
	{
		key: 'subject_ref',
		label: 'Subject reference',
		type: 'text',
		naturalKey: true,
		aliases: ['ref', 'client id', 'contract id', 'airtable contract id', 'team'],
		help: 'For client or team rows: the external key (an Airtable contract id, a team name).',
	},
	{ key: 'metric_key', label: 'Metric key', type: 'text', required: true, naturalKey: true, aliases: ['metric', 'key', 'kpi'], help: 'Must exist in the Metrics Catalog.' },
	{ key: 'period', label: 'Month', type: 'month', required: true, naturalKey: true, aliases: ['month', 'period month', 'date'] },
	{ key: 'value', label: 'Value', type: 'number', aliases: ['achieved', 'actual', 'result'] },
	{ key: 'goal', label: 'Goal', type: 'number', aliases: ['target', 'quota'] },
];

/**
 * Revenue Engine prospects (0121). File-facing columns; every row goes
 * through rev_intake() so dedupe (LinkedIn → phone → email → domain+name) is
 * the same path as the Add form and the P2 webhooks. Mapping templates: a
 * Ulinc / Sales Navigator export maps on the LinkedIn aliases, Clay and
 * trade-show lists on email + company.
 */
const rev_prospects: ColumnSpec[] = [
	{ key: 'first_name', label: 'First name', type: 'text', aliases: ['first', 'given name', 'forename'] },
	{ key: 'last_name', label: 'Last name', type: 'text', aliases: ['last', 'surname', 'family name'] },
	{ key: 'display_name', label: 'Full name', type: 'text', aliases: ['name', 'full name', 'contact', 'contact name', 'lead name', 'prospect'] },
	{ key: 'email', label: 'Email', type: 'email', naturalKey: true, aliases: ['email address', 'e mail', 'work email', 'primary email', 'business email'] },
	{ key: 'phone', label: 'Phone', type: 'phone', naturalKey: true, aliases: ['phone number', 'mobile', 'cell', 'telephone', 'tel', 'direct phone'] },
	{ key: 'linkedin_url', label: 'LinkedIn', type: 'url', naturalKey: true, aliases: ['linkedin', 'linkedin profile', 'linkedin url', 'profile url', 'profile link'] },
	{ key: 'title', label: 'Title', type: 'text', aliases: ['job title', 'role', 'position', 'headline'] },
	{ key: 'instagram', label: 'Instagram', type: 'text', aliases: ['ig', 'instagram handle', 'ig handle'] },
	{ key: 'location', label: 'Location', type: 'text', aliases: ['city', 'region', 'geo', 'country'] },
	{ key: 'brand_name', label: 'Brand', type: 'text', naturalKey: true, aliases: ['brand', 'company', 'company name', 'organization', 'org', 'business', 'account', 'employer'] },
	{ key: 'brand_website', label: 'Website', type: 'url', aliases: ['website', 'company website', 'url', 'site', 'domain', 'company domain'] },
	{ key: 'company_name', label: 'Parent company', type: 'text', aliases: ['parent company', 'holding company', 'group'] },
	{ key: 'industry', label: 'Industry', type: 'text', aliases: ['sector', 'category', 'niche'] },
	{ key: 'vertical', label: 'Vertical', type: 'text', aliases: ['playbook vertical', 'segment'] },
	{ key: 'pipeline', label: 'Pipeline', type: 'text', aliases: ['lane', 'pipeline slug'], help: 'Pipeline slug: marketing, lead-gen, setter, closer, beacon, lux. Blank = the slug chosen in the options.' },
	{ key: 'stage', label: 'Stage', type: 'text', aliases: ['stage slug', 'status'], help: 'Stage slug within the pipeline. Blank = the first stage.' },
	{ key: 'source', label: 'Source', type: 'text', aliases: ['lead source', 'origin', 'channel source'] },
	{ key: 'campaign', label: 'Campaign', type: 'text', aliases: ['campaign name', 'sequence', 'list'] },
	{ key: 'channel', label: 'Channel', type: 'text', aliases: ['outreach channel'] },
	{ key: 'owner_email', label: 'Owner email', type: 'email', aliases: ['owner', 'assigned to', 'rep', 'rep email', 'setter'] },
	{ key: 'est_mrr_cents', label: 'Est. MRR', type: 'currency_cents', aliases: ['mrr', 'estimated mrr', 'monthly value', 'deal value', 'value'] },
	{ key: 'notes', label: 'Notes', type: 'text', aliases: ['note', 'comments', 'remarks'] },
];

/**
 * Media Opportunities (0116). Column keys are the table columns; the
 * aliases are the Airtable Client Media field names, so a server pull from
 * that base (options.source) auto maps with no manual step. The client is
 * resolved by NAME against clients_v2 + client_aliases (unique match only —
 * the Airtable link points at Client Media's own Client Metrics table, not
 * Client Central, so there is no id to join on); Beacon-tagged clients are
 * skipped, unresolved or ambiguous names are rejected with the reason.
 */
const media_opportunities: ColumnSpec[] = [
	{
		key: 'airtable_record_id',
		label: 'Airtable record id',
		type: 'text',
		required: true,
		naturalKey: true,
		aliases: ['record id', 'airtable id', 'rec id', 'id'],
		help: 'rec… id from the Client Media base. The import is idempotent on it.',
	},
	{
		key: 'client_name',
		label: 'Client',
		type: 'text',
		required: true,
		aliases: ['client', 'client name', 'full measure'],
		help: 'Matched to clients_v2 by name (display name or alias, unique fold). Beacon-tagged clients are skipped, not imported.',
	},
	{ key: 'title', label: 'Media Opp', type: 'text', aliases: ['media opp', 'opp', 'opportunity', 'name'] },
	{ key: 'story_title', label: 'Story title', type: 'text', aliases: ['story title', 'headline'] },
	{ key: 'potential_story', label: 'Potential story / angle', type: 'text', aliases: ['potential story / angle', 'potential story', 'angle'] },
	{ key: 'outlet_name', label: 'Outlet', type: 'text', aliases: ['outlet', 'publication', 'media outlet'] },
	{ key: 'outlet_url', label: 'Outlet URL', type: 'text', aliases: ['outlet url', 'url', 'website'] },
	{ key: 'status_raw', label: 'Status', type: 'text', aliases: ['status', 'opp status'], help: 'Kept verbatim; the stage is derived by lib/media/status.ts.' },
	{ key: 'date_secured', label: 'Date secured', type: 'date', aliases: ['date secured', 'secured'] },
	{ key: 'date_sent_to_client', label: 'Date sent to client', type: 'date', aliases: ['date sent to client', 'sent to client', 'date sent'] },
	{ key: 'date_added', label: 'Date added', type: 'date', aliases: ['date added', 'added', 'created'] },
	{ key: 'live_link', label: 'Live link', type: 'text', aliases: ['live link', 'link', 'coverage link'] },
	{ key: 'live_date', label: 'Live date', type: 'date', aliases: ['live date', 'went live', 'published'] },
	{ key: 'reach', label: 'Reach', type: 'integer', aliases: ['reach', 'audience', 'uvm'] },
	{ key: 'media_tier', label: 'Media tier', type: 'text', aliases: ['media tier', 'tier'] },
	{ key: 'category', label: 'Category', type: 'text', aliases: ['category', 'beat'] },
	{ key: 'opp_type', label: 'Opp type', type: 'text', aliases: ['opp type', 'type', 'opportunity type'] },
	{ key: 'secured_by', label: 'Secured by', type: 'text', aliases: ['secured by', 'publicist', 'owner'] },
	{ key: 'notes', label: 'Notes', type: 'text', aliases: ['notes', 'note', 'comments'] },
];

export const TARGETS: Record<Exclude<TargetKey, 'airtable'>, TargetInfo> = {
	contacts: {
		key: 'contacts',
		label: 'Contacts',
		description: 'People: journalists, client contacts, prospects, vendors. Roles land in contact_roles.',
		naturalKeyLabel: 'Email (rows without an email match on display name plus organization)',
		columns: contacts,
	},
	prospects: {
		key: 'prospects',
		label: 'Prospects',
		description: 'Sales pipeline rows.',
		naturalKeyLabel: 'Name, case insensitive',
		columns: prospects,
	},
	media_outlets: {
		key: 'media_outlets',
		label: 'Media outlets',
		description: 'Publications, podcasts and broadcasters. Available once migration 0102 (Media Scraper) is applied.',
		naturalKeyLabel: 'Domain',
		columns: media_outlets,
	},
	client_aliases: {
		key: 'client_aliases',
		label: 'Client aliases',
		description: 'How other systems name a client, keyed to clients_v2.',
		naturalKeyLabel: 'Source system plus external id',
		columns: client_aliases,
	},
	metrics: {
		key: 'metrics',
		label: 'Metrics (manual)',
		description: 'Manual metric values by person or client and month. Source is always manual.',
		naturalKeyLabel: 'Subject, metric key and month',
		columns: metrics,
	},
	media_opportunities: {
		key: 'media_opportunities',
		label: 'Media opportunities',
		description: 'Row-level media opportunities keyed to clients_v2 (0116). Open Ronin-agency clients only; Beacon-tagged clients are skipped and counted.',
		naturalKeyLabel: 'Airtable record id',
		columns: media_opportunities,
	},
	rev_prospects: {
		key: 'rev_prospects',
		label: 'Prospects (Revenue Engine)',
		description: 'Leads into the Revenue Engine (0121): each row runs through the intake door, so people are matched LinkedIn → phone → email → brand and a deal is opened (or reused) in the pipeline you pick. Ulinc, Sales Navigator, Clay and trade-show exports auto-map.',
		naturalKeyLabel: 'LinkedIn URL, phone or email (rows with none match on brand name)',
		columns: rev_prospects,
	},
};

export const AIRTABLE_TARGET: Omit<TargetInfo, 'columns'> = {
	key: 'airtable',
	label: 'Airtable table',
	description: 'Any table in a base the app can see, through the data adapter. Pick the field that identifies a record.',
	naturalKeyLabel: 'The field you pick on this step',
};

export function targetInfo(key: TargetKey): Omit<TargetInfo, 'columns'> & { columns: ColumnSpec[] } {
	if (key === 'airtable') return { ...AIRTABLE_TARGET, columns: [] };
	return TARGETS[key];
}

/**
 * Natural key groups in priority order. The first group whose columns are all
 * present on a row is the one used to find an existing row.
 */
export function naturalKeyGroups(key: TargetKey): string[][] {
	switch (key) {
		case 'contacts':
			return [['email'], ['display_name', 'organization']];
		case 'prospects':
			return [['name']];
		case 'media_outlets':
			return [['domain']];
		case 'client_aliases':
			return [['source', 'external_id']];
		case 'metrics':
			return [['subject_type', 'subject_email', 'metric_key', 'period'], ['subject_type', 'subject_ref', 'metric_key', 'period']];
		case 'media_opportunities':
			return [['airtable_record_id']];
		case 'rev_prospects':
			return [['linkedin_url'], ['phone'], ['email'], ['brand_name']];
		case 'airtable':
			return [];
	}
}

/** Airtable fields as import columns. Read only and linked field kinds are skipped. */
export function airtableColumns(fields: FieldSchema[]): ColumnSpec[] {
	const map: Partial<Record<FieldSchema['type'], ColumnType | null>> = {
		singleLineText: 'text',
		multilineText: 'text',
		richText: 'text',
		email: 'email',
		url: 'url',
		phoneNumber: 'phone',
		number: 'number',
		currency: 'number',
		percent: 'number',
		duration: 'number',
		rating: 'number',
		singleSelect: 'text',
		multipleSelects: 'list',
		date: 'date',
		dateTime: 'date',
		checkbox: 'boolean',
		barcode: 'text',
		autoNumber: null,
		formula: null,
		lookup: null,
		rollup: null,
		count: null,
		multipleLookupValues: null,
		createdBy: null,
		lastModifiedBy: null,
		createdTime: null,
		lastModifiedTime: null,
		button: null,
		multipleRecordLinks: null,
		multipleAttachments: null,
		singleCollaborator: null,
		multipleCollaborators: null,
	};
	const out: ColumnSpec[] = [];
	for (const f of fields) {
		const type = map[f.type];
		if (!type) continue;
		const values =
			f.type === 'singleSelect' || f.type === 'multipleSelects'
				? ((f.options as { choices?: { name: string }[] } | undefined)?.choices ?? []).map((c) => c.name)
				: undefined;
		out.push({ key: f.name, label: f.name, type: values?.length && f.type === 'singleSelect' ? 'enum' : type, values });
	}
	return out;
}
