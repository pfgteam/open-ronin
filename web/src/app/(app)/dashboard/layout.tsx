// Section gate for /dashboard — see components/layout/ModuleGate.tsx.
// Management › Dashboards (sheet row 106): general first, then the areas as
// tabs at the top: PageTabs (AppLayout) renders them.
import ModuleGate from '@/components/layout/ModuleGate';

export default function Layout({ children }: { children: React.ReactNode }) {
	return <ModuleGate module="dashboard">{children}</ModuleGate>;
}
