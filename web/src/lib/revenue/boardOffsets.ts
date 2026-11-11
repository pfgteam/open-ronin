// Board "Load more" offsets (spec §4.4). Each column remembers how many of
// the server's rows (in the column's server order) it has consumed. A loaded
// card dragged OUT shrinks the server set inside that window, so the next
// page starts one earlier; a card dropped IN can only shift rows we already
// have (the append de-dupes by id), so nothing changes there.

export function offsetsAfterMove(offsets: Record<string, number>, from: string, to: string | null): Record<string, number> {
	void to;
	return { ...offsets, [from]: Math.max(0, (offsets[from] ?? 0) - 1) };
}
