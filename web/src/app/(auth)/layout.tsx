import Link from 'next/link';
import { BadgeCheck, BarChart3, Wallet } from 'lucide-react';
import logo from '@/images/logo.png';

const HIGHLIGHTS = [
  { icon: Wallet, text: 'Invoicing, payments and VAT in one ledger' },
  { icon: BarChart3, text: 'Real-time stock, profit and aged-balance reports' },
  { icon: BadgeCheck, text: 'KRA eTIMS submissions with control numbers' },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-deep via-brand to-brand-hover p-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10"
          aria-hidden
        />
        <Link href="/" className="relative flex items-center gap-2.5">
          <span
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 bg-cover bg-center"
            style={{ backgroundImage: `url(${logo.src})` }}
            aria-hidden
          />
          <span className="font-sans text-xl font-bold">
            Biz<span className="text-white/80">360</span>
          </span>
        </Link>

        <div className="relative max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/75">
            SME ERP · Kenya
          </p>
          <h2 className="mt-3 font-sans text-3xl font-bold leading-tight">
            Run your business on one clean set of books.
          </h2>
          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map((item) => (
              <li key={item.text} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <item.icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="text-sm text-white/90">{item.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/70">
          VAT-compliant · Multi-user roles · Audit-ready
        </p>
      </aside>

      <main className="flex items-center justify-center bg-white px-4 py-12 sm:px-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}