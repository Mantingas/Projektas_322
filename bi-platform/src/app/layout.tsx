import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { LangProvider } from '@/components/LangProvider';
import { Header } from '@/components/Header';

export const metadata: Metadata = {
  title: 'Excel Insights',
  icons: { icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPwd3tKEmIY1TCqYfhqAABe7noQUrS/JQAAAABJRU5ErkJggg==" },
  description: 'Upload your Excel. Discover what matters in your business data. Your data stays on your computer.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

/**
 * Content-Security-Policy as a <meta> tag (the site is a static export, so there is no server to set headers).
 * connect-src 'self' means the page may not talk to any other host, so business data has nowhere to go.
 * 'unsafe-inline' scripts are required by the Next.js static runtime bootstrap.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="lt">
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
        <meta name="referrer" content="no-referrer" />
      </head>
      <body>
        <LangProvider>
          <Header />
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        </LangProvider>
      </body>
    </html>
  );
}
