// Section gate for /clients/tickets — same module as /clients (clients module).
import ModuleGate from '@/components/layout/ModuleGate';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ModuleGate module="clients">{children}</ModuleGate>;
}
