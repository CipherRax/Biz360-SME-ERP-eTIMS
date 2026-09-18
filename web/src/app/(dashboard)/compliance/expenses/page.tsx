'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock3,
  FileWarning,
  Link2,
  Plus,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  SkeletonTable,
  StatCard,
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
import { expenseExposureApi, partiesApi, supplierEtimsApi } from '@/lib/api';
import { ApiError } from '@/lib/api/http';
import { formatDate, formatMoney } from '@/lib/utils/format';
import { newIdempotencyKey } from '@/lib/utils/idempotency';
import type { SupplierEtimsInvoice, UnmatchedExpense } from '@/types/domain';

const captureSchema = z.object({
  supplierId: z.string().min(1, 'Select the supplier'),
  kraInvoiceNumber: z.string().min(6, 'Enter the KRA receipt number'),
  invoiceDate: z.string().min(1, 'Receipt date is required'),
  amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter an amount like 1500.00'),
  vatAmount: z
    .string()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter a VAT amount')
    .optional()
    .or(z.literal('')),
  kraQrCodeData: z.string().max(4000).optional().or(z.literal('')),
});
type CaptureValues = z.infer<typeof captureSchema>;

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

export default function ExpenseMatchingPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [captureOpen, setCaptureOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [matchTarget, setMatchTarget] = useState<UnmatchedExpense | null>(null);
  const [scanJob, setScanJob] = useState<string | null>(null);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanSupplier, setScanSupplier] = useState('');
  const [scanBytes, setScanBytes] = useState<number>(0);

  const exposure = useQuery({
    queryKey: ['compliance', 'exposure-summary'],
    queryFn: () => expenseExposureApi.summary(),
  });
  const unmatched = useQuery({
    queryKey: ['compliance', 'unmatched'],
    queryFn: () => supplierEtimsApi.unmatched({ limit: 100 }),
  });
  const suppliers = useQuery({
    queryKey: ['parties', 'suppliers'],
    queryFn: () => partiesApi.list({ type: 'SUPPLIER', status: 'ACTIVE', limit: 200 }),
  });
  const availableReceipts = useQuery({
    queryKey: ['compliance', 'receipts', matchTarget?.supplierId ?? ''],
    queryFn: () =>
      matchTarget
        ? supplierEtimsApi.list({ supplierId: matchTarget.supplierId, matchStatus: 'UNMATCHED' })
        : Promise.resolve({ data: [], nextCursor: undefined }),
    enabled: Boolean(matchTarget),
  });
  const scanStatus = useQuery({
    queryKey: ['compliance', 'scan-job', scanJob],
    queryFn: () => (scanJob ? supplierEtimsApi.scanStatus(scanJob) : Promise.resolve(null)),
    enabled: Boolean(scanJob),
    refetchInterval: 3000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['compliance'] });
    void queryClient.invalidateQueries({ queryKey: ['parties'] });
  };

  const onError = (error: unknown, fallback: string) =>
    toast({
      tone: 'error',
      title: 'Action failed',
      description: error instanceof ApiError ? error.message : fallback,
    });

  const captureForm = useForm<CaptureValues>({
    resolver: zodResolver(captureSchema),
    defaultValues: {
      supplierId: '',
      kraInvoiceNumber: '',
      invoiceDate: new Date().toISOString().slice(0, 10),
      amount: '',
      vatAmount: '',
      kraQrCodeData: '',
    },
  });

  const capture = useMutation({
    mutationFn: (values: CaptureValues) =>
      supplierEtimsApi.capture(
        {
          supplierId: values.supplierId,
          kraInvoiceNumber: values.kraInvoiceNumber.trim(),
          invoiceDate: values.invoiceDate,
          amount: values.amount,
          vatAmount: values.vatAmount || undefined,
          kraQrCodeData: values.kraQrCodeData || undefined,
          captureMethod: 'MANUAL',
        },
        newIdempotencyKey(),
      ),
    onSuccess: (receipt) => {
      toast({ tone: 'success', title: `Receipt ${receipt.kraInvoiceNumber} captured` });
      setCaptureOpen(false);
      captureForm.reset();
      invalidate();
    },
    onError: (error) => onError(error, 'Could not capture receipt'),
  });

  const scan = useMutation({
    mutationFn: async () => {
      if (!scanFile) throw new Error('Choose a receipt photo or PDF first');
      const dataUrl = await fileToDataUrl(scanFile);
      return supplierEtimsApi.scan(
        { data: dataUrl, supplierId: scanSupplier || undefined },
        newIdempotencyKey(),
      );
    },
    onSuccess: (result) => {
      toast({ tone: 'success', title: 'Upload queued', description: `Scan job ${result.jobId.slice(0, 8)}` });
      setScanJob(result.jobId);
      setScanFile(null);
      setScanSupplier('');
      setScanBytes(0);
    },
    onError: (error) => onError(error, 'Could not queue the scan'),
  });

  const match = useMutation({
    mutationFn: ({ receiptId, purchaseInvoiceId }: { receiptId: string; purchaseInvoiceId: string }) =>
      supplierEtimsApi.match(receiptId, { purchaseInvoiceId }, newIdempotencyKey()),
    onSuccess: (receipt) => {
      toast({
        tone: 'success',
        title: `Matched ${receipt.kraInvoiceNumber}`,
      });
      setMatchTarget(null);
      invalidate();
    },
    onError: (error) => onError(error, 'Could not match receipt'),
  });

  const verify = useMutation({
    mutationFn: (receiptId: string) => supplierEtimsApi.verify(receiptId, newIdempotencyKey()),
    onSuccess: () => {
      toast({ tone: 'info', title: 'Verification queued' });
      invalidate();
    },
    onError: (error) => onError(error, 'Could not queue verification'),
  });

  const supplierOptions = suppliers.data ?? [];
  const summary = exposure.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Compliance"
        title="Expense matching"
        description="Bank every supplier eTIMS receipt and match it to the purchase invoice so expenses stay deductible under KRA eTIMS."
        actions={
          <>
            <Button variant="secondary" onClick={() => setScanOpen(true)}>
              <Camera className="h-4 w-4" /> Scan receipt
            </Button>
            <Button onClick={() => setCaptureOpen(true)}>
              <Plus className="h-4 w-4" /> Capture receipt
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Unmatched expenses"
          value={summary ? `${summary.unmatchedCount}` : '—'}
          icon={FileWarning}
          tone={(summary?.unmatchedCount ?? 0) > 0 ? 'warning' : 'success'}
          hint="Purchase invoices without a supplier eTIMS receipt"
        />
        <StatCard
          label="Total exposure"
          value={summary ? formatMoney(summary.totalExposure) : '—'}
          icon={AlertTriangle}
          tone={Number(summary?.totalExposure ?? 0) > 0 ? 'warning' : 'success'}
          hint="Unrecoverable if expenses aren't eTIMS-backed"
        />
        <StatCard
          label="Oldest pending"
          value={summary?.oldestUnmatchedAt ? String(summary.agesInDays) : '—'}
          icon={Clock3}
          tone="info"
          hint={
            summary?.oldestUnmatchedAt
              ? `days since ${formatDate(summary.oldestUnmatchedAt)}`
              : 'No open flags'
          }
        />
      </div>

      {scanJob && scanStatus.data ? (
        <Card className="border-info/30 bg-info/5">
          <CardContent className="flex items-center justify-between py-4 text-sm text-ink-700">
            <span className="flex items-center gap-2">
              <UploadCloud className="h-4 w-4 text-info" />
              Scan job {scanStatus.data.jobId.slice(0, 8)} —{' '}
              {scanStatus.data.jobStatus === 'DONE'
                ? 'complete'
                : scanStatus.data.jobStatus === 'FAILED'
                  ? 'failed'
                  : 'processing…'}
            </span>
            {scanStatus.data.jobStatus === 'FAILED' ? (
              <span className="text-error">{scanStatus.data.error ?? 'OCR provider not configured'}</span>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Unmatched expenses</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {unmatched.isLoading ? (
            <SkeletonTable />
          ) : (unmatched.data?.data ?? []).length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="All expenses matched"
              description="Every purchase invoice has a captured supplier eTIMS receipt."
            />
          ) : (
            <TableWrapper className="border-0">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Invoice</TableHeaderCell>
                    <TableHeaderCell>Supplier</TableHeaderCell>
                    <TableHeaderCell>Date</TableHeaderCell>
                    <TableHeaderCell>Flagged</TableHeaderCell>
                    <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                    <TableHeaderCell />
                  </tr>
                </TableHead>
                <TableBody>
                  {(unmatched.data?.data ?? []).map((item) => (
                    <TableRow key={item.purchaseInvoiceId}>
                      <TableCell className="font-medium text-ink-900">{item.invoiceNumber}</TableCell>
                      <TableCell>{item.supplier}</TableCell>
                      <TableCell>{formatDate(item.invoiceDate)}</TableCell>
                      <TableCell>{item.flaggedAt ? formatDate(item.flaggedAt) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(item.amount)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setMatchTarget(item)}
                        >
                          <Link2 className="h-4 w-4" /> Match
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {(unmatched.data?.data ?? []).length === 0 ? (
                <TableEmpty colSpan={6}>Nothing flagged.</TableEmpty>
              ) : null}
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Captured receipts</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ReceiptsTable onVerify={(id) => verify.mutate(id)} verifyPendingId={verify.isPending ? verify.variables : undefined} />
        </CardContent>
      </Card>

      {/* Manual capture */}
      <Modal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        title="Capture supplier eTIMS receipt"
        description="Enter the receipt details exactly as printed by KRA."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCaptureOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={capture.isPending || captureForm.formState.isSubmitting}
              onClick={captureForm.handleSubmit((values) => capture.mutate(values))}
            >
              Save receipt
            </Button>
          </>
        }
      >
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={captureForm.handleSubmit((v) => capture.mutate(v))}
          noValidate
        >
          <Field label="Supplier" htmlFor="supplierId" error={captureForm.formState.errors.supplierId?.message} required className="sm:col-span-2">
            <Select
              id="supplierId"
              invalid={Boolean(captureForm.formState.errors.supplierId)}
              {...captureForm.register('supplierId')}
            >
              <option value="">Select supplier…</option>
              {supplierOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.taxId ? ` (${s.taxId})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="KRA receipt number" htmlFor="kraInvoiceNumber" error={captureForm.formState.errors.kraInvoiceNumber?.message} required className="sm:col-span-2">
            <Input id="kraInvoiceNumber" placeholder="KRA-2026-000001" invalid={Boolean(captureForm.formState.errors.kraInvoiceNumber)} {...captureForm.register('kraInvoiceNumber')} />
          </Field>
          <Field label="Receipt date" htmlFor="invoiceDate" error={captureForm.formState.errors.invoiceDate?.message} required>
            <Input id="invoiceDate" type="date" invalid={Boolean(captureForm.formState.errors.invoiceDate)} {...captureForm.register('invoiceDate')} />
          </Field>
          <Field label="Amount (KES)" htmlFor="amount" error={captureForm.formState.errors.amount?.message} required>
            <Input id="amount" inputMode="decimal" placeholder="0.00" invalid={Boolean(captureForm.formState.errors.amount)} {...captureForm.register('amount')} />
          </Field>
          <Field label="VAT amount (KES)" htmlFor="vatAmount" error={captureForm.formState.errors.vatAmount?.message} hint="Optional; printed VAT if shown">
            <Input id="vatAmount" inputMode="decimal" placeholder="0.00" invalid={Boolean(captureForm.formState.errors.vatAmount)} {...captureForm.register('vatAmount')} />
          </Field>
          <Field
            label="KRA QR data"
            htmlFor="kraQrCodeData"
            error={captureForm.formState.errors.kraQrCodeData?.message}
            className="sm:col-span-2"
          >
            <Input id="kraQrCodeData" placeholder="Paste the QR content if captured from the receipt" invalid={Boolean(captureForm.formState.errors.kraQrCodeData)} {...captureForm.register('kraQrCodeData')} />
          </Field>
        </form>
      </Modal>

      {/* Scan */}
      <Modal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        title="Scan supplier receipt"
        description="Upload a photo or PDF of the KRA receipt. OCR extraction runs as a queued job."
        footer={
          <>
            <Button variant="secondary" onClick={() => setScanOpen(false)}>
              Close
            </Button>
            <Button loading={scan.isPending} disabled={!scanFile} onClick={() => scan.mutate()}>
              <UploadCloud className="h-4 w-4" /> Upload & extract
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Supplier (optional)" htmlFor="scanSupplier">
            <Select id="scanSupplier" value={scanSupplier} onChange={(e) => setScanSupplier(e.target.value)}>
              <option value="">Unknown supplier — receipt will be saved without a match target</option>
              {supplierOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <label
            htmlFor="scan-file"
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-300 bg-ink-50 px-6 py-10 text-center"
          >
            <Camera className="h-6 w-6 text-ink-500" />
            <span className="text-sm text-ink-700">
              {scanFile ? `${scanFile.name} (${(scanBytes / 1024).toFixed(0)} KB)` : 'Click to choose a JPG, PNG, WebP or PDF'}
            </span>
            <input
              id="scan-file"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  if (file.size > 1_200_000) {
                    onError(new Error('File must be 1 MB or smaller'), 'File is too large');
                    return;
                  }
                  setScanBytes(file.size);
                  setScanFile(file);
                }
              }}
            />
          </label>
          <p className="text-xs text-ink-500">
            When an OCR provider is configured, the printed KRA details are extracted automatically; otherwise the
            receipt is stored for manual entry under Captured receipts.
          </p>
        </div>
      </Modal>

      {/* Match */}
      <Modal
        open={Boolean(matchTarget)}
        onClose={() => setMatchTarget(null)}
        title="Match supplier receipt"
        description={
          matchTarget
            ? `${matchTarget.supplier} — ${matchTarget.invoiceNumber} (${formatMoney(matchTarget.amount)})`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setMatchTarget(null)}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {availableReceipts.isLoading ? (
            <SkeletonTable />
          ) : (availableReceipts.data?.data ?? []).length === 0 ? (
            <EmptyState
              icon={RefreshCw}
              title="No unmatched receipts for this supplier"
              description="Capture the supplier's eTIMS receipt first, then match it here."
            />
          ) : (
            (availableReceipts.data?.data ?? []).map((receipt: SupplierEtimsInvoice) => (
              <div
                key={receipt.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-ink-900">{receipt.kraInvoiceNumber}</p>
                  <p className="text-xs text-ink-500">
                    {formatDate(receipt.invoiceDate)} · {formatMoney(receipt.amount)}
                  </p>
                </div>
                <Badge tone={receipt.verificationStatus === 'VERIFIED_VIA_KRA_QR' ? 'success' : 'warning'}>
                  {receipt.verificationStatus === 'VERIFIED_VIA_KRA_QR' ? 'Verified' : receipt.verificationStatus === 'VERIFICATION_FAILED' ? 'Failed' : 'Unverified'}
                </Badge>
                <Button
                  size="sm"
                  loading={match.isPending && match.variables?.receiptId === receipt.id}
                  onClick={() =>
                    matchTarget &&
                    match.mutate({ receiptId: receipt.id, purchaseInvoiceId: matchTarget.purchaseInvoiceId })
                  }
                >
                  <Link2 className="h-4 w-4" /> Match
                </Button>
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}

function ReceiptsTable({
  onVerify,
  verifyPendingId,
}: {
  onVerify: (id: string) => void;
  verifyPendingId?: string;
}) {
  const { data } = useQuery({
    queryKey: ['compliance', 'receipts'],
    queryFn: () => supplierEtimsApi.list({ limit: 50 }),
  });

  const rows = data?.data ?? [];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-500">
            <th className="px-2 py-2 font-semibold">KRA number</th>
            <th className="px-2 py-2 font-semibold">Supplier</th>
            <th className="px-2 py-2 font-semibold">Date</th>
            <th className="px-2 py-2 text-right font-semibold">Amount</th>
            <th className="px-2 py-2 font-semibold">Match</th>
            <th className="px-2 py-2 font-semibold">Verification</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((receipt) => (
            <tr key={receipt.id} className="border-b border-ink-100/70">
              <td className="px-2 py-2.5 font-medium text-ink-900">{receipt.kraInvoiceNumber}</td>
              <td className="px-2 py-2.5">{receipt.supplier.name}</td>
              <td className="px-2 py-2.5">{formatDate(receipt.invoiceDate)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{formatMoney(receipt.amount)}</td>
              <td className="px-2 py-2.5">
                <Badge tone={receipt.matchStatus === 'MATCHED' ? 'success' : 'warning'}>
                  {receipt.matchStatus}
                </Badge>
              </td>
              <td className="px-2 py-2.5">
                {receipt.verificationStatus === 'VERIFIED_VIA_KRA_QR' ? (
                  <Badge tone="success">
                    <CheckCircle2 className="h-3 w-3" /> Verified
                  </Badge>
                ) : receipt.verificationStatus === 'VERIFICATION_FAILED' ? (
                  <Badge tone="error">Failed</Badge>
                ) : (
                  <Badge tone="info">Unverified</Badge>
                )}
              </td>
              <td className="px-2 py-2.5 text-right">
                {receipt.verificationStatus !== 'VERIFIED_VIA_KRA_QR' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={verifyPendingId === receipt.id}
                    onClick={() => onVerify(receipt.id)}
                  >
                    Verify
                  </Button>
                ) : (
                  <ShieldCheck className="ml-auto h-4 w-4 text-success" />
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-2 py-8 text-center text-sm text-ink-500">
                No receipts captured yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}