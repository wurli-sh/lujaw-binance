import { LogoWordmark } from "@/components/ui/LogoMark";
import { SITE } from "@/lib/site";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "Docs", href: "#docs" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Skill package", href: `${SITE.docsUrl}/tree/main/skills/lujaw`, external: true },
      { label: "Phase 2 decisions", href: `${SITE.docsUrl}/blob/main/docs/phase2-decisions.md`, external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface/40">
      <div className="mx-auto w-full max-w-[1200px] px-6 py-14">
        <div className="flex flex-col justify-between gap-10 md:flex-row">
          <div className="max-w-[36ch]">
            <a href="#top" aria-label={`${SITE.brand} — back to top`}>
              <LogoWordmark />
            </a>
            <p className="mt-4 text-[length:var(--text-body-sm)] leading-[var(--text-body-sm--line-height)] text-muted">
              {SITE.footer.blurb}
            </p>
          </div>
          <div className="flex gap-16">
            {COLUMNS.map((column) => (
              <nav key={column.title} aria-label={column.title}>
                <p className="font-mono text-[length:var(--text-overline)] leading-[var(--text-overline--line-height)] font-[number:var(--text-overline--font-weight)] tracking-[var(--text-overline--letter-spacing)] uppercase text-subtle">
                  {column.title}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        {...("external" in link && link.external
                          ? { target: "_blank", rel: "noreferrer" }
                          : {})}
                        className="text-[length:var(--text-body-sm)] leading-[var(--text-body-sm--line-height)] text-muted transition-colors duration-[120ms] hover:text-brand-strong"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
        <div className="mt-12 border-t border-border pt-6">
          <p className="text-[length:var(--text-caption)] leading-[var(--text-caption--line-height)] text-subtle">
            {SITE.footer.limitation}
          </p>
          <p className="mt-2 font-mono text-[length:var(--text-mono-sm)] leading-[var(--text-mono-sm--line-height)] text-subtle">
            {SITE.footer.copyright}
          </p>
        </div>
      </div>
    </footer>
  );
}
