import type { ReactNode } from "react";

import "./globals.css";

export function generateMetadata() {
  return {
    title: "Wack Hack · Discord Simulator",
    description: "A faithful Discord dark-theme channel for iterating on bot message UX.",
  };
}

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className="dark">
      <body>
        {/* Discord ships "gg sans" (proprietary); Noto Sans is its documented
            fallback and the closest free match. React 19 hoists these to <head>. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700&display=swap"
        />
        {children}
      </body>
    </html>
  );
}
