import './globals.css';

import type { ReactNode } from 'react';

export const metadata = {
  title: 'agentic-kit chat demo',
  description: 'Next.js demo proving agentic-kit can replace AI SDK for the dashboard chatbot.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
