import { cn } from "@/lib/cn";
import { SITE } from "@/lib/site";

export function LogoMark({ className, mono = false }: { className?: string; mono?: boolean }) {
  const accent = mono ? "var(--color-foreground)" : "var(--color-brand)";
  return (
    <svg
      viewBox="0 0 506 416"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <path
        d="M64.5 236.5L16 270L245.5 399.5L485 270L433 236.5"
        stroke={accent}
        strokeWidth="32"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M67 174L16 204.5L245.5 334L485 204.5L440.5 175"
        stroke="var(--color-foreground)"
        strokeWidth="32"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M250 276L20.5 146.5L250 16L489.5 146.5L250 276Z"
        stroke={accent}
        strokeWidth="32"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LogoWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className="h-7 w-auto" />
      <span className="text-[length:var(--text-h4,18px)] leading-[var(--text-h4--line-height,26px)] font-extrabold uppercase tracking-[-0.02em] text-foreground">
        {SITE.brand}
      </span>
    </span>
  );
}
