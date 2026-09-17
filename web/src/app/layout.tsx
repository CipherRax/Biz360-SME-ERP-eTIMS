import type { Metadata, Viewport } from 'next';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@/styles/globals.css';
import { AppProviders } from '@/components/providers/app-providers';

export const metadata: Metadata = {
  title: {
    default: 'Biz360 SME ERP',
    template: '%s · Biz360 SME ERP',
  },
  description:
    'Invoicing, inventory, accounting and KRA eTIMS compliance for Kenyan SMEs.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#00a550',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-KE">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}