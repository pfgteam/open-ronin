// Section gate for /data — BaseExplorer is the advanced layer, not the front
// door (plan N2). Access now comes from the module × role matrix (0024):
// grant a role the Data module in /admin/roles and both this gate and the
// data_* RLS policies follow, no deploy needed.
import ModuleGate from '@/components/layout/ModuleGate';

export default function Layout({ children }: { children: React.ReactNode }) {
	return <ModuleGate module="data">{children}</ModuleGate>;
}
