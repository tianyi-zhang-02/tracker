import type { Metadata, Viewport } from 'next';
import { Fraunces, IBM_Plex_Sans, Geist_Mono } from 'next/font/google';
import './globals.css';

const sans = IBM_Plex_Sans({
  variable: '--font-ibm-plex',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const serif = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  // Variable font: omit `weight` so all weights stream as a single file;
  // axes can then customize the optical-size axis used by `.serif-display`.
  axes: ['opsz'],
  display: 'swap',
});

const mono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'tracker',
  description: 'Personal wealth tracker',
  robots: { index: false, follow: false },
  applicationName: 'tracker',
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
  // Disable user scaling so the bottom nav stays where it belongs on iOS.
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${serif.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
