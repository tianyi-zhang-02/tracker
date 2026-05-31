import type { NextConfig } from 'next';

/**
 * Static security headers, applied to every response.
 *
 * Per-request headers (CSP with nonce) live in src/proxy.ts. The headers
 * below don't depend on per-request state, so they're cheaper here than
 * recomputing them in the proxy on every hit.
 *
 *   - HSTS: 1-year max-age, include subdomains. Production only — in dev
 *     we serve over plain http://localhost and HSTS would break it.
 *   - X-Content-Type-Options: nosniff prevents MIME-type confusion attacks.
 *   - Referrer-Policy: same-origin (don't leak our paths to third-party
 *     destinations).
 *   - X-Frame-Options DENY: belt-and-suspenders alongside CSP frame-ancestors
 *     'none', for older browsers that don't enforce frame-ancestors.
 *   - Permissions-Policy: explicitly opt out of every powerful API we don't
 *     use. If a feature ever needs one of these, allowlist 'self' here.
 */
const isProd = process.env.NODE_ENV === 'production';

const SECURITY_HEADERS: Array<{ key: string; value: string }> = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()',
      'interest-cohort=()',
    ].join(', '),
  },
  ...(isProd
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=31536000; includeSubDomains',
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
