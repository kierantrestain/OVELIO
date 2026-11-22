import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { cpus: 2 },
  serverExternalPackages: ['pg'],
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
};

export default nextConfig;
