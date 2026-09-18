'use client';

import Link from 'next/link';
import { useRef, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Camera, KeyRound, Laptop, Save, ShieldCheck, Trash2, UserCircle } from 'lucide-react';
import {
  Badge,
  Button,
  buttonClasses,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  PageHeader,
  Select,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
  useToast,
} from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { sessionsApi, usersApi } from '@/lib/api';
import { ApiError } from '@/lib/api/http';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDate, formatDateTime } from '@/lib/utils/format';
import { ROLE_LABEL, USER_STATUS } from '@/lib/utils/status';
import type { UserRecord } from '@/types/domain';

const AVATAR_ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];
const MAX_AVATAR_PIXELS = 256;

function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('The selected file is not a valid image.'));
      image.onload = () => {
        let { width, height } = image;
        const longest = Math.max(width, height);
        if (longest > MAX_AVATAR_PIXELS) {
          const scale = MAX_AVATAR_PIXELS / longest;
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not prepare the image for upload.'));
          return;
        }
        ctx.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

const LANGUAGE_LABEL: Record<string, string> = {
  en: 'English',
  sw: 'Kiswahili',
};

const TIMEZONES = [
  'Africa/Nairobi',
  'Africa/Kampala',
  'Africa/Dar_es_Salaam',
  'Africa/Kigali',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Europe/London',
  'UTC',
];

const profileSchema = z.object({
  name: z.string().min(2, 'Name is required').max(120, 'Name is too long'),
});

const preferencesSchema = z.object({
  language: z.string().min(1),
  timezone: z.string().min(1),
});

type ProfileValues = z.infer<typeof profileSchema>;
type PreferenceValues = z.infer<typeof preferencesSchema>;

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, logout } = useAuth();

  const me = useQuery({ queryKey: ['users', 'me'], queryFn: () => usersApi.me() });
  const sessions = useQuery({ queryKey: ['auth', 'sessions'], queryFn: () => sessionsApi.list() });

  const preferences = (me.data?.preferences ?? {}) as { language?: string; timezone?: string };

  const profileForm = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    values: me.data ? { name: me.data.name } : undefined,
  });

  const preferenceForm = useForm<PreferenceValues>({
    resolver: zodResolver(preferencesSchema),
    values: {
      language: preferences.language ?? 'en',
      timezone: preferences.timezone ?? 'Africa/Nairobi',
    },
  });

  const onError = (error: unknown) =>
    toast({
      tone: 'error',
      title: 'Could not save profile',
      description: error instanceof ApiError ? error.message : 'Please try again.',
    });

  const saveProfile = useMutation({
    mutationFn: (values: ProfileValues) => usersApi.updateMe({ name: values.name.trim() }),
    onSuccess: (updated) => {
      toast({ tone: 'success', title: 'Profile updated' });
      queryClient.setQueryData(['users', 'me'], updated);
      void queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
    },
    onError,
  });

  const savePreferences = useMutation({
    mutationFn: (values: PreferenceValues) =>
      usersApi.updateMe({
        preferences: { ...(me.data?.preferences ?? {}), ...values },
      }),
    onSuccess: (updated) => {
      toast({ tone: 'success', title: 'Preferences saved' });
      queryClient.setQueryData(['users', 'me'], updated);
      void queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
    },
    onError,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const publishAvatar = (updated: UserRecord) => {
    queryClient.setQueryData(['users', 'me'], updated);
    void queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
  };

  const uploadAvatar = useMutation({
    mutationFn: (dataUrl: string) => usersApi.uploadAvatar(dataUrl),
    onSuccess: (updated) => {
      toast({ tone: 'success', title: 'Profile photo updated' });
      publishAvatar(updated);
    },
    onError,
  });

  const removeAvatar = useMutation({
    mutationFn: () => usersApi.removeAvatar(),
    onSuccess: (updated) => {
      toast({ tone: 'success', title: 'Profile photo removed' });
      publishAvatar(updated);
    },
    onError,
  });

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!AVATAR_ACCEPT.includes(file.type)) {
      toast({
        tone: 'error',
        title: 'Unsupported image type',
        description: 'Use PNG, JPEG, WebP, GIF or AVIF.',
      });
      return;
    }
    void fileToAvatarDataUrl(file)
      .then((dataUrl) => uploadAvatar.mutate(dataUrl))
      .catch((error: unknown) =>
        toast({
          tone: 'error',
          title: 'Could not read image',
          description: error instanceof Error ? error.message : 'Please try again.',
        }),
      );
  };

  const revokeSession = useMutation({
    mutationFn: (id: string) => sessionsApi.revoke(id),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Session revoked' });
      void queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Could not revoke session',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  const revokeAll = useMutation({
    mutationFn: () => sessionsApi.revokeAll(),
    onSuccess: async () => {
      toast({ tone: 'success', title: 'Signed out of all devices' });
      await logout();
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Could not sign out devices',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description="Your personal details, preferences and active sign-in sessions."
      />

      <div className="flex items-start gap-4 rounded-xl border border-ink-100 bg-white p-5 sm:items-center">
        <span className="group relative inline-flex">
          {me.data ? (
            <UserAvatar name={me.data.name} email={me.data.email} src={me.data.avatarUrl} size={64} />
          ) : (
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-ink-400">
              <UserCircle className="h-8 w-8" />
            </span>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadAvatar.isPending}
            className="absolute inset-x-0 bottom-0 flex h-6 items-center justify-center gap-1 rounded-b-full bg-ink-900/70 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-40"
            title="Change profile photo"
          >
            <Camera className="h-3 w-3" aria-hidden /> Change
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={AVATAR_ACCEPT.join(',')}
            className="hidden"
            aria-label="Upload profile photo"
            onChange={handleAvatarChange}
          />
        </span>
        <div className="min-w-0">
          <p className="truncate font-sans text-lg font-bold text-ink-900">
            {me.data?.name ?? '—'}
          </p>
          <p className="truncate text-sm text-ink-500">{me.data?.email ?? user?.email ?? ''}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone="brand">{me.data ? ROLE_LABEL[me.data.role] : '—'}</Badge>
            {me.data ? (
              <Badge tone={USER_STATUS[me.data.status].tone}>{USER_STATUS[me.data.status].label}</Badge>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-ink-500">
            {me.data?.avatarUrl ? (
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 h-7 px-2 text-xs text-ink-500 hover:text-error"
                loading={removeAvatar.isPending}
                onClick={() => removeAvatar.mutate()}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove photo
              </Button>
            ) : (
              <span>
                No photo yet — we look up your{' '}
                <button
                  type="button"
                  className="underline decoration-dotted underline-offset-2"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Gmail/Gravatar
                </button>{' '}
                image automatically, or use your initials.
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <UserCircle className="h-5 w-5 text-brand" aria-hidden />
            <CardTitle>Personal details</CardTitle>
          </CardHeader>
          <CardContent>
            {me.isLoading ? (
              <SkeletonTable rows={3} columns={2} />
            ) : (
              <form
                className="grid grid-cols-1 gap-4 sm:grid-cols-2"
                onSubmit={profileForm.handleSubmit((v) => saveProfile.mutate(v))}
                noValidate
              >
                <Field
                  label="Full name"
                  htmlFor="profileName"
                  error={profileForm.formState.errors.name?.message}
                  required
                  className="sm:col-span-2"
                >
                  <Input id="profileName" {...profileForm.register('name')} />
                </Field>
                <Field
                  label="Email"
                  htmlFor="profileEmail"
                  hint="Contact an administrator to change your sign-in email."
                  className="sm:col-span-2"
                >
                  <Input id="profileEmail" value={me.data?.email ?? ''} readOnly disabled />
                </Field>
                <div className="flex items-center gap-4 text-sm text-ink-500 sm:col-span-2">
                  <span>Joined {me.data ? formatDate(me.data.createdAt) : '—'}</span>
                  <span>
                    Last sign-in {me.data?.lastLoginAt ? formatDateTime(me.data.lastLoginAt) : '—'}
                  </span>
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" loading={saveProfile.isPending}>
                    <Save className="h-4 w-4" /> Save details
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-brand" aria-hidden />
            <CardTitle>Preferences</CardTitle>
          </CardHeader>
          <CardContent>
            {me.isLoading ? (
              <SkeletonTable rows={2} columns={2} />
            ) : (
              <form
                className="grid grid-cols-1 gap-4 sm:grid-cols-2"
                onSubmit={preferenceForm.handleSubmit((v) => savePreferences.mutate(v))}
                noValidate
              >
                <Field label="Language" htmlFor="language">
                  <Select id="language" {...preferenceForm.register('language')}>
                    {Object.entries(LANGUAGE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Timezone" htmlFor="timezone">
                  <Select id="timezone" {...preferenceForm.register('timezone')}>
                    {TIMEZONES.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="sm:col-span-2">
                  <Button type="submit" variant="secondary" loading={savePreferences.isPending}>
                    <Save className="h-4 w-4" /> Save preferences
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center gap-3">
          <KeyRound className="h-5 w-5 text-brand" aria-hidden />
          <CardTitle>Password &amp; security</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-ink-900">Password</p>
              <p className="text-ink-500">
                Send a reset link to your email to choose a new password.
              </p>
            </div>
            <Link href="/forgot-password" className={buttonClasses({ variant: 'secondary', size: 'md' })}>
              Reset password
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
            <span className="text-ink-500">Email verification</span>
            {me.data?.emailVerifiedAt ? (
              <Badge tone="success">Verified {formatDate(me.data.emailVerifiedAt)}</Badge>
            ) : (
              <Badge tone="warning">Not verified</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <Laptop className="h-5 w-5 text-brand" aria-hidden />
            <CardTitle>Active sessions</CardTitle>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="text-error"
            loading={revokeAll.isPending}
            disabled={(sessions.data ?? []).length === 0}
            onClick={() => revokeAll.mutate()}
          >
            Sign out all devices
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          <TableWrapper className="border-0">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Device</TableHeaderCell>
                  <TableHeaderCell>IP address</TableHeaderCell>
                  <TableHeaderCell>Signed in</TableHeaderCell>
                  <TableHeaderCell>Expires</TableHeaderCell>
                  <TableHeaderCell />
                </tr>
              </TableHead>
              <TableBody>
                {(sessions.data ?? []).map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="max-w-[280px] truncate font-medium text-ink-900">
                      {session.userAgent ?? 'Unknown device'}
                    </TableCell>
                    <TableCell>{session.ipAddress ?? '—'}</TableCell>
                    <TableCell>{formatDateTime(session.createdAt)}</TableCell>
                    <TableCell>{formatDateTime(session.expiresAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-error"
                        loading={revokeSession.isPending && revokeSession.variables === session.id}
                        onClick={() => revokeSession.mutate(session.id)}
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(sessions.data ?? []).length === 0 ? (
                  <TableEmpty colSpan={5}>
                    {sessions.isLoading ? 'Loading sessions…' : 'No active sessions.'}
                  </TableEmpty>
                ) : null}
              </TableBody>
            </Table>
          </TableWrapper>
        </CardContent>
      </Card>
    </div>
  );
}
