// Section gate — /contacts was one of only three routes with no ModuleGate:
// any signed-in user could read the whole contacts + contact_roles join by
// URL, with only RLS in the way. Contacts belong to client work, so it rides
// the clients module permission.
import ModuleGate from '@/components/layout/ModuleGate';

export default function Layout({ children }: { children: React.ReactNode }) {
	return <ModuleGate module="clients">{children}</ModuleGate>;
}
