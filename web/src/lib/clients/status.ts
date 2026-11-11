// Badge colors for the Client Status / Client Health vocabularies — the ONE
// place they live. They used to be duplicated between ClientsTable and
// clients/[id]/_lib, and the copies drifted: the list handled only the legacy
// green/yellow/red words, so a client whose health read "High" showed gray on
// /clients and green on their detail page.
//
// Pure on purpose: ClientsTable is a client component, so this module must
// not pull in the Airtable adapter the way _lib.ts does.

export function statusColor(
	status?: string,
): 'default' | 'success' | 'warning' | 'danger' | 'primary' {
	if (!status) return 'default';
	const s = status.toLowerCase();
	if (s === 'active' || s === '30-day' || s === '60-day') return 'success';
	if (s === 'internal') return 'primary';
	if (s === 'hold') return 'warning';
	if (s.includes('post contract')) return 'warning';
	if (s.includes('pending')) return 'primary';
	if (s === 'closed') return 'danger';
	return 'default';
}

/**
 * `Client Health` on Contract Agreement is an Airtable **percent** field, so
 * the adapter hands us a NUMBER, not a word. Calling .toLowerCase() on it
 * crashed the whole /clients render (`a.toLowerCase is not a function`,
 * production 2026-09-01) and took the client detail header down with it.
 *
 * Both shapes are accepted on purpose: the numeric one is what Airtable
 * actually sends today, and the word list is what older bases and the Client
 * Bible rollups still carry.
 */
export type HealthValue = string | number | null | undefined;

/** Percent fields arrive as a fraction (0.85), but hand-typed data uses points (85). */
function healthFraction(value: number): number {
	return value > 1 ? value / 100 : value;
}

export function healthColor(health?: HealthValue): 'default' | 'success' | 'warning' | 'danger' {
	if (health == null || health === '') return 'default';

	if (typeof health === 'number') {
		if (Number.isNaN(health)) return 'default';
		const pct = healthFraction(health);
		if (pct >= 0.7) return 'success';
		if (pct >= 0.4) return 'warning';
		return 'danger';
	}

	const s = health.toLowerCase();

	// Colour words are tested FIRST, and this order is load-bearing:
	// "yellow" contains "low", so while the High/Medium/Low branches ran
	// first a legacy health of "Yellow" painted danger-red instead of
	// warning-amber. Same trap for anything else containing that substring.
	if (s.includes('yellow') || s.includes('caution')) return 'warning';
	if (s.includes('green') || s.includes('healthy') || s.includes('strong')) return 'success';
	if (s.includes('red flag') || s.includes('red') || s.includes('critical')) return 'danger';
	// Churn is checked before the generic risk branch: "churn risk" is a
	// churn signal, not a mild one.
	if (s.includes('churn')) return 'danger';
	if (s.includes('risk')) return 'warning';

	// Live Client Health vocabulary for bases that still store words.
	if (s.includes('high')) return 'success';
	if (s.includes('medium')) return 'warning';
	if (s.includes('low')) return 'danger';
	return 'default';
}

/**
 * Display string for a health value. A raw percent field renders as "0.85"
 * without this, which reads like a broken number to a publicist.
 *
 * Intl is called inline rather than imported from `@/lib/format` to keep this
 * module dependency-free — see the header note.
 */
export function formatHealth(health?: HealthValue): string {
	if (health == null || health === '') return '—';
	if (typeof health === 'number') {
		if (Number.isNaN(health)) return '—';
		return new Intl.NumberFormat('en-US', {
			style: 'percent',
			maximumFractionDigits: 0,
		}).format(healthFraction(health));
	}
	return health;
}

/**
 * Word for the band a health value falls in. Pairs with `formatHealth` so a
 * badge next to the raw percentage says something the number doesn't.
 */
export function healthBand(health?: HealthValue): string | null {
	const color = healthColor(health);
	if (color === 'success') return 'Healthy';
	if (color === 'warning') return 'Watch';
	if (color === 'danger') return 'At risk';
	return null;
}

/** True when there is a health value worth rendering. `0` is a value; `''` is not. */
export function hasHealth(health?: HealthValue): boolean {
	if (health == null || health === '') return false;
	return typeof health === 'number' ? !Number.isNaN(health) : true;
}
