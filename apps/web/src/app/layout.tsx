import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { LoggerBootstrap } from "@/components/LoggerBootstrap";

export const metadata: Metadata = {
  title: "DramaFlow Studio",
  description: "Local-first AI short-drama production workbench",
};

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/story", label: "Story Workspace" },
  { href: "/assets", label: "Asset Ledger" },
  { href: "/storyboards", label: "Storyboard Studio" },
  { href: "/prompts", label: "Prompt Center" },
  { href: "/models", label: "Model Settings" },
  { href: "/jobs", label: "Production Hub" },
  { href: "/reviews", label: "Review Center" },
  { href: "/exports", label: "Export Center" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <LoggerBootstrap />
        <div className="app-shell">
          <aside className="app-nav">
            <h1>DramaFlow Studio</h1>
            <ul>
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </aside>
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
