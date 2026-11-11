// Section gate for the Revenue Engine (0121): its own module key so the
// lanes can be tightened per role later. RLS (can_view_revenue) is the real
// guard; this stops direct URLs when the matrix says no.
import ModuleGate from '@/components/layout/ModuleGate';

export default function Layout({ children }: { children: React.ReactNode }) {
	return <ModuleGate module="prospects">{children}</ModuleGate>;
}
