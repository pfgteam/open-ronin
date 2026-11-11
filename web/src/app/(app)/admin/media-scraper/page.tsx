// /admin/media-scraper — the Media Scraper lives under Tools at
// /media/media-scraper (0102), following the Lead Scraper's move off /admin
// (capability gate, not admin gate). Its settings (budget cap, cost per
// 1,000 per preset) share /admin/lead-scraper. This URL stays as a redirect
// because the original spec and What's Coming pointed here.

import { redirect } from 'next/navigation';

export default function MediaScraperRedirect() {
	redirect('/media/media-scraper');
}
