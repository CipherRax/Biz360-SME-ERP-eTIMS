import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t border-ink-100 bg-white">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-4 py-8 text-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          © {new Date().getFullYear()} Biz360 SME ERP — built for Kenyan businesses.
        </p>
        <nav className="flex items-center gap-5" aria-label="Footer">
          <Link href="/settings" className="hover:text-brand-deep">
            Settings
          </Link>
          <Link href="/help" className="hover:text-brand-deep">
            Help
          </Link>
          <a
            href="https://www.kra.go.ke/online-services/etims"
            target="_blank"
            rel="noreferrer"
            className="hover:text-brand-deep"
          >
            eTIMS
          </a>
        </nav>
      </div>
    </footer>
  );
}