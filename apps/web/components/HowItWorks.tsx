"use client";

import { useEffect, useRef, useState } from "react";
import { STACK_STICKY_TOP } from "@/config/layout";
import { cn } from "@/lib/cn";

const HALF_W = 200;
const HALF_H = 90;
const THICK = 40;
const STEP = 122;
const PAD_TOP = 40;
const CX = 260;
const CANVAS_W = 520;

interface Layer {
  id: string;
  name: string;
  role: string;
  body: string;
  color: string;
}

const LAYERS: Layer[] = [
  {
    id: "care-plan",
    name: "Set a Care Plan",
    role: "Policy & limits",
    body: "Normalize thresholds, target health, spend budget, the supported Venus USDT market, and session expiry — then require explicit acceptance before anything is granted.",
    color: "#2F6FE3",
  },
  {
    id: "grant",
    name: "Grant bounded authority",
    role: "Altana session",
    body: "Create a short-lived Altana session limited to the verified Venus mint call and spend cap. No widened authority, no second rails.",
    color: "#255FD0",
  },
  {
    id: "verify",
    name: "Verify recovery",
    role: "Execute & confirm",
    body: "Calculate the minimum buffered top-up deterministically, execute only if policy allows, confirm the receipt, and check the new pinned Venus state.",
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
      className="block w-full max-w-[420px] overflow-visible lg:max-w-[480px]"
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
            Three steps behind every rescue
          </h2>
          <p className="mx-auto mt-4 max-w-[48ch] text-[length:var(--text-body-lg)] leading-[var(--text-body-lg--line-height)] text-muted">
            Each step has one job. Scroll to see what happens where.
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

        <div className="hidden lg:grid lg:gap-x-10" style={{ gridTemplateColumns: "1fr 480px 1fr" }}>
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
                className="flex min-h-[42vh] items-center"
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
