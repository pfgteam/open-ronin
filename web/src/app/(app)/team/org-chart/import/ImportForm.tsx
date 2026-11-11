'use client';

// CSV upload form - parses two formats automatically:
//   (A) Simple: name, email, title, department, manager_name, manager_email
//   (B) Lucidchart: Employee ID, Name, Supervisor ID, Image, Role, Cell Phone, Email, Location

import { useState, useTransition } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { importOrgChart } from './actions';
import { CheckCircle2, AlertCircle, Upload } from 'lucide-react';

interface SimpleRow {
	name: string;
	email?: string;
	title?: string;
	department?: string;
	manager_name?: string;
	manager_email?: string;
}

interface LucidRow {
	employee_id: string;
	name: string;
	supervisor_id?: string;
	role?: string;
	email?: string;
	location?: string;
}

type Row = SimpleRow | LucidRow;
type Format = 'simple' | 'lucid';

interface Result {
	updatedProfiles: number;
	graphNodesCreated: number;
	unresolvedManagers: number;
	errors: string[];
}

export default function ImportForm() {
	const [rows, setRows] = useState<Row[]>([]);
	const [format, setFormat] = useState<Format>('simple');
	const [fileName, setFileName] = useState<string | null>(null);
	const [result, setResult] = useState<Result | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	function onFile(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;
		setFileName(file.name);
		setError(null);
		setResult(null);
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const text = String(reader.result ?? '');
				const { parsed, fmt } = parseCsv(text);
				setRows(parsed);
				setFormat(fmt);
			} catch (err) {
				setError(String((err as Error).message ?? err));
			}
		};
		reader.readAsText(file);
	}

	function submit() {
		setError(null);
		setResult(null);
		startTransition(async () => {
			const res = await importOrgChart({ rows });
			if (!res.ok) {
				setError(res.error ?? 'Import failed.');
				return;
			}
			setResult(res.result ?? null);
		});
	}

	return (
		<div>
			<label className="block">
				<input type="file" accept=".csv,text/csv" onChange={onFile} className="block text-sm" />
			</label>

			{fileName && (
				<p className="text-xs text-slate-500 mt-2 flex items-center gap-2">
					{fileName}: {rows.length} rows parsed.
					<Badge color="primary" className="text-2xs">{format === 'lucid' ? 'Lucidchart format' : 'Simple format'}</Badge>
				</p>
			)}
			{rows.length > 0 && (
				<>
					<div className="mt-3 max-h-64 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-md">
						<div className="overflow-x-auto">
						<table className="w-full text-xs">
							<thead className="bg-slate-50/80 dark:bg-slate-900/30">
								<tr>
									{format === 'lucid' ? (
										<>
											<th className="text-left px-2 py-1">Emp ID</th>
											<th className="text-left px-2 py-1">Name</th>
											<th className="text-left px-2 py-1">Role</th>
											<th className="text-left px-2 py-1">Supervisor ID</th>
										</>
									) : (
										<>
											<th className="text-left px-2 py-1">Name</th>
											<th className="text-left px-2 py-1">Title</th>
											<th className="text-left px-2 py-1">Dept</th>
											<th className="text-left px-2 py-1">Manager</th>
										</>
									)}
								</tr>
							</thead>
							<tbody>
								{rows.slice(0, 50).map((r, i) => (
									<tr key={i} className="border-t border-slate-200 dark:border-slate-700">
										{format === 'lucid' ? (
											<>
												<td className="px-2 py-1 font-mono text-2xs text-slate-600 dark:text-slate-400">{(r as LucidRow).employee_id}</td>
												<td className="px-2 py-1">{r.name || <span className="text-slate-400 italic">(open position)</span>}</td>
												<td className="px-2 py-1">{(r as LucidRow).role ?? '—'}</td>
												<td className="px-2 py-1 font-mono text-2xs text-slate-600 dark:text-slate-400">{(r as LucidRow).supervisor_id ?? '—'}</td>
											</>
										) : (
											<>
												<td className="px-2 py-1">{r.name}</td>
												<td className="px-2 py-1">{(r as SimpleRow).title ?? '—'}</td>
												<td className="px-2 py-1">{(r as SimpleRow).department ?? '—'}</td>
												<td className="px-2 py-1">{(r as SimpleRow).manager_name ?? (r as SimpleRow).manager_email ?? '—'}</td>
											</>
										)}
									</tr>
								))}
							</tbody>
						</table>
						</div>
					</div>
					{rows.length > 50 && <p className="text-2xs text-slate-600 dark:text-slate-400 mt-1">+{rows.length - 50} more rows</p>}
					<div className="flex items-center gap-2 mt-3">
						<Button onClick={submit} loading={pending}>
							<Upload className="w-3 h-3" /> Import {rows.length} rows
						</Button>
					</div>
				</>
			)}

			{error && (
				<div className="mt-3 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md px-3 py-2 flex items-center gap-2">
					<AlertCircle className="w-3.5 h-3.5" /> {error}
				</div>
			)}
			{result && (
				<div
					className={
						result.errors.length > 0
							? 'mt-3 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2'
							: 'mt-3 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md px-3 py-2'
					}
				>
					<div className="flex items-center gap-2 font-medium">
						<CheckCircle2 className="w-3.5 h-3.5" />
						{result.errors.length > 0 ? 'Imported with errors.' : 'Imported.'}
					</div>
					<ul className="mt-1 text-xs">
						<li>{result.updatedProfiles} existing profiles updated</li>
						<li>{result.graphNodesCreated} non-matching rows staged as graph nodes</li>
						<li>{result.unresolvedManagers} unresolved manager references</li>
					</ul>
					{result.errors.length > 0 && (
						<ul className="mt-2 text-xs space-y-0.5 border-t border-amber-200 dark:border-amber-800 pt-2">
							{result.errors.slice(0, 15).map((e, i) => (
								<li key={i}>• {e}</li>
							))}
							{result.errors.length > 15 && <li>… +{result.errors.length - 15} more errors</li>}
						</ul>
					)}
				</div>
			)}
		</div>
	);
}

function parseCsv(text: string): { parsed: Row[]; fmt: Format } {
	// Parse CSV respecting quoted multi-line cells
	const records = parseCsvRecords(text);
	if (records.length === 0) return { parsed: [], fmt: 'simple' };

	const header = records[0].map((h) => h.trim().toLowerCase());
	const fmt: Format = header.includes('employee id') || header.includes('supervisor id') ? 'lucid' : 'simple';

	const rows: Row[] = [];
	for (let i = 1; i < records.length; i++) {
		const cols = records[i];
		const obj: Record<string, string> = {};
		for (let j = 0; j < header.length; j++) {
			obj[header[j]] = (cols[j] ?? '').replace(/\n/g, ' ').trim();
		}
		if (fmt === 'lucid') {
			const empId = obj['employee id'] || '';
			const name = obj['name'] || '';
			if (!empId) continue;
			rows.push({
				employee_id: empId,
				name,
				supervisor_id: obj['supervisor id'] || undefined,
				role: obj['role'] || undefined,
				email: obj['email'] || undefined,
				location: obj['location'] || undefined,
			});
		} else {
			const name = obj['name'] || obj['employee'] || obj['full name'] || '';
			if (!name) continue;
			rows.push({
				name,
				email: obj['email'] || undefined,
				title: obj['title'] || obj['role'] || undefined,
				department: obj['department'] || obj['team'] || obj['dept'] || undefined,
				manager_name: obj['manager_name'] || obj['manager'] || obj['reports to'] || undefined,
				manager_email: obj['manager_email'] || undefined,
			});
		}
	}
	return { parsed: rows, fmt };
}

function parseCsvRecords(text: string): string[][] {
	const records: string[][] = [];
	let current: string[] = [];
	let cur = '';
	let q = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '"') {
			if (q && text[i + 1] === '"') { cur += '"'; i++; }
			else q = !q;
		} else if (c === ',' && !q) {
			current.push(cur); cur = '';
		} else if ((c === '\n' || c === '\r') && !q) {
			if (c === '\r' && text[i + 1] === '\n') i++;
			current.push(cur); cur = '';
			if (current.length > 1 || (current.length === 1 && current[0] !== '')) records.push(current);
			current = [];
		} else {
			cur += c;
		}
	}
	if (cur.length > 0 || current.length > 0) {
		current.push(cur);
		records.push(current);
	}
	return records;
}
