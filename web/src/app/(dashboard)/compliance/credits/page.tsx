'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgePercent,
  Banknote,
  CheckCircle2,
  FileMinus,
  Link2,
  Plus,
  RefreshCw,
  ShieldCheck,
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
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
  useToast,
} from '@/components/ui';
import { expenseExposureApi, partiesApi, supplierCreditApi, supplierEtimsApi, withholdingTaxApi } from '@/lib/api';
import { ApiError } from '@/lib/api/http';
import { formatDate, formatMoney } from '@/lib/utils/format';
import { newIdempotencyKey } from '@/lib/utils/idempotency';
import type { Party, SupplierEtimsCreditNote, WithholdingTaxDeduction } from '@/types/domain';

export default function SupplierCreditNotesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [captureOpen, setCaptureOpen] = useState(false);
  const [matchTarget, setMatchTarget] = useState<SupplierEtimsCreditNote | null>(null);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['compliance'] });

  const exposure = useQuery({
    queryKey: ['compliance', 'exposure'],
    queryFn: () => expenseExposureApi.summary(),
  });
  const unmatched = useQuery({
    queryKey: ['compliance', 'credit-unmatched'],
    queryFn: () => supplierCreditApi.unmatched({ limit: 100 }),
  });
  const credits = useQuery({
    queryKey: ['compliance', 'credits'],
    queryFn: () => supplierCreditApi.list({ limit: 100 }),
  });
  const suppliers = useQuery({
    queryKey: ['parties', 'suppliers'],
    queryFn: () => partiesApi.list({ type: 'SUPPLIER', status: 'ACTIVE', limit: 200 }),
  });

  const capture = useMutation({
    mutationFn: (input: Parameters<typeof supplierCreditApi.capture>[0]) =>
      supplierCreditApi.capture(input, newIdempotencyKey()),
    onSuccess: (credit) => {
      toast({
        tone: 'success',
        title: `Credit note ${credit.kraInvoiceNumber} captured`,
        description:
          credit.originalEtimsInvoiceId
            ? 'Referenced a captured eTIMS invoice.'
            : 'Match it to an original invoice or purchase to reduce exposure.',
      });
      setCaptureOpen(false);
      invalidate();
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Could not capture credit note',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  const verify = useMutation({
    mutationFn: (id: string) => supplierCreditApi.verify(id, newIdempotencyKey()),
    onSuccess: () => {
      toast({ tone: 'info', title: 'Verification queued against the KRA provider' });
      invalidate();
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Could not queue verification',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  const summary = exposure.data;
  const unmatchedRows = unmatched.data?.data ?? [];
  const allCredits = credits.data?.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Compliance"
        title="Supplier credit notes"
        description="Returns and price corrections issued by suppliers reduce your deductible expense. Confirm them against the original eTIMS invoice, and offset withholding already paid so you remit the right amount to KRA."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ['compliance'] })}
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button onClick={() => setCaptureOpen(true)}>
              <Plus className="h-4 w-4" /> Capture credit note
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Exposure (net)"
          value={summary ? formatMoney(summary.totalExposure) : '—'}
          icon={ShieldCheck}
          tone="warning"
          hint={`${summary?.unmatchedCount ?? 0} purchase(s) still unbacked after credits`}
        />
        <StatCard
          label="Credited"
          value={summary ? formatMoney(summary.creditedAmount) : '—'}
          icon={FileMinus}
          tone="success"
          hint={`${summary?.creditNoteCount ?? 0} confirmed credit note(s) reduce deductible spend`}
        />
        <StatCard
          label="Credit notes"
          value={`${allCredits.length}`}
          icon={BadgePercent}
          tone="info"
          hint={`${unmatchedRows.length} awaiting match`}
        />
        <StatCard
          label="WHT offset"
          value={unmatchedRows.length > 0 ? '—' : 'Pending'}
          icon={Banknote}
          tone="brand"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Unmatched credit notes</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {unmatched.isLoading ? (
            <SkeletonTable />
          ) : unmatchedRows.length === 0 ? (
            <EmptyState
              icon={BadgePercent}
              title="No unmatched credit notes"
              description="Captured credit notes that haven't been tied to an original invoice or purchase will appear here."
            />
          ) : (
            <TableWrapper className="border-0">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Credit note</TableHeaderCell>
                    <TableHeaderCell>Supplier</TableHeaderCell>
                    <TableHeaderCell>Date</TableHeaderCell>
                    <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                    <TableHeaderCell>Reason</TableHeaderCell>
                    <TableHeaderCell />
                  </tr>
                </TableHead>
                <TableBody>
                  {unmatchedRows.map((credit) => (
                    <TableRow key={credit.id}>
                      <TableCell className="font-mono text-xs font-medium text-ink-900">
                        {credit.kraInvoiceNumber}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-ink-900">{credit.supplier.name}</span>
                        {credit.supplier.taxId ? (
                          <span className="ml-1 text-xs text-ink-500">{credit.supplier.taxId}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>{formatDate(credit.creditNoteDate)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-ink-900">
                        {formatMoney(credit.totalAmount)}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-ink-500">
                        {credit.reason || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => setMatchTarget(credit)}>
                          <Link2 className="h-4 w-4" /> Match
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Captured credit notes</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {credits.isLoading ? (
            <SkeletonTable />
          ) : allCredits.length === 0 ? (
            <EmptyState
              icon={FileMinus}
              title="No credit notes yet"
              description="Capture a KRA credit note from a supplier above and it will be tracked here."
            />
          ) : (
            <TableWrapper className="border-0">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Credit note</TableHeaderCell>
                    <TableHeaderCell>Supplier</TableHeaderCell>
                    <TableHeaderCell className="text-right">Total</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Verified</TableHeaderCell>
                    <TableHeaderCell className="text-right">WHT offset</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {allCredits.map((credit) => (
                    <TableRow key={credit.id}>
                      <TableCell className="font-mono text-xs font-medium text-ink-900">
                        {credit.kraInvoiceNumber}
                        {credit.originalPurchaseInvoice?.invoiceNumber ? (
                          <span className="ml-1 font-sans text-xs font-normal text-ink-500">
                            → {credit.originalPurchaseInvoice.invoiceNumber}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-ink-900">{credit.supplier.name}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(credit.totalAmount)}
                      </TableCell>
                      <TableCell>
                        <Badge tone={credit.matchStatus === 'MATCHED' ? 'success' : 'warning'}>
                          {credit.matchStatus.toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {credit.verificationStatus === 'VERIFIED_VIA_KRA_QR' ? (
                          <Badge tone="success">
                            <CheckCircle2 className="mr-1 h-3 w-3" /> Verified
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={verify.isPending && verify.variables === credit.id}
                            onClick={() => verify.mutate(credit.id)}
                          >
                            <ShieldCheck className="h-4 w-4" /> Verify
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {credit.whtOffsetAmount != null
                          ? formatMoney(credit.whtOffsetAmount)
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      <CaptureCreditModal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        suppliers={suppliers.data ?? []}
        loading={suppliers.isLoading}
        onSave={(input) => capture.mutate(input)}
        saving={capture.isPending}
      />

      {matchTarget ? (
        <MatchCreditModal
          credit={matchTarget}
          onClose={() => setMatchTarget(null)}
          onMatched={() => {
            setMatchTarget(null);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

function CaptureCreditModal({
  open,
  onClose,
  suppliers,
  loading,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  suppliers: Party[];
  loading: boolean;
  onSave: (input: Parameters<typeof supplierCreditApi.capture>[0]) => void;
  saving: boolean;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    supplierId: '',
    kraInvoiceNumber: '',
    originalInvoiceNumber: '',
    creditNoteDate: new Date().toISOString().slice(0, 10),
    amount: '',
    vatAmount: '',
    reason: '',
  });
  const set = <K extends keyof typeof form>(key: K, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const valid =
    form.supplierId &&
    /^[A-Za-z0-9/\-\s]{6,60}$/.test(form.kraInvoiceNumber.trim()) &&
    /^\d{1,9}(\.\d{1,2})?$/.test(form.amount.trim());

  const submit = () => {
    if (!valid) return;
    onSave({
      supplierId: form.supplierId,
      kraInvoiceNumber: form.kraInvoiceNumber.trim().toUpperCase(),
      originalInvoiceNumber: form.originalInvoiceNumber.trim() || undefined,
      creditNoteDate: new Date(form.creditNoteDate).toISOString(),
      amount: form.amount.trim(),
      vatAmount: form.vatAmount.trim() || undefined,
      reason: form.reason.trim() || undefined,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Capture supplier credit note"
      description="Enter the KRA credit note (ETCR) number and amounts printed by the supplier so it can be confirmed against your records."
    >
      <div className="flex flex-col gap-4">
        <Field label="Supplier" htmlFor="credit-supplier">
          <Select
            id="credit-supplier"
            value={form.supplierId}
            onChange={(e) => set('supplierId', e.target.value)}
          >
            <option value="">Select a supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="KRA credit note number" htmlFor="credit-number">
            <Input
              id="credit-number"
              placeholder="e.g. KRA-2026-000100"
              value={form.kraInvoiceNumber}
              onChange={(e) => set('kraInvoiceNumber', e.target.value)}
            />
          </Field>
          <Field label="Original invoice reference" htmlFor="credit-original">
            <Input
              id="credit-original"
              placeholder="Supplier invoice number (if printed)"
              value={form.originalInvoiceNumber}
              onChange={(e) => set('originalInvoiceNumber', e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Credit note date" htmlFor="credit-date">
            <Input
              id="credit-date"
              type="date"
              value={form.creditNoteDate}
              onChange={(e) => set('creditNoteDate', e.target.value)}
            />
          </Field>
          <Field label="Amount (excl. VAT)" htmlFor="credit-amount">
            <Input
              id="credit-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
            />
          </Field>
          <Field label="VAT amount" htmlFor="credit-vat">
            <Input
              id="credit-vat"
              inputMode="decimal"
              placeholder="0.00"
              value={form.vatAmount}
              onChange={(e) => set('vatAmount', e.target.value)}
            />
          </Field>
        </div>
        <Field label="Reason (optional)" htmlFor="credit-reason">
          <Input
            id="credit-reason"
            placeholder="e.g. Return of defective stock, price correction"
            value={form.reason}
            onChange={(e) => set('reason', e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={loading || saving}
            disabled={!valid}
            onClick={() => {
              if (valid) {
                if (form.vatAmount.trim() && !/^\d{1,9}(\.\d{1,2})?$/.test(form.vatAmount.trim())) {
                  toast({ tone: 'error', title: 'VAT amount must be a valid amount' });
                  return;
                }
                submit();
              }
            }}
          >
            <Plus className="h-4 w-4" /> Capture
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function MatchCreditModal({
  credit,
  onClose,
  onMatched,
}: {
  credit: SupplierEtimsCreditNote;
  onClose: () => void;
  onMatched: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const originals = useQuery({
    queryKey: ['compliance', 'matched-invoices', credit.supplierId],
    queryFn: () =>
      supplierEtimsApi.list({ supplierId: credit.supplierId, matchStatus: 'MATCHED', limit: 100 }),
  });
  const deductions = useQuery({
    queryKey: ['wht', 'deductions'],
    queryFn: () => withholdingTaxApi.list({ supplierId: credit.supplierId, limit: 200 }),
  });

  const [originalInvoiceId, setOriginalInvoiceId] = useState('');
  const [purchaseId, setPurchaseId] = useState('');
  const [offsetDeductionId, setOffsetDeductionId] = useState('');

  const match = useMutation({
    mutationFn: () =>
      supplierCreditApi.match(
        credit.id,
        {
          originalEtimsInvoiceId: originalInvoiceId || undefined,
          purchaseInvoiceId: purchaseId || undefined,
          whtOffsetDeductionId: offsetDeductionId || undefined,
        },
        newIdempotencyKey(),
      ),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Credit note matched to your records' });
      void queryClient.invalidateQueries({ queryKey: ['compliance'] });
      onMatched();
    },
    onError: (error) =>
      toast({
        tone: 'error',
        title: 'Could not match credit note',
        description: error instanceof ApiError ? error.message : 'Please try again.',
      }),
  });

  const invoices = originals.data?.data ?? [];
  const deductionsRows = deductions.data?.items ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title="Match credit note"
      description={`${credit.kraInvoiceNumber} for ${credit.supplier.name} — tie it to the original eTIMS receipt/purchase and, if withholding was already paid, offset it.`}
    >
      <div className="flex flex-col gap-4">
        <Field label="Original eTIMS invoice" htmlFor="match-invoice">
          <Select
            id="match-invoice"
            value={originalInvoiceId}
            onChange={(e) => {
              setOriginalInvoiceId(e.target.value);
              const picked = invoices.find((i) => i.id === e.target.value);
              if (picked?.matchedPurchaseInvoiceId) setPurchaseId(picked.matchedPurchaseInvoiceId);
            }}
          >
            <option value="">Not referenced on the credit note…</option>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.kraInvoiceNumber} · {formatMoney(i.amount)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Purchase invoice (auto-filled when an eTIMS invoice is picked)" htmlFor="match-purchase">
          <Input
            id="match-purchase"
            readOnly
            value={purchaseId ? `${invoices.find((i) => i.id === originalInvoiceId)?.matchedPurchaseInvoice?.invoiceNumber ?? purchaseId}` : ''}
            placeholder="Resolved from the original eTIMS invoice…"
          />
        </Field>
        <Field label="Offset withholding deduction (optional)" htmlFor="match-offset">
          <Select
            id="match-offset"
            value={offsetDeductionId}
            onChange={(e) => setOffsetDeductionId(e.target.value)}
          >
            <option value="">No offset yet</option>
            {deductionsRows.map((d: WithholdingTaxDeduction) => (
              <option key={d.id} value={d.id}>
                {d.supplier.name} · WHT {formatMoney(Number(d.whtAmount))} · {d.kraWhtCertificateNumber ?? 'no certificate'}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={match.isPending} onClick={() => match.mutate()}>
            <Link2 className="h-4 w-4" /> Confirm match
          </Button>
        </div>
      </div>
    </Modal>
  );
}