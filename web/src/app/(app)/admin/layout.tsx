// Section gate for /admin — see components/layout/ModuleGate.tsx.
import ModuleGate from '@/components/layout/ModuleGate';

export default function Layout({ children }: { children: React.ReactNode }) {
	return <ModuleGate module="admin">{children}</ModuleGate>;
}
