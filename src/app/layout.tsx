import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Navigation } from "@/components/Navigation";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "EvalForge Dashboard",
  description:
    "Unified evaluation dashboard for text-to-video models and AI agents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg-primary text-text-primary">
        <Navigation />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-border-subtle py-6 px-8">
          <div className="mx-auto max-w-7xl flex items-center justify-between text-sm text-text-muted">
            <span>Built with EvalForge</span>
            <a
              href="https://github.com/BobbyZhong/evalforge"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent-blue transition-colors"
            >
              GitHub
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
