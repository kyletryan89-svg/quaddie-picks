import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WST',
  description: 'Who actually picked well? Private quaddie scoring for the crew.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body className="min-h-dvh bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
