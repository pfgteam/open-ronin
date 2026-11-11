'use client';

// Identity (app name, organisation name, logos) from Admin › Design system,
// available to any client component without prop drilling. The root layout
// provides it; components fall back to the defaults when rendered outside
// (tests, storybook-style previews).

import { createContext, useContext } from 'react';
import { DEFAULT_IDENTITY, type Identity } from '@/lib/design/settings';

const IdentityContext = createContext<Identity>(DEFAULT_IDENTITY);

export function IdentityProvider({ value, children }: { value: Identity; children: React.ReactNode }) {
	return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): Identity {
	return useContext(IdentityContext);
}

/** The logo pair (light / dark) used by the auth screens. */
export function BrandLogo({ className = 'w-10 h-10 mx-auto mb-3' }: { className?: string }) {
	const id = useIdentity();
	return (
		<>
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img src={id.logoLight} alt={id.orgName} className={`${className} dark:hidden`} />
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img src={id.logoDark} alt={id.orgName} className={`${className} hidden dark:block`} />
		</>
	);
}
