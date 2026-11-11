// The allowlist behind `data:read` (list_tables / describe_table / query_table).
//
// WHY AN ALLOWLIST AND NOT A DENYLIST: MCP tools read with the SERVICE ROLE,
// which bypasses RLS entirely. Every narrow tool (clients, sessions, work…)
// is safe because it hand-writes its own query. A generic reader has no such
// shape, so this list IS the security boundary. Fail closed: a table absent
// from READABLE is denied, so a table added by a future migration stays
// unreadable until someone deliberately lists it here.
//
// Three tiers:
//   - READABLE          table -> null (all columns) or an explicit column list
//   - REDACTED_COLUMNS  columns stripped from an otherwise-readable table
//   - (absent)          denied
//
// NEVER add here, with the reason, so a later reader does not "fix" the gap:
//   ghl_connections, google_calendar_connections, comms.connections,
//   integrations      OAuth tokens / credentials_enc. Reading these lets an
//                     agent reconnect as Open Ronin to GHL and Google.
//   mcp_consumers     token_hash: one consumer must never read another
//                     consumer's token material.
//   profile_sensitive, payroll_runs, comp_reconciliation, metric_revisions,
//   project_rate_overrides
//                     compensation. RLS restricts these to comp viewers; the
//                     service role would hand them to any agent.
//   ghl_oauth_states  in-flight OAuth state.

/** null = every column is readable. Otherwise only the columns listed. */
export type ColumnRule = null | readonly string[];

/**
 * Columns removed from the result even when the table is readable. Applied
 * after the select, so adding one here is enough — no need to also rewrite
 * that table's column list.
 */
export const REDACTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
	'public.profiles': ['hourly_rate_cents', 'birthday'],
	'public.time_entries': ['hourly_rate_cents', 'cost_cents'],
	'public.scraped_records': ['personal_email', 'mobile_phone', 'company_phone', 'company_address'],
	'public.acquisition_targets': ['phone'],
	'public.contacts': ['phone'],
	'public.rev_people': ['phone', 'phones', 'enrichment'],
	'public.rev_activities': ['recording_url'],
	'public.ghl_contacts': ['phone', 'custom_fields', 'raw'],
	'public.ghl_locations': ['phone', 'address', 'raw'],
	'public.audit_log': ['ip'],
	'public.podcast_episodes': ['guest_email'],
};

export const READABLE: Readonly<Record<string, ColumnRule>> = {
	// ---------------------------------------------------------------- clients
	'public.clients': null,
	'public.clients_v2': null,
	'public.client_meta': null,
	'public.client_aliases': null,
	'public.client_badges': null,
	'public.client_comms': null,
	'public.client_competitors': null,
	'public.client_contacts': null,
	'public.client_engagement': null,
	'public.client_gifts': null,
	'public.client_goals': null,
	'public.client_keywords': null,
	'public.client_opp_months': null,
	'public.media_opportunities': null,
	'public.client_satisfaction': null,
	'public.contracts': null,
	'public.brands': null,
	'public.brand_contacts': null,
	'public.campaigns': null,
	'public.live_links': null,
	'public.health_factors': null,
	'public.health_package_weights': null,
	'public.health_scores': null,
	'public.badges': null,
	'public.prospects': null,
	// Revenue Engine (0121). Prospects are third-party people: phone and the
	// alternate-channel columns are redacted below, same posture as contacts.
	'public.rev_companies': null,
	'public.rev_brands': null,
	'public.rev_brand_companies': null,
	'public.rev_lines': null,
	'public.rev_people': null,
	'public.rev_person_links': null,
	'public.rev_pipelines': null,
	'public.rev_stages': null,
	'public.rev_products': null,
	'public.rev_dispositions': null,
	'public.rev_deals': null,
	'public.rev_deal_stage_history': null,
	'public.rev_activities': null,
	'public.rev_tasks': null,
	'public.rev_duplicate_candidates': null,
	// Payment TIMING is operational (late/on-time drives health). No amounts
	// live on this table — per_month_cents is on contracts.
	'public.payments': null,

	// ----------------------------------------------------------------- people
	// hourly_rate_cents + birthday stripped via REDACTED_COLUMNS.
	'public.profiles': null,
	'public.people_managers': null,
	'public.position_tracks': null,
	'public.pap_positions': null,
	'public.profile_docs': null,
	'public.profile_metric_overrides': null,
	'public.team_capacity': null,
	'public.time_off': null,
	'public.user_capabilities': null,
	'public.reviewer_groups': null,
	'public.reviewer_group_members': null,
	'public.role_permissions': null,
	'public.app_modules': null,

	// ------------------------------------------------------------------- work
	'public.projects': null,
	'public.tasks': null,
	'public.task_dependencies': null,
	'public.todos': null,
	'public.project_templates': null,
	'public.project_template_tasks': null,
	'public.project_kanban_columns': null,
	'public.work_item_attachments': null,
	// 0111 Tier B: travel and podcast episodes (guest_email redacted below)
	'public.trips': null,
	'public.podcast_episodes': null,
	'public.brand_assets': null,
	'public.work_item_comments': null,
	'public.work_item_events': null,
	'public.work_item_followers': null,
	'public.work_item_links': null,
	'public.work_item_owners': null,
	'public.work_item_status_configs': null,
	'public.work_item_status_log': null,
	'public.work_item_statuses': null,
	'public.work_item_tags': null,
	'public.work_item_updates': null,
	'public.quarters': null,
	'public.twelve_week_periods': null,
	'public.tags': null,

	// -------------------------------------------------------------- calls/AI
	'public.calls': null,
	'public.call_analyses': null,
	'public.call_participant_scores': null,
	'public.call_suggested_tasks': null,
	'public.call_transcripts': null,

	// --------------------------------------------------------------- calendar
	'public.calendar_events': null,
	'public.calendar_event_categories': null,
	'public.airtable_event_imports': null,

	// ---------------------------------------------------------------- metrics
	// metric_revisions is NOT here: it carries comp adjustment history.
	'public.metrics': null,
	'public.metric_definitions': null,
	'public.time_entries': null,
	'public.time_studies': null,
	'public.time_study_categories': null,
	'public.time_study_entries': null,
	'public.time_study_submissions': null,
	'public.calibration_cycles': null,
	'public.calibration_scores': null,
	'public.weekly_checkins': null,
	'public.checkin_audience': null,
	'public.checkin_categories': null,
	'public.checkin_comments': null,
	'public.checkin_responses': null,
	'public.checkin_reviews': null,

	// --------------------------------------------------------------- scrapers
	'public.scrape_jobs': null,
	'public.scraped_records': null,
	'public.scraper_settings': null,
	'public.acquisition_targets': null,

	// -------------------------------------------------------------- knowledge
	'public.wiki_spaces': null,
	'public.wiki_pages': null,
	'public.wiki_revisions': null,
	'public.kb_articles': null,
	'public.kb_categories': null,
	'public.playbook_links': null,
	'public.graph_documents': null,
	'public.graph_nodes': null,
	'public.graph_edges': null,

	// --------------------------------------------------------------- contacts
	'public.contacts': null,
	'public.contact_roles': null,
	'public.ghl_contacts': null,
	'public.ghl_locations': null,
	'public.ghl_opportunities': null,
	'public.ghl_brand_links': null,
	'public.ghl_sync_state': null,

	// -------------------------------------------------------- data/dashboards
	'public.data_bases': null,
	'public.data_tables': null,
	'public.data_fields': null,
	'public.data_records': null,
	'public.data_views': null,
	'public.dashboards': null,
	'public.saved_views': null,
	'public.forms': null,
	'public.form_submissions': null,
	'public.sheet_sources': null,
	'public.sheet_snapshots': null,

	// ---------------------------------------------------------------- content
	'public.content_jobs': null,
	'public.content_assets': null,
	'public.content_caps': null,

	// ------------------------------------------------------------- ops/system
	'public.staff_requests': null,
	'public.staff_request_events': null,
	// trigger_config/action_config can carry endpoints and tokens.
	'public.automation_rules': [
		'id', 'name', 'description_md', 'trigger_kind', 'enabled',
		'last_run_at', 'created_by', 'created_at', 'updated_at',
	],
	'public.cron_runs': null,
	'public.notifications': null,
	'public.import_batches': null,
	'public.import_rows': null,
	'public.ingest_unmatched': null,
	'public.drive_sync_queue': null,
	'public.skill_runs': null,
	'public.audit_log': null,

	// ------------------------------------------------------------------ comms
	// comms.connections is absent (credentials_enc).
	'comms.conversations': null,
	'comms.conversation_participants': null,
	'comms.conversation_links': null,
	'comms.conversation_events': null,
	'comms.messages': null,
	'comms.profile_identities': null,
	'comms.connection_grants': null,

	// ------------------------------------------------------------------ spine
	'spine.agent_identities': null,
	'spine.agent_audit': null,
	'spine.action_types': null,
	'spine.event_routes': null,
	'spine.events': null,
	'spine.proposed_actions': null,
	'spine.tenants': null,
};

export const READABLE_TABLES = Object.keys(READABLE).sort();

/** Split "schema.table" — defaults to public when unqualified. */
export function splitRef(ref: string): { schema: string; table: string } {
	const i = ref.indexOf('.');
	return i === -1
		? { schema: 'public', table: ref }
		: { schema: ref.slice(0, i), table: ref.slice(i + 1) };
}

/** undefined = denied. Otherwise the column rule for that table. */
export function ruleFor(ref: string): ColumnRule | undefined {
	const { schema, table } = splitRef(ref);
	const key = `${schema}.${table}`;
	return key in READABLE ? READABLE[key] : undefined;
}

export function redactedFor(ref: string): readonly string[] {
	const { schema, table } = splitRef(ref);
	return REDACTED_COLUMNS[`${schema}.${table}`] ?? [];
}

/** Strip redacted keys from a row set, in place of a column-level grant. */
export function redactRows<T extends Record<string, unknown>>(
	ref: string,
	rows: T[],
): Record<string, unknown>[] {
	const drop = redactedFor(ref);
	if (drop.length === 0) return rows;
	return rows.map((row) => {
		const copy: Record<string, unknown> = { ...row };
		for (const c of drop) delete copy[c];
		return copy;
	});
}
