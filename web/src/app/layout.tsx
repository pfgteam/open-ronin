import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import DesignTokens from '@/components/design/DesignTokens';
import { IdentityProvider } from '@/components/design/Identity';
import { getDesignSettings } from '@/lib/design/server';
import { identityOf } from '@/lib/design/settings';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

// The app name in every browser tab comes from Admin › Design system
// (identity.app_name), so another agency's deployment never says Open Ronin.
// The template lets any page set a title and get "X · <app name>".
export async function generateMetadata(): Promise<Metadata> {
	const id = identityOf(await getDesignSettings());
	return {
		title: { default: id.appName, template: `%s · ${id.appName}` },
		description: `${id.orgName} operations platform`,
	};
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	const design = await getDesignSettings();
	return (
		<html lang="en" className={inter.variable}>
			<body className="font-sans antialiased bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
				<DesignTokens settings={design} />
				<IdentityProvider value={identityOf(design)}>{children}</IdentityProvider>
			</body>
		</html>
	);
}
