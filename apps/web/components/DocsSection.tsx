"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { buttonHover, buttonTap } from "@/lib/animations";
import { SITE } from "@/lib/site";

export function DocsSection() {
  return (
    <section id="docs" className="py-24 lg:py-32">
      <div className="mx-auto w-full max-w-[1200px] px-6 text-center">
        <p className="font-mono text-[length:var(--text-overline)] leading-[var(--text-overline--line-height)] font-[number:var(--text-overline--font-weight)] tracking-[var(--text-overline--letter-spacing)] uppercase text-brand-strong">
          Documentation
        </p>
        <h2 className="mx-auto mt-4 max-w-[28ch] text-[length:var(--text-h2)] leading-[var(--text-h2--line-height)] font-[number:var(--text-h2--font-weight)] tracking-[var(--text-h2--letter-spacing)]">
          Access our solution docs
        </h2>
        <div className="mt-8 flex justify-center">
          <a href={SITE.docsUrl} target="_blank" rel="noreferrer" className="group">
            <motion.div whileHover={buttonHover} whileTap={buttonTap}>
              <Button size="lg" variant="brand">
                {SITE.ctaLabel}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </motion.div>
          </a>
        </div>
      </div>
    </section>
  );
}
