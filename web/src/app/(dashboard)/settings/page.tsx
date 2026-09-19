'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, KeyRound, Plus, ReceiptText, Settings2, Trash2, Users } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Modal,
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
import { accountingApi, apiKeysApi, organizationsApi, usersApi } from '@/lib/api';
import { ApiError } from '@/lib/api/http';
import { formatDate, formatDateTime } from '@/lib/utils/format';
import { ROLE_LABEL, USER_STATUS } from '@/lib/utils/status';
import { newIdempotencyKey } from '@/lib/utils/idempotency';
import type { ApiKey, Role } from '@/types/domain';

const orgSchema = z.object({
  name: z.string().min(2, 'Name is required').max(120, 'Name is too long'),
  taxPin: z.string().max(16, 'PIN is too long').optional().or(z.literal('')),
  contactEmail: z.string().email('Enter a valid email').max(160).optional().or(z.literal('')),
  contactPhone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +254712345678')
    .optional()
    .or(z.literal('')),
});

const settingsSchema = z.object({
  taxRate: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'e.g. 16 or 16.00'),
  invoiceNumberFormat: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[A-Z0-9{}:_#-]+$/, 'Use uppercase letters, digits and - _ : # { } only'),
  defaultPaymentTermsDays: z.string().regex(/^\d+$/, 'Whole number of days'),
  financialYearStart: z
    .string()
    .regex(/^\d{2}-\d{2}$/, 'Use MM-DD')
    .optional()
    .or(z.literal('')),
});

const userSchema = z.object({
  name: z.string().min(2, 'Name is required').max(120, 'Name is too long'),
  email: z.string().email('Enter a valid email'),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .max(72)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).*$/, 'Mix uppercase, lowercase and a number'),
  role: z.enum(['ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF', 'READ_ONLY']),
});

const keySchema = z.object({
  name: z.string().min(2, 'Name is required').max(80),
  expiresInDays: z
    .string()
    .regex(/^\d*$/, 'Whole number')
    .refine((value) => value === '' || (Number(value) >= 1 && Number(value) <= 3650), {
      message: 'Enter 1–3650 days',
    })
    .optional()
    .or(z.literal('')),
});

type OrgValues = z.infer<typeof orgSchema>;
type SettingsValues = z.infer<typeof settingsSchema>;
type UserValues = z.infer<typeof userSchema>;
type KeyValues = z.infer<typeof keySchema>;

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [issuedKey, setIssuedKey] = useState<ApiKey | null>(null);

  const org = useQuery({ queryKey: ['organization'], queryFn: () => organizationsApi.me() });
  const settings = useQuery({ queryKey: ['organization', 'settings'], queryFn: () => organizationsApi.settings() });
  const users = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list({ limit: 100 }) });
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => apiKeysApi.list() });

  const orgForm = useForm<OrgValues>({
    resolver: zodResolver(orgSchema),
    values: org.data
      ? {
          name: org.data.name,
          taxPin: org.data.taxPin ?? '',
          contactEmail: org.data.contactEmail ?? '',
          contactPhone: org.data.contactPhone ?? '',
        }
      : undefined,
  });

  const settingsForm = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    values: settings.data
      ? {
          taxRate: settings.data.taxRate,
          invoiceNumberFormat: settings.data.invoiceNumberFormat,
          defaultPaymentTermsDays: String(settings.data.defaultPaymentTermsDays),
          financialYearStart: settings.data.financialYearStart ?? '',
        }
      : undefined,
  });

  const userForm = useForm<UserValues>({
    resolver: zodResolver(userSchema),
    defaultValues: { name: '', email: '', password: '', role: 'STAFF' },
  });

  const keyForm = useForm<KeyValues>({
    resolver: zodResolver(keySchema),
    defaultValues: { name: '', expiresInDays: '' },
  });

  const onError = (error: unknown) =>
    toast({
      tone: 'error',
      title: 'Action failed',
      description: error instanceof ApiError ? error.message : 'Please try again.',
    });

  const saveOrg = useMutation({
    mutationFn: (values: OrgValues) =>
      organizationsApi.update({
        name: values.name.trim(),
        taxPin: values.taxPin?.trim() || undefined,
        contactEmail: values.contactEmail?.trim() || undefined,
        contactPhone: values.contactPhone?.trim() || undefined,
      }),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Organization updated' });
      void queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
    onError,
  });

  const saveSettings = useMutation({
    mutationFn: (values: SettingsValues) =>
      organizationsApi.updateSettings({
        taxRate: values.taxRate,
        invoiceNumberFormat: values.invoiceNumberFormat,
        defaultPaymentTermsDays: values.defaultPaymentTermsDays,
        financialYearStart: values.financialYearStart?.trim() || undefined,
      }),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Settings saved' });
      void queryClient.invalidateQueries({ queryKey: ['organization', 'settings'] });
    },
    onError,
  });

  const createUser = useMutation({
    mutationFn: (values: UserValues) =>
      usersApi.create(
        {
          name: values.name.trim(),
          email: values.email.trim().toLowerCase(),
          password: values.password,
          role: values.role as Role,
        },
        newIdempotencyKey(),
      ),
    onSuccess: () => {
      toast({ tone: 'success', title: 'User invited' });
      setUserModalOpen(false);
      userForm.reset();
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError,
  });

  const removeUser = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      toast({ tone: 'success', title: 'User removed' });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError,
  });

  const createKey = useMutation({
    mutationFn: (values: KeyValues) =>
      apiKeysApi.create(
        {
          name: values.name.trim(),
          expiresInDays: values.expiresInDays ? Number(values.expiresInDays) : undefined,
        },
        newIdempotencyKey(),
      ),
    onSuccess: (key) => {
      setIssuedKey(key);
      setKeyModalOpen(false);
      keyForm.reset();
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError,
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => apiKeysApi.revoke(id),
    onSuccess: () => {
      toast({ tone: 'success', title: 'API key revoked' });
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Manage your organization, tax defaults, team members and API access."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <Building2 className="h-5 w-5 text-brand" aria-hidden />
            <CardTitle>Organization</CardTitle>
          </CardHeader>
          <CardContent>
            {org.isLoading ? (
              <SkeletonTable rows={3} columns={2} />
            ) : (
              <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={orgForm.handleSubmit((v) => saveOrg.mutate(v))} noValidate>
                <Field label="Legal name" htmlFor="orgName" error={orgForm.formState.errors.name?.message} required className="sm:col-span-2">
                  <Input id="orgName" {...orgForm.register('name')} />
                </Field>
                <Field label="KRA PIN" htmlFor="taxPin" error={orgForm.formState.errors.taxPin?.message}>
                  <Input id="taxPin" placeholder="P051234567X" {...orgForm.register('taxPin')} />
                </Field>
                <Field label="Contact phone" htmlFor="contactPhone" error={orgForm.formState.errors.contactPhone?.message} hint="International format, e.g. +254712345678">
                  <Input id="contactPhone" placeholder="+254712345678" {...orgForm.register('contactPhone')} />
                </Field>
                <Field label="Contact email" htmlFor="contactEmail" error={orgForm.formState.errors.contactEmail?.message} className="sm:col-span-2">
                  <Input id="contactEmail" type="email" {...orgForm.register('contactEmail')} />
                </Field>
                <div className="sm:col-span-2">
                  <Button type="submit" loading={saveOrg.isPending}>
                    Save organization
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <Settings2 className="h-5 w-5 text-brand" aria-hidden />
            <CardTitle>Financial defaults</CardTitle>
          </CardHeader>
          <CardContent>
            {settings.isLoading ? (
              <SkeletonTable rows={3} columns={2} />
            ) : (
              <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={settingsForm.handleSubmit((v) => saveSettings.mutate(v))} noValidate>
                <Field label="Default VAT rate (%)" htmlFor="taxRate" error={settingsForm.formState.errors.taxRate?.message} required>
                  <Input id="taxRate" inputMode="decimal" {...settingsForm.register('taxRate')} />
                </Field>
                <Field label="Payment terms (days)" htmlFor="defaultPaymentTermsDays" error={settingsForm.formState.errors.defaultPaymentTermsDays?.message} required>
                  <Input id="defaultPaymentTermsDays" inputMode="numeric" {...settingsForm.register('defaultPaymentTermsDays')} />
                </Field>
                <Field label="Invoice number format" htmlFor="invoiceNumberFormat" error={settingsForm.formState.errors.invoiceNumberFormat?.message} hint="e.g. INV-{YYYY}-{SEQ}" required className="sm:col-span-2">
                  <Input id="invoiceNumberFormat" {...settingsForm.register('invoiceNumberFormat')} />
                </Field>
                <Field label="Financial year start" htmlFor="financialYearStart" error={settingsForm.formState.errors.financialYearStart?.message} hint="e.g. 01-01" className="sm:col-span-2">
                  <Input id="financialYearStart" placeholder="01-01" {...settingsForm.register('financialYearStart')} />
                </Field>
                <div className="sm:col-span-2">
                  <Button type="submit" loading={saveSettings.isPending}>
                    Save defaults
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-brand" aria-hidden />
            <CardTitle>Team members</CardTitle>
          </div>
          <Button size="sm" onClick={() => setUserModalOpen(true)}>
            <Plus className="h-4 w-4" /> Add user
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          <TableWrapper className="border-0">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Email</TableHeaderCell>
                  <TableHeaderCell>Role</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Joined</TableHeaderCell>
                  <TableHeaderCell />
                </tr>
              </TableHead>
              <TableBody>
                {(users.data ?? []).map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium text-ink-900">{member.name}</TableCell>
                    <TableCell>{member.email}</TableCell>
                    <TableCell>
                      <Badge tone="neutral">{ROLE_LABEL[member.role]}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge tone={USER_STATUS[member.status].tone}>{USER_STATUS[member.status].label}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(member.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${member.name}`}
                        className="text-error"
                        onClick={() => removeUser.mutate(member.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(users.data ?? []).length === 0 ? (
                  <TableEmpty colSpan={6}>{users.isLoading ? 'Loading team…' : 'No team members yet.'}</TableEmpty>
                ) : null}
              </TableBody>
            </Table>
          </TableWrapper>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <KeyRound className="h-5 w-5 text-brand" aria-hidden />
            <CardTitle>API keys</CardTitle>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setKeyModalOpen(true)}>
            <Plus className="h-4 w-4" /> Create key
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          <TableWrapper className="border-0">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                  <TableHeaderCell>Last used</TableHeaderCell>
                  <TableHeaderCell>Expires</TableHeaderCell>
                  <TableHeaderCell />
                </tr>
              </TableHead>
              <TableBody>
                {(keys.data ?? []).map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium text-ink-900">{key.name}</TableCell>
                    <TableCell>{formatDate(key.createdAt)}</TableCell>
                    <TableCell>{key.lastUsedAt ? formatDateTime(key.lastUsedAt) : 'Never'}</TableCell>
                    <TableCell>{key.expiresAt ? formatDate(key.expiresAt) : 'No expiry'}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-error"
                        onClick={() => revokeKey.mutate(key.id)}
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(keys.data ?? []).length === 0 ? (
                  <TableEmpty colSpan={5}>{keys.isLoading ? 'Loading keys…' : 'No API keys yet.'}</TableEmpty>
                ) : null}
              </TableBody>
            </Table>
          </TableWrapper>
        </CardContent>
      </Card>

      <Modal
        open={userModalOpen}
        onClose={() => setUserModalOpen(false)}
        title="Add team member"
        description="They will receive their sign-in credentials by email."
        footer={
          <>
            <Button variant="secondary" onClick={() => setUserModalOpen(false)}>
              Cancel
            </Button>
            <Button loading={createUser.isPending} onClick={userForm.handleSubmit((v) => createUser.mutate(v))}>
              Create user
            </Button>
          </>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={userForm.handleSubmit((v) => createUser.mutate(v))} noValidate>
          <Field label="Full name" htmlFor="userName" error={userForm.formState.errors.name?.message} required>
            <Input id="userName" {...userForm.register('name')} />
          </Field>
          <Field label="Email" htmlFor="userEmail" error={userForm.formState.errors.email?.message} required>
            <Input id="userEmail" type="email" {...userForm.register('email')} />
          </Field>
          <Field label="Temporary password" htmlFor="userPassword" error={userForm.formState.errors.password?.message} required>
            <Input id="userPassword" type="password" autoComplete="new-password" {...userForm.register('password')} />
          </Field>
          <Field label="Role" htmlFor="userRole">
            <Select id="userRole" {...userForm.register('role')}>
              {(['ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF', 'READ_ONLY'] as const).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </Select>
          </Field>
        </form>
      </Modal>

      <Modal
        open={keyModalOpen}
        onClose={() => setKeyModalOpen(false)}
        title="Create API key"
        description="The key is shown once — store it securely."
        footer={
          <>
            <Button variant="secondary" onClick={() => setKeyModalOpen(false)}>
              Cancel
            </Button>
            <Button loading={createKey.isPending} onClick={keyForm.handleSubmit((v) => createKey.mutate(v))}>
              Generate key
            </Button>
          </>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={keyForm.handleSubmit((v) => createKey.mutate(v))} noValidate>
          <Field label="Label" htmlFor="keyName" error={keyForm.formState.errors.name?.message} required>
            <Input id="keyName" placeholder="Reporting integration" {...keyForm.register('name')} />
          </Field>
          <Field label="Expires in (days)" htmlFor="expiresInDays" error={keyForm.formState.errors.expiresInDays?.message} hint="Leave blank for no expiry.">
            <Input id="expiresInDays" inputMode="numeric" {...keyForm.register('expiresInDays')} />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(issuedKey)}
        onClose={() => setIssuedKey(null)}
        title="API key created"
        description="Copy this key now. You will not be able to see it again."
        footer={
          <Button onClick={() => setIssuedKey(null)}>Done</Button>
        }
      >
        <div className="rounded-lg border border-ink-300/60 bg-ink-100 p-3">
          <code className="block break-all font-mono text-xs text-ink-900">{issuedKey?.key}</code>
        </div>
      </Modal>
    </div>
  );
}