"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AsciiSpiral } from "@/components/home/AsciiSpiral";
import { buttonHover, buttonTap, heroReveal, heroStagger } from "@/lib/animations";
import { SITE } from "@/lib/site";

export function Hero() {
  const { hero } = SITE;

  return (
    <section
      id="top"
      className="relative flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center overflow-hidden bg-background px-4 pt-16 pb-20 text-center sm:px-6 sm:pb-32 md:pb-36"
    >
      <motion.div
        className="relative z-10 flex w-full max-w-3xl flex-col items-center"
        variants={heroStagger}
        initial="hidden"
        animate="visible"
      >
        <motion.div
          className="flex h-[160px] w-full items-center justify-center overflow-visible sm:h-[190px] md:h-[220px]"
          variants={heroReveal}
        >
          <AsciiSpiral className="rotate-90 text-[2.6px] sm:text-[3.2px] md:text-[3.8px]" />
        </motion.div>

        <motion.p
          className="mt-6 text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
          variants={heroReveal}
        >
          {hero.eyebrow}
        </motion.p>

        <motion.h1
          className="mt-4 text-balance text-3xl font-bold leading-[1.08] tracking-tight text-charcoal sm:text-4xl lg:text-5xl"
          variants={heroReveal}
        >
          {hero.headlineLead}
          <span
            aria-hidden
            className="ml-[0.06em] inline-block h-[0.18em] w-[0.18em] bg-brand align-baseline"
          />
          <span className="sr-only">{hero.headlineAccent}</span>
        </motion.h1>

        <motion.p
          className="mt-5 max-w-2xl text-balance text-sm leading-relaxed text-muted-foreground/90 sm:text-base"
          variants={heroReveal}
        >
          {hero.sub}
        </motion.p>

        <motion.div className="mt-8" variants={heroReveal}>
          <a href={SITE.ctaUrl} target="_blank" rel="noreferrer" className="group">
            <motion.div whileHover={buttonHover} whileTap={buttonTap}>
              <Button size="lg" variant="brand">
                {SITE.ctaLabel}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </motion.div>
          </a>
        </motion.div>
      </motion.div>
    </section>
  );
}
