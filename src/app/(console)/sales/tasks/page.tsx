import { SalesTasks } from '@/components/crm/tasks';

export const metadata = { title: 'Tasks' };

export default async function Page({ searchParams }: { searchParams: Promise<{ create?: string; task?: string }> }) {
  const params = await searchParams;
  const task = params.task && /^[0-9a-f-]{36}$/.test(params.task) ? params.task : undefined;
  return <SalesTasks initialCreate={params.create === 'task'} initialTask={task} />;
}
