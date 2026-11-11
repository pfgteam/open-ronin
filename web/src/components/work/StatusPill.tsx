// The ONE read-only status visual: the status's own colour (work_item_statuses
// .color) as the fill, black or white text by contrast. Lists, cards and the
// Overview use this; the board table and the item panel use the editable
// StatusCell, which paints the same way. Never guess a colour from the slug.

import { clsx } from 'clsx';
import { NEUTRAL_COLOR, readableText, statusDef } from '@/lib/work/boards/groups';
import type { BoardContext } from '@/lib/work/boards/types';

export default function StatusPill({ ctx, kind, status, className }: {
	ctx: Pick<BoardContext, 'statusesByKind'>;
	kind: string;
	status: string;
	className?: string;
}) {
	const s = statusDef(ctx, { kind, status });
	const bg = s.color ?? NEUTRAL_COLOR;
	return (
		<span className={clsx('inline-block max-w-full truncate rounded-md px-2 py-0.5 text-center text-xs font-medium', className)} style={{ background: bg, color: readableText(bg) }} title={s.label}>
			{s.label}
		</span>
	);
}
