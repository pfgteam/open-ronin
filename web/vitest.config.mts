import { defineConfig } from 'vitest/config';
import path from 'node:path';

const here = import.meta.dirname;

// Unit tests for PURE logic only — week math, attention signals, formatters.
// Rendering async Server Components under Vitest is not stable; page-level
// behaviour belongs in a browser test (Playwright) instead, and DB rules are
// tested against a real Postgres (see the migration validation harness).
export default defineConfig({
	// tsconfig sets jsx: preserve for Next; Vitest (Vite 8, oxc) needs the
	// automatic runtime to import a .tsx (the chart set's render tests).
	oxc: { jsx: { runtime: 'automatic' } },
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		env: { NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS: 'example.com,example.org', AIRTABLE_OPPS_TABLE: 'test-opps-table', AIRTABLE_OPPS_CLIENTS_TABLE: 'test-opp-clients-table' },
	},
	resolve: {
		alias: { '@': path.resolve(here, 'src') },
	},
});
