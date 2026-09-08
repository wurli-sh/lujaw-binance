"use client";

import { LogoWordmark } from "@/components/ui/LogoMark";
import { SITE } from "@/lib/site";

const LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#docs", label: "Docs" },
] as const;

export function Nav() {
  return (
    <header className="sticky top-0 z-40 bg-brand/5 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-6 px-6">
        <a href="#top" aria-label={`${SITE.brand} — back to top`} className="rounded-sm">
          <LogoWordmark />
        </a>

        <nav aria-label="Main" className="flex items-center gap-1">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-[length:var(--text-body-sm)] leading-[var(--text-body-sm--line-height)] font-medium text-muted transition-colors duration-[120ms] hover:bg-brand-soft hover:text-brand-strong"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
