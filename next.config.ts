import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { cpus: 2, optimizePackageImports: ['@astryxdesign/core'] },
  serverExternalPackages: ['pg', '@electric-sql/pglite', 'mjml'],
  // The developer preview runs the SQL migrations on an embedded PGlite database, so ship both with every route.
  outputFileTracingIncludes: {
    '/**': ['./migrations/*.sql', './node_modules/@electric-sql/pglite/dist/**/*'],
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }, {
      // Stored media sends its own stricter policy (a sandbox for SVG); a site-wide value here would replace it.
      source: '/:path((?!media/).*)',
      headers: [
        { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" },
      ],
    }];
  },
};

export default nextConfig;
