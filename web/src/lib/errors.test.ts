import { describe, it, expect, vi, afterEach } from 'vitest';
import { explainDbError, explainAndLog, GENERIC_DB_ERROR } from './errors';

describe('explainDbError', () => {
	it('maps the SQLSTATE codes the app actually hits', () => {
		expect(explainDbError({ code: '23505' })).toMatch(/already exists/i);
		expect(explainDbError({ code: '23503' })).toMatch(/links to was removed/i);
		expect(explainDbError({ code: '23514' })).toMatch(/allowed options/i);
		expect(explainDbError({ code: '42501' })).toMatch(/permission/i);
		expect(explainDbError({ code: 'PGRST116' })).toMatch(/no longer exists/i);
	});

	// The 0088 failure: a CHECK constraint the app could not satisfy. The
	// reader should get "not one of the allowed options", never the raw
	// `violates check constraint "profiles_department_check"`.
	it('translates the real 0088 failure', () => {
		const real = {
			code: '23514',
			message:
				'new row for relation "profiles" violates check constraint "profiles_department_check"',
		};
		const out = explainDbError(real);
		expect(out).toMatch(/allowed options/i);
		expect(out).not.toMatch(/profiles_department_check|violates|relation/);
	});

	// supabase-js often surfaces an RLS refusal without a code.
	it('recognises RLS refusals from the message alone', () => {
		expect(
			explainDbError({
				message: 'new row violates row-level security policy for table "form_submissions"',
			}),
		).toMatch(/permission/i);
	});

	it('recognises constraint violations from the message alone', () => {
		expect(explainDbError({ message: 'duplicate key value violates unique constraint "tags_slug_key"' }))
			.toMatch(/already exists/i);
		expect(explainDbError({ message: 'update or delete violates foreign key constraint' }))
			.toMatch(/links to was removed/i);
	});

	// A dropped column reads as a schema-cache miss through PostgREST — the
	// shape production showed after 0089.
	it('treats a schema-cache miss as a setup gap, not a user error', () => {
		expect(
			explainDbError({ message: "Could not find the table 'public.content_jobs' in the schema cache" }),
		).toMatch(/not set up yet/i);
	});

	it('never leaks the raw message', () => {
		const out = explainDbError({
			code: '23505',
			message: 'duplicate key value violates unique constraint "tags_slug_key"',
		});
		expect(out).not.toMatch(/tags_slug_key|duplicate key/);
	});

	it('falls back with a next step, and names the action when given one', () => {
		expect(explainDbError({ message: 'something unmapped' })).toBe(GENERIC_DB_ERROR);
		expect(explainDbError({ message: 'something unmapped' }, 'save the tag')).toMatch(
			/Couldn't save the tag/,
		);
	});

	it('survives null, undefined and non-objects', () => {
		expect(explainDbError(null)).toBe(GENERIC_DB_ERROR);
		expect(explainDbError(undefined)).toBe(GENERIC_DB_ERROR);
		expect(explainDbError('boom')).toBe(GENERIC_DB_ERROR);
	});
});

describe('explainAndLog', () => {
	afterEach(() => vi.restoreAllMocks());

	it('returns the friendly copy and logs the raw error', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const out = explainAndLog(
			{ code: '23505', message: 'duplicate key value violates unique constraint "tags_slug_key"' },
			'tags.create',
		);
		expect(out).toMatch(/already exists/i);
		expect(spy).toHaveBeenCalled();
		// the raw detail must reach the log even though the UI never sees it
		expect(JSON.stringify(spy.mock.calls[0])).toMatch(/tags_slug_key/);
	});
});
