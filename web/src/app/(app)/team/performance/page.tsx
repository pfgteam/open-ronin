// /team/performance — retired 18/08/2026.
//
// This page read the 0005 leaderboard_* tables, which never got a management
// UI and were superseded by the metrics engine (metric_definitions + metrics,
// migration 0025). The tables are dropped in migration 0027; old bookmarks
// land on /team/metrics.

import { redirect } from 'next/navigation';

export default function TeamPerformancePage() {
	redirect('/team/metrics');
}
