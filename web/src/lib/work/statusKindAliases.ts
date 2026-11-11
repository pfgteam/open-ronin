// Aliases — kinds without their own status config inherit a sibling's set.
// Post-0016 migration: assignment/strategy/campaign/twelve_week_plan all have
// their own configs. Only the long-tail kinds still need this fallback.
export const STATUS_KIND_ALIASES: Record<string, string> = {
	client_goal:    'client_work',   // until /clients/[id] surface defines its own set
	product_launch: 'event',
	stage:          'task',
	// bug has its own config from 0111; until that applies it borrows task's set
	bug:            'task',
};
