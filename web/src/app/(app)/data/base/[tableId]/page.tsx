import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import TableGridClient from './TableGridClient';

interface PageProps {
  params: Promise<{ tableId: string }>;
}

export const dynamic = 'force-dynamic';

export default async function TableGridPage({ params }: PageProps) {
  const { tableId } = await params;
  const profile = await getAuthProfile();
  if (!profile) notFound();

  const supabase = await createClient();
  const { data: table, error } = await supabase
    .from('nt_tables')
    .select('id, name')
    .eq('id', tableId)
    .single();

  if (error || !table) notFound();

  // useSearchParams() in the client (view=<id> deep links) needs a Suspense boundary.
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-slate-400">Loading…</div>}>
      <TableGridClient tableId={tableId} tableName={table.name} />
    </Suspense>
  );
}
