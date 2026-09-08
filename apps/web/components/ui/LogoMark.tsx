import { cn } from "@/lib/cn";
import { SITE } from "@/lib/site";

export function LogoMark({ className, mono = false }: { className?: string; mono?: boolean }) {
  return (
    <img
      src="/logo.png"
      alt=""
      aria-hidden="true"
      width={28}
      height={28}
      className={cn("shrink-0 rounded-sm object-contain", mono && "grayscale", className)}
    />
  );
}

export function LogoWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className="h-7 w-7" />
      <span className="text-[length:var(--text-h4,18px)] leading-[var(--text-h4--line-height,26px)] font-extrabold uppercase tracking-[-0.02em] text-foreground">
        {SITE.brand}
      </span>
    </span>
  );
}
