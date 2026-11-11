'use client';

// BriefForm: the shared brief (client, goal, platform, length, tone, hook
// style) used by Scripts and Headlines. Controlled; the page owns the state.

import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { HOOK_STYLES, LENGTHS, PLATFORMS, TONES, type Brief } from '@/lib/content-studio/shared';

interface Props {
	brief: Brief;
	onChange: (b: Brief) => void;
	clients: { id: string; name: string; status: string }[];
	disabled?: boolean;
	/** Headlines does not need a length. */
	showLength?: boolean;
}

export default function BriefForm({ brief, onChange, clients, disabled, showLength = true }: Props) {
	const set = <K extends keyof Brief>(k: K, v: Brief[K]) => onChange({ ...brief, [k]: v });
	return (
		<div className="space-y-3">
			<Select label="Client" value={brief.clientId} onChange={(e) => set('clientId', e.target.value)} disabled={disabled}>
				<option value="">No client (general)</option>
				{clients.map((c) => (
					<option key={c.id} value={c.id}>
						{c.name}
						{c.status !== 'active' ? ` (${c.status})` : ''}
					</option>
				))}
			</Select>
			<Textarea
				label="Goal"
				placeholder="What should this piece do? e.g. Announce the spring launch to founders who care about sustainable packaging."
				value={brief.goal}
				onChange={(e) => set('goal', e.target.value)}
				disabled={disabled}
				maxLength={1000}
			/>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<Select label="Platform" value={brief.platform} onChange={(e) => set('platform', e.target.value)} disabled={disabled}>
					{PLATFORMS.map((p) => (
						<option key={p} value={p}>
							{p}
						</option>
					))}
				</Select>
				{showLength && (
					<Select label="Length" value={brief.length} onChange={(e) => set('length', e.target.value)} disabled={disabled}>
						{LENGTHS.map((l) => (
							<option key={l.value} value={l.value}>
								{l.label}
							</option>
						))}
					</Select>
				)}
				<Select label="Tone" value={brief.tone} onChange={(e) => set('tone', e.target.value)} disabled={disabled}>
					{TONES.map((t) => (
						<option key={t} value={t}>
							{t}
						</option>
					))}
				</Select>
				<Select label="Hook style" value={brief.hookStyle} onChange={(e) => set('hookStyle', e.target.value)} disabled={disabled}>
					{HOOK_STYLES.map((h) => (
						<option key={h} value={h}>
							{h}
						</option>
					))}
				</Select>
			</div>
		</div>
	);
}
