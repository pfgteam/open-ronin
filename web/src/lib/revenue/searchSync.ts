// Debounced URL search boxes (Pipeline, Contacts): after we push ?q=, the
// re-render echoes that value back. Re-syncing the input on the echo would
// wipe whatever the user typed meanwhile; only follow URL changes we did not
// make (Back/Forward, "Clear filters").

export function shouldSyncSearchFromUrl(urlQ: string | null, lastPushed: string | null | undefined): boolean {
	return lastPushed === undefined || urlQ !== lastPushed;
}
