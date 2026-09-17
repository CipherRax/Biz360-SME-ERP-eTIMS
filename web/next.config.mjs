/** @type {import('next').NextConfig} */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The monorepo has a lockfile at the repo root too; pin tracing to this app so
// Next does not guess the wrong workspace root.
const appDir = path.dirname(fileURLToPath(import.meta.url));

// ---- Public vs server-only env -------------------------------------------------
// NEXT_PUBLIC_* is inlined into the browser bundle. The API base URL the browser
// talks to is deliberately public; nothing else here is prefixed NEXT_PUBLIC_.
// Server-only vars (API_BASE_URL for route handlers) are read via
// `process.env` and never reach the client bundle.
const browserApiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
let browserApiOrigin = 'http://localhost:3000';
try {
  browserApiOrigin = new URL(browserApiBase).origin;
} catch {
  browserApiOrigin = 'http://localhost:3000';
}

const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: appDir,
  eslint: {
    // Lint is run explicitly via `npm run lint`; don't let it gate `next build`.
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Fallback baseline; the edge middleware rewrites this header
          // per-request for HTML routes (see SECURITY.md). Next.js uses inline
          // scripts for hydration, so 'unsafe-inline' is required unless pages
          // are forced dynamic with a nonce.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self' data:",
              `connect-src 'self' ${browserApiOrigin}`,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
    ];
  },
};

export default nextConfig;