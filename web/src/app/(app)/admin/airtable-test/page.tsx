// Airtable connectivity test page (admin-only).
//
// Server component that exercises the DataAdapter end-to-end:
//   1. AIRTABLE_PAT env var present
//   2. listBases() — confirms PAT + workspace scope
//   3. getBaseSchema(CLIENT_CENTRAL) — confirms schema introspection
//   4. list(CLIENT_CENTRAL, 'Contract Agreement') first 3 records — confirms reads
//
// Visit /admin/airtable-test to verify the data layer before building UI on top.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { getAdapter, BASE_IDS, DataAdapterError } from '@/lib/data';
import { createClient, getAuthUser } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface CheckResult {
	label: string;
	status: 'ok' | 'fail' | 'warn';
	detail: string;
	data?: unknown;
}

async function runChecks(): Promise<CheckResult[]> {
	const out: CheckResult[] = [];

	// 1. env var
	out.push({
		label: 'AIRTABLE_PAT env var',
		status: process.env.AIRTABLE_PAT ? 'ok' : 'fail',
		detail: process.env.AIRTABLE_PAT
			? `present (${process.env.AIRTABLE_PAT.slice(0, 12)}…)`
			: 'missing',
	});
	out.push({
		label: 'AIRTABLE_WORKSPACE_ID env var',
		status: process.env.AIRTABLE_WORKSPACE_ID ? 'ok' : 'warn',
		detail: process.env.AIRTABLE_WORKSPACE_ID ?? 'not set (PAT will see all accessible bases)',
	});

	if (!process.env.AIRTABLE_PAT) return out;

	const adapter = getAdapter();

	// 2. listBases
	try {
		const bases = await adapter.listBases();
		out.push({
			label: 'listBases()',
			status: 'ok',
			detail: `${bases.length} bases accessible`,
			data: bases.slice(0, 20),
		});
	} catch (e) {
		out.push({
			label: 'listBases()',
			status: 'fail',
			detail: e instanceof DataAdapterError ? `${e.status} ${e.message}` : String(e),
		});
		return out;
	}

	// 3. getBaseSchema for Client Central
	try {
		const schema = await adapter.getBaseSchema(BASE_IDS.CLIENT_CENTRAL);
		out.push({
			label: `getBaseSchema(CLIENT_CENTRAL)`,
			status: 'ok',
			detail: `"${schema.name}" has ${schema.tables.length} tables`,
			data: schema.tables.map((t) => ({ id: t.id, name: t.name, fields: t.fields.length })),
		});
	} catch (e) {
		out.push({
			label: 'getBaseSchema(CLIENT_CENTRAL)',
			status: 'fail',
			detail: e instanceof DataAdapterError ? `${e.status} ${e.message}` : String(e),
		});
	}

	// 4. list 3 records from Contract Agreement
	try {
		const result = await adapter.list(BASE_IDS.CLIENT_CENTRAL, 'Contract Agreement', {
			pageSize: 3,
			fields: ['Client', 'Client Status', 'Per Month'],
		});
		out.push({
			label: `list(CLIENT_CENTRAL, "Contract Agreement", { pageSize: 3 })`,
			status: 'ok',
			detail: `${result.rows.length} sample records pulled`,
			data: result.rows.map((r) => ({
				id: r.id,
				fields: r.fields,
			})),
		});
	} catch (e) {
		out.push({
			label: 'list(CLIENT_CENTRAL, "Contract Agreement")',
			status: 'fail',
			detail: e instanceof DataAdapterError ? `${e.status} ${e.message}` : String(e),
		});
	}

	return out;
}

export default async function AirtableTestPage() {
	// Gate to exec/admin only — we don't want this leaking PAT-discoverable data
	const supabase = await createClient();
	const user = await getAuthUser();
	if (!user) redirect('/auth/login?redirect=/admin/airtable-test');

	const { data: profile } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();

	if (!profile || !['exec', 'admin'].includes(profile.role)) {
		return (
			<>
				<Card>
					<p className="text-sm text-slate-700 dark:text-slate-300">
						This diagnostic page is restricted to <code>exec</code> and{' '}
						<code>admin</code> roles. Current role:{' '}
						<code>{profile?.role ?? 'unknown'}</code>.
					</p>
				</Card>
			</>
		);
	}

	const checks = await runChecks();
	const passed = checks.filter((c) => c.status === 'ok').length;
	const failed = checks.filter((c) => c.status === 'fail').length;

	return (
		<>
			<div className="mb-6">
				<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
					Airtable connectivity test
				</h1>
				<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
					End-to-end check of the DataAdapter against the Open Ronin workspace.
				</p>
			</div>

			<div className="mb-4 flex items-center gap-3">
				<Badge color={failed > 0 ? 'danger' : 'success'}>
					{passed} passed
					{failed > 0 ? ` · ${failed} failed` : ''}
				</Badge>
				<span className="text-xs text-slate-400">{new Date().toISOString()}</span>
			</div>

			<div className="space-y-3">
				{checks.map((check, i) => (
					<Card key={i}>
						<div className="flex items-start justify-between gap-4">
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2 mb-1">
									<Badge
										color={
											check.status === 'ok'
												? 'success'
												: check.status === 'warn'
													? 'warning'
													: 'danger'
										}
									>
										{check.status.toUpperCase()}
									</Badge>
									<code className="text-sm font-mono text-slate-900 dark:text-slate-100">
										{check.label}
									</code>
								</div>
								<p className="text-sm text-slate-600 dark:text-slate-400 ml-1">
									{check.detail}
								</p>
								{check.data !== undefined && (
									<pre className="mt-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-md text-xs overflow-x-auto text-slate-700 dark:text-slate-300 max-h-80">
										{JSON.stringify(check.data, null, 2)}
									</pre>
								)}
							</div>
						</div>
					</Card>
				))}
			</div>

			<p className="text-xs text-slate-400 mt-6">
				If anything fails: check <code>AIRTABLE_PAT</code> scopes (need{' '}
				<code>data.records:read</code>, <code>data.records:write</code>,{' '}
				<code>schema.bases:read</code>) and workspace access (Open Ronin only).
			</p>
		</>
	);
}
