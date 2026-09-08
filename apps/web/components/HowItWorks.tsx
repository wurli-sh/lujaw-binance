"use client";

import { useEffect, useRef, useState } from "react";
import { STACK_STICKY_TOP } from "@/config/layout";
import { cn } from "@/lib/cn";

const HALF_W = 180;
const HALF_H = 72;
const THICK = 32;
const STEP = 88;
const PAD_TOP = 32;
const CX = 240;
const CANVAS_W = 480;

interface Layer {
  id: string;
  name: string;
  role: string;
  body: string;
  color: string;
}

const LAYERS: Layer[] = [
  {
    id: "policy",
    name: "Set policy",
    role: "lujaw_policy_create",
    body: "Caps, reserve, budget, allowlist. Accept the exact policyHash.",
    color: "#1E4FBF",
  },
  {
    id: "observe",
    name: "Observe Spot",
    role: "Binance MCP read",
    body: "Pull balances, ticker, and book for the proposed symbol.",
    color: "#255FD0",
  },
  {
    id: "preflight",
    name: "Preflight",
    role: "lujaw_order_preflight",
    body: "Deterministic ALLOW / REDUCE / BLOCK. Hostile all-in dies here.",
    color: "#2F6FE3",
  },
  {
    id: "authorize",
    name: "Authorize",
    role: "lujaw_order_authorize",
    body: "One-shot hash on the exact normalized order. Does not place it.",
    color: "#3D7DEB",
  },
  {
    id: "confirm",
    name: "Confirm & trade",
    role: "Binance MCP write",
    body: "Show the authorized order. Binance runs its own user confirmation.",
    color: "#4C8CF0",
  },
  {
    id: "verify",
    name: "Verify episode",
    role: "lujaw_episode_verify",
    body: "Check redacted fill + balances into a canonical episode.",
    color: "#5B8FE8",
  },
];

const LAYER_TOTAL = String(LAYERS.length).padStart(2, "0");
const CANVAS_H = PAD_TOP + 2 * HALF_H + (LAYERS.length - 1) * STEP + THICK + 24;

function layerCy(i: number) {
  return PAD_TOP + HALF_H + i * STEP;
}

function facePaths(cy: number) {
  return {
    top: `M ${CX} ${cy - HALF_H} L ${CX + HALF_W} ${cy} L ${CX} ${cy + HALF_H} L ${CX - HALF_W} ${cy} Z`,
    left: `M ${CX - HALF_W} ${cy} L ${CX} ${cy + HALF_H} L ${CX} ${cy + HALF_H + THICK} L ${CX - HALF_W} ${cy + THICK} Z`,
    right: `M ${CX} ${cy + HALF_H} L ${CX + HALF_W} ${cy} L ${CX + HALF_W} ${cy + THICK} L ${CX} ${cy + HALF_H + THICK} Z`,
  };
}

function StackVisual({ active }: { active: number }) {
  return (
    <svg
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      aria-hidden="true"
      className="block w-full max-w-[380px] overflow-visible lg:max-w-[440px]"
    >
      {[...LAYERS].map((_, idx) => {
        const i = LAYERS.length - 1 - idx;
        const layer = LAYERS[i]!;
        const { top, left, right } = facePaths(layerCy(i));
        const isActive = active === i;
        const base = isActive ? "var(--color-foreground)" : layer.color;
        return (
          <g
            key={layer.id}
            className="transition-all duration-[320ms] ease-out motion-reduce:transition-none"
            style={{
              opacity: isActive ? 1 : 0.45,
              transform: isActive ? "translateY(-10px)" : "translateY(0)",
            }}
          >
            <path
              d={left}
              style={{
                fill: `color-mix(in srgb, ${base}, black 42%)`,
              }}
            />
            <path
              d={right}
              style={{
                fill: `color-mix(in srgb, ${base}, black 22%)`,
              }}
            />
            <path d={top} style={{ fill: base }} />
          </g>
        );
      })}
    </svg>
  );
}

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const blockRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(Number((entry.target as HTMLElement).dataset.index));
          }
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    blockRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="how-it-works" className="relative">
      <div className="mx-auto w-full max-w-[1200px] px-6">
        <header className="mx-auto max-w-[60ch] pb-8 pt-8 text-center lg:pt-12">
          <p className="font-mono text-[length:var(--text-overline)] leading-[var(--text-overline--line-height)] font-[number:var(--text-overline--font-weight)] tracking-[var(--text-overline--letter-spacing)] uppercase text-brand-strong">
            How it works
          </p>
          <h2 className="mt-4 text-[length:var(--text-h2)] leading-[var(--text-h2--line-height)] font-[number:var(--text-h2--font-weight)] tracking-[var(--text-h2--letter-spacing)]">
            Six steps behind every trade
          </h2>
          <p className="mx-auto mt-4 max-w-[48ch] text-[length:var(--text-body-lg)] leading-[var(--text-body-lg--line-height)] text-muted">
            Real host workflow. Each step has one job.
          </p>
        </header>

        <div className="lg:hidden">
          {LAYERS.map((layer, i) => (
            <div
              key={layer.id}
              data-index={i}
              ref={(el) => {
                blockRefs.current[i] = el;
              }}
              className="flex flex-col justify-center py-10"
            >
              <TextBlock layer={layer} index={i} active={active === i} align="left" />
              <div className="mt-8 flex justify-center">
                <StackVisual active={i} />
              </div>
            </div>
          ))}
        </div>

        <div className="hidden lg:grid lg:gap-x-10" style={{ gridTemplateColumns: "1fr 440px 1fr" }}>
          <div
            className="col-start-2 row-start-1 flex justify-center self-start"
            style={{ gridRow: `1 / span ${LAYERS.length}`, top: STACK_STICKY_TOP, position: "sticky" }}
          >
            <StackVisual active={active} />
          </div>

          {LAYERS.map((layer, i) => {
            const onLeft = i % 2 === 0;
            return (
              <div
                key={layer.id}
                data-index={i}
                ref={(el) => {
                  blockRefs.current[i] = el;
                }}
                style={{ gridRow: i + 1, gridColumn: onLeft ? 1 : 3 }}
                className="flex min-h-[36vh] items-center"
              >
                <TextBlock layer={layer} index={i} active={active === i} align={onLeft ? "right" : "left"} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function TextBlock({
  layer,
  index,
  active,
  align,
}: {
  layer: Layer;
  index: number;
  active: boolean;
  align: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "border-l-2 pl-6 transition-all duration-700 ease-in-out lg:opacity-0",
        align === "right" && "lg:border-l-0 lg:border-r-2 lg:pl-0 lg:pr-6 lg:text-right",
        active ? "border-brand lg:opacity-100" : "border-border lg:pointer-events-none",
      )}
    >
      <p className="font-mono text-[length:var(--text-overline)] leading-[var(--text-overline--line-height)] font-[number:var(--text-overline--font-weight)] tracking-[var(--text-overline--letter-spacing)] uppercase text-brand-strong">
        Step {String(index + 1).padStart(2, "0")} / {LAYER_TOTAL} · {layer.role}
      </p>
      <h3 className="mt-3 text-[length:var(--text-h3)] leading-[var(--text-h3--line-height)] font-[number:var(--text-h3--font-weight)] tracking-[var(--text-h3--letter-spacing)] text-foreground">
        {layer.name}
      </h3>
      <p
        className={cn(
          "mt-3 max-w-[42ch] text-[length:var(--text-body)] leading-[var(--text-body--line-height)] text-muted",
          align === "right" && "lg:ml-auto",
        )}
      >
        {layer.body}
      </p>
    </div>
  );
}
