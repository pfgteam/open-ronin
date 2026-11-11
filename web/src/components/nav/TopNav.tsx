'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LogOut, CalendarDays } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import NotificationBell from './NotificationBell';
import GlobalSearch from './GlobalSearch';
import { calendarItem, isItemVisible, navSections, profileMenuItems, SIGN_OUT_LABEL } from './navConfig';
import { menuLanding, visibleNav } from './navModel';
import { useCurrentSection } from './menuPreference';
import { sectionIcons } from './navIcons';
import { applyStoredTheme } from './theme';
import { DEFAULT_IDENTITY, type Identity } from '@/lib/design/settings';

// The top menus (Work, Clients, Growth, Studio, Team, Management) and the
// top buttons from the "Alex draft (original)" tab (navConfig.ts): on the
// right, left to right, Search, Calendar, Notifications, Profile. The
// Profile menu shows Name, Email, Role, then My Profile / Requests /
// Settings / Sign Out. Light/Dark lives on the Settings page.

export default function TopNav({ identity = DEFAULT_IDENTITY, sectionsOff = [] }: { identity?: Identity; sectionsOff?: string[] }) {
	const pathname = usePathname();
	const router = useRouter();
	const { user, profile, modules, logout, init, initialized } = useAuthStore();
	const [dropOpen, setDropOpen] = useState(false);
	// Responsive labels: when the item row would overflow the available width,
	// drop the text labels and keep icon-only links (Sam, 18/08/2026).
	const [iconsOnly, setIconsOnly] = useState(false);
	const navRef = useRef<HTMLElement>(null);
	const fullWidthRef = useRef(0);
	const dropRef = useRef<HTMLDivElement>(null);

	// Initialize auth store on first render
	useEffect(() => {
		if (!initialized) void init();
	}, [initialized, init]);

	// Apply the stored theme (Settings › Light/Dark) or the system default.
	useEffect(() => {
		applyStoredTheme();
	}, []);

	// Measure overflow: labels off when the row doesn't fit; back on when the
	// container regrows past the last known full (labels-visible) width.
	useEffect(() => {
		const el = navRef.current;
		if (!el) return;
		const check = () => {
			if (!iconsOnly) {
				if (el.scrollWidth > el.clientWidth + 1) {
					fullWidthRef.current = el.scrollWidth;
					setIconsOnly(true);
				}
			} else if (fullWidthRef.current > 0 && el.clientWidth > fullWidthRef.current + 24) {
				setIconsOnly(false);
			}
		};
		check();
		const ro = new ResizeObserver(check);
		ro.observe(el);
		return () => ro.disconnect();
	}, [iconsOnly, profile, modules]);

	// Close dropdown on outside click
	useEffect(() => {
		function handler(e: MouseEvent) {
			if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
				setDropOpen(false);
			}
		}
		if (dropOpen) {
			document.addEventListener('mousedown', handler);
			return () => document.removeEventListener('mousedown', handler);
		}
	}, [dropOpen]);

	// Defers to the shared resolver, so a menu that adopted another module's
	// page (Studio → /media/lead-scraper) stays lit while you are on it, and
	// the sidebar shows the same menu.
	const currentSection = useCurrentSection(pathname);

	// Each menu opens where the sheet says it lands (its major title's first
	// row) for THIS viewer; a menu with nothing visible is not shown.
	const menus = useMemo(
		() =>
			navSections
				.filter((s) => !sectionsOff.includes(s.key) && isItemVisible(s, profile, modules))
				.map((s) => ({ key: s.key, label: s.label, icon: sectionIcons[s.key], href: menuLanding(visibleNav(s.groups, { profile, modules })) ?? s.href })),
		[profile, modules, sectionsOff],
	);

	const profileLinks = profile
		? profileMenuItems
				.filter((item) => isItemVisible(item, profile, modules))
				.map((item) => ({ ...item, href: item.href.replace('{me}', profile.id) }))
		: [];

	async function handleLogout() {
		setDropOpen(false);
		await logout();
		router.push('/auth/login');
	}

	const initials = (() => {
		if (profile?.first_name || profile?.last_name) {
			return `${profile.first_name?.[0] ?? ''}${profile.last_name?.[0] ?? ''}`.toUpperCase();
		}
		if (user?.email) return user.email[0]?.toUpperCase() ?? '?';
		return '?';
	})();

	const displayName =
		profile?.first_name || profile?.last_name
			? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
			: (user?.email ?? '');

	// Uploaded photo first, legacy/OAuth avatar second — the precedence
	// team/[id], the directory and the org chart all use. Empty strings are
	// treated as absent so a blank column falls back to initials.
	const avatarUrl = profile?.photo_url?.trim() || profile?.avatar_url?.trim() || null;

	return (
		<header className="h-12 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center px-3.5 gap-4 z-40 sticky top-0">
			{/* Logo — lime square mark + Open Ronin wordmark (Work Revamp, 2026-10-01).
			    The container spans the sidebar width (via --or-sidenav-w, set by
			    SideNav) so the divider aligns with the sidebar's right border. The
			    header has px-3.5, hence the -0.875rem; minWidth keeps the natural
			    layout on pages without a sidebar. */}
			<div
				className="flex items-center shrink-0 gap-2"
				style={{ width: 'calc(var(--or-sidenav-w, 0px) - 0.875rem)', minWidth: 'fit-content' }}
			>
				{/* pl-2.5 lines the mark up with the sidebar links' own padding
				    (they sit px-2 inside a px-2 nav). The roundel only fills in on
				    <sm, where the wordmark is hidden and the header needs SOME mark. */}
				<Link href="/" className="flex items-center gap-1.5 shrink-0 mr-auto pl-2.5 group">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img
						src={identity.logoLight}
						alt={identity.orgName}
						className="w-7 h-7 rounded-full sm:hidden dark:hidden"
					/>
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img
						src={identity.logoDark}
						alt={identity.orgName}
						className="w-7 h-7 rounded-full hidden max-sm:dark:block"
					/>
					<span className="hidden sm:block w-2.5 h-2.5 rounded-[3px] bg-accent-600 group-hover:bg-accent-500 transition-colors" aria-hidden="true" />
					<span className="font-bold text-sm hidden sm:block leading-none tracking-tight text-slate-900 dark:text-slate-100">
						{identity.appName}
					</span>
				</Link>

				{/* Divider — right edge of the logo container = sidebar border */}
				<div className="h-5 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />
			</div>

			{/* Top menus — gated per viewer. overflow-x keeps narrow screens
			    usable; the scrollbar itself is hidden (Sam, 2026-08-12). */}
			<nav ref={navRef} aria-label="Top menu" className="flex items-center gap-0.5 flex-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
				{menus.map((item) => {
					const Icon = item.icon;
					const active = currentSection === item.key;
					return (
						<Link
							key={item.key}
							href={item.href}
							className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-13 transition-colors duration-150 whitespace-nowrap ${
								active
									? 'bg-primary-50 dark:bg-primary-950 text-primary-900 dark:text-primary-300 font-semibold'
									: 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100'
							}`}
							title={item.label}
							aria-label={item.label}
						>
							<Icon className="w-4 h-4" aria-hidden="true" />
							{!iconsOnly && <span className="hidden md:inline">{item.label}</span>}
						</Link>
					);
				})}
			</nav>

			{/* Top buttons, left to right: Search, Calendar, Notifications, Profile. */}
			<GlobalSearch />

			<div className="flex items-center gap-2 shrink-0">
				{/* Calendar — same engine as Work › Planning Calendars. */}
				<Link
					href={calendarItem.href}
					aria-label={calendarItem.label}
					title={calendarItem.label}
					className={`p-1.5 rounded-md transition-colors ${
						pathname === calendarItem.href || pathname.startsWith(`${calendarItem.href}/`)
							? 'bg-primary-50 dark:bg-primary-950 text-primary-900 dark:text-primary-300'
							: 'text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700'
					}`}
				>
					<CalendarDays className="w-4 h-4" aria-hidden="true" />
				</Link>
				<NotificationBell />

				<div className="relative" ref={dropRef}>
					<button
						onClick={() => setDropOpen(!dropOpen)}
						aria-label="Profile"
						aria-haspopup="menu"
						aria-expanded={dropOpen}
						className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
					>
						{/* Photo when there is one, initials otherwise. A plain <img>,
						    not next/image: the Supabase storage host is not in
						    next.config's remotePatterns. */}
						{avatarUrl ? (
							// eslint-disable-next-line @next/next/no-img-element
							<img
								src={avatarUrl}
								alt=""
								className="w-7 h-7 rounded-full object-cover bg-slate-100 dark:bg-slate-700"
							/>
						) : (
							<div className="w-7 h-7 rounded-full bg-primary-600 flex items-center justify-center text-white text-2xs font-semibold ring-2 ring-white dark:ring-slate-800">
								{initials}
							</div>
						)}
						<span className="hidden 2xl:inline text-xs text-slate-700 dark:text-slate-300">
							{displayName || 'Loading…'}
						</span>
					</button>

					{dropOpen && (
						<div className="absolute right-0 top-full mt-1.5 w-56 bg-white dark:bg-slate-800 rounded-lg shadow-panel border border-slate-200 dark:border-slate-700 py-1 z-50">
							{/* Name, Email, Role */}
							<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
								<p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
									{displayName || user?.email}
								</p>
								<p className="text-xs text-slate-500 dark:text-slate-400 truncate">
									{user?.email}
								</p>
								{profile?.role && (
									<p className="text-xs text-primary-600 dark:text-primary-400 mt-0.5 capitalize">
										{profile.role}
									</p>
								)}
							</div>
							{/* My Profile, Requests, Settings */}
							<div className="py-1 border-b border-slate-200 dark:border-slate-700">
								{profileLinks.map((item) => (
									<Link
										key={item.href}
										href={item.href}
										onClick={() => setDropOpen(false)}
										className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
									>
										<span className="flex-1 truncate">{item.label}</span>
									</Link>
								))}
							</div>
							<button
								onClick={handleLogout}
								className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
							>
								<LogOut className="w-4 h-4" />
								{SIGN_OUT_LABEL}
							</button>
						</div>
					)}
				</div>
			</div>
		</header>
	);
}
