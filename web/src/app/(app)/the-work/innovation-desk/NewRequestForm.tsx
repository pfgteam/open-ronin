'use client';

// "New submission" form for the Innovation Desk. Client component only so
// the fields follow the chosen kind (Time Off shows dates, Software/Tool
// Change shows request type + urgency, Innovation Desk shows its type) —
// the old /team/requests form showed every field for every kind with
// "ignored for other kinds" hints. Submits through the server action.

import { useState } from 'react';
import { Field } from '@/app/(app)/team/_form';
import { inputClass, selectClass } from '@/app/(app)/team/_form';
import {
	EMPLOYMENT_TYPES,
	EMPLOYMENT_TYPE_LABELS,
	INNOVATION_TYPES,
	INNOVATION_TYPE_LABELS,
	KIND_LABELS,
	DESK_FORM_KINDS,
	type RequestKind,
} from '@/lib/requests/kinds';
import { createStaffRequest } from './actions';

export default function NewRequestForm({ returnTo }: { returnTo: string }) {
	const [kind, setKind] = useState<RequestKind>('innovation');
	return (
		<form action={createStaffRequest} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
			<input type="hidden" name="return_to" value={returnTo} />
			<Field label="Kind">
				<select name="kind" className={selectClass} required value={kind} onChange={(e) => setKind(e.target.value as RequestKind)}>
					{DESK_FORM_KINDS.map((k) => (
						<option key={k} value={k}>
							{KIND_LABELS[k]}
						</option>
					))}
				</select>
			</Field>
			<Field label="Title">
				<input name="title" className={inputClass} required minLength={3} maxLength={200} />
			</Field>

			{kind === 'innovation' && (
				<Field label="Type" hint="What kind of submission this is. Alex reviews all of them.">
					<select name="innovation_type" className={selectClass} required defaultValue="process_insight">
						{INNOVATION_TYPES.map((t) => (
							<option key={t} value={t}>
								{INNOVATION_TYPE_LABELS[t]}
							</option>
						))}
					</select>
				</Field>
			)}

			{kind === 'time_off' && (
				<>
					<Field label="Start date">
						<input type="date" name="starts_on" className={inputClass} required />
					</Field>
					<Field label="End date">
						<input type="date" name="ends_on" className={inputClass} required />
					</Field>
					<Field label="Time-off type">
						<select name="time_off_kind" className={selectClass} defaultValue="vacation">
							<option value="vacation">Vacation</option>
							<option value="sick">Sick</option>
							<option value="personal">Personal</option>
							<option value="holiday">Holiday</option>
						</select>
					</Field>
				</>
			)}

			{kind === 'headcount_request' && (
				<>
					<Field label="Role title">
						<input name="role_title" className={inputClass} required minLength={2} maxLength={120} placeholder="Senior Publicist" />
					</Field>
					<Field label="Employment type">
						<select name="employment_type" className={selectClass} defaultValue="full_time">
							{EMPLOYMENT_TYPES.map((t) => (
								<option key={t} value={t}>
									{EMPLOYMENT_TYPE_LABELS[t]}
								</option>
							))}
						</select>
					</Field>
					<Field label="How many">
						<input type="number" name="headcount" className={inputClass} min={1} max={50} defaultValue={1} />
					</Field>
					<Field label="Department">
						<input name="department" className={inputClass} maxLength={80} placeholder="Media" />
					</Field>
					<Field label="Target start">
						<input type="date" name="target_start_on" className={inputClass} />
					</Field>
					<Field label="Annual budget (USD)" hint="Fully loaded, per head. Optional.">
						<input type="number" name="budget_annual_usd" className={inputClass} min={0} step={1000} />
					</Field>
				</>
			)}

			{kind === 'software_change' && (
				<>
					<Field label="Request type">
						<select name="request_type" className={selectClass} required defaultValue="feature_request">
							<option value="new_tool">New Tool</option>
							<option value="access_change">Access Change</option>
							<option value="feature_request">Feature Request</option>
						</select>
					</Field>
					<Field label="Urgency">
						<select name="urgency" className={selectClass} defaultValue="normal">
							<option value="low">Low</option>
							<option value="normal">Normal</option>
							<option value="high">High</option>
							<option value="blocking">Blocking</option>
						</select>
					</Field>
				</>
			)}

			<Field
				label="Details"
				wide
				hint={
					kind === 'innovation'
						? 'The insight, the change you want, or the project. What problem it solves and for whom.'
						: kind === 'headcount_request'
							? 'Why the role, what it owns, what breaks without it. Alex reviews headcount.'
							: 'Context, links, anything the reviewer needs.'
				}
			>
				<textarea name="body_md" rows={4} className={inputClass} maxLength={5000} />
			</Field>
			<div className="sm:col-span-2">
				<button type="submit" className="rounded-md bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2">
					Submit
				</button>
			</div>
		</form>
	);
}
