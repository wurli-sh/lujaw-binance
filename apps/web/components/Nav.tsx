"use client";

import { useEffect, useState } from "react";
import { LogoWordmark } from "@/components/ui/LogoMark";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#docs", label: "Docs" },
] as const;

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-border transition-colors duration-[160ms]",
        scrolled ? "bg-background/85 backdrop-blur-md" : "bg-transparent",
      )}
    >
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
