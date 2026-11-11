// Board-list change signal. The sidebar no longer lists favorite / custom
// boards (they are not rows in the "Alex draft (original)" tab), but the
// board pages and settings still fire this so any listener (the hub) can
// refresh after a favorite or a new board.

/** Fire after anything that changes the board list (favorite, new board). */
export const BOARDS_CHANGED_EVENT = 'or-boards-changed';
