// Section gate for /team — see components/layout/ModuleGate.tsx.
import ModuleGate from '@/components/layout/ModuleGate';

export default function Layout({ children }: { children: React.ReactNode }) {
	return <ModuleGate module="team">{children}</ModuleGate>;
}
