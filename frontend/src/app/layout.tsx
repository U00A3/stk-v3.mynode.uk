import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import ThemeToggle from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "Shared Node Staking - Validator Delegation",
  description:
    "Delegate to validators. Target APR 7%, commission up to 20%, 24h withdraw delay. Reference implementation, not audited.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pl" data-theme="light" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('shared-node-staking-theme');document.documentElement.setAttribute('data-theme',t==='light'||t==='dark'?t:'light');})();`,
          }}
        />
      </head>
      <body>
        <div className="ambient-bg" />
        <Providers>{children}</Providers>
        <div className="fixed bottom-4 right-4 z-[100]">
          <ThemeToggle />
        </div>
      </body>
    </html>
  );
}
