'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Spinner,
  useToast,
} from '@/components/ui';
import { notificationsApi } from '@/lib/api';
import { ApiError } from '@/lib/api/http';
import { relativeTime } from '@/lib/utils/format';

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list({ limit: 100 }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: invalidate,
    onError: (error) =>
      toast({ tone: 'error', title: 'Could not update', description: error instanceof ApiError ? error.message : 'Try again.' }),
  });

  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      toast({ tone: 'success', title: 'All notifications marked as read' });
      invalidate();
    },
    onError: (error) =>
      toast({ tone: 'error', title: 'Could not update', description: error instanceof ApiError ? error.message : 'Try again.' }),
  });

  const items = list.data ?? [];
  const unreadCount = items.filter((item) => item.status === 'UNREAD').length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        description="Stock alerts, invoice activity and system messages."
        actions={
          <Button variant="secondary" disabled={unreadCount === 0} loading={markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
        }
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>All notifications</CardTitle>
          {unreadCount > 0 ? <Badge tone="brand">{unreadCount} unread</Badge> : null}
        </CardHeader>
        <CardContent className="pt-0">
          {list.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={Bell} title="No notifications" description="You are all caught up." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {items.map((item) => {
                const tone: 'brand' | 'muted' = item.status === 'UNREAD' ? 'brand' : 'muted';
                return (
                  <li key={item.id} className="flex items-start gap-4 py-4">
                    <span className="mt-1 inline-flex h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden style={{ opacity: item.status === 'UNREAD' ? 1 : 0 }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink-900">{item.title}</p>
                        <Badge tone={tone}>{item.status === 'UNREAD' ? 'Unread' : 'Read'}</Badge>
                      </div>
                      {item.message ? <p className="mt-0.5 text-sm text-ink-500">{item.message}</p> : null}
                      <p className="mt-1 text-xs text-ink-500">{relativeTime(item.createdAt)}</p>
                    </div>
                    {item.status === 'UNREAD' ? (
                      <Button variant="ghost" size="sm" onClick={() => markRead.mutate(item.id)}>
                        Mark read
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}