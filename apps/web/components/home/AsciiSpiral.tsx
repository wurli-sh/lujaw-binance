"use client";

/**
 * AsciiSpiral — animated 3D rotating disk as monospace 0/1 glyphs.
 * Frame data: gzipped base64 in asciiSpiralData.ts (chinari/entros.io).
 */

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { SPIRAL_PAYLOAD_B64 } from "./asciiSpiralData";

const FRAME_INTERVAL_MS = 33; // ~30fps
const FALLBACK_FRAME_COUNT = 75;
const FALLBACK_GRID_SIZE = 80;

/** Brand blue tiers — inline styles so innerHTML is not purged by Tailwind. */
const TIER_STYLE: Record<number, string> = {
  4: "color:var(--color-brand);opacity:1",
  3: "color:var(--color-brand);opacity:0.9",
  2: "color:var(--color-brand);opacity:0.75",
};

function buildFallbackFrames(): string[] {
  return Array.from({ length: FALLBACK_FRAME_COUNT }, (_, frame) => {
    const tilt = 0.42;
    const spin = (frame / FALLBACK_FRAME_COUNT) * Math.PI * 2;
    const lines: string[] = [];

    for (let y = 0; y < FALLBACK_GRID_SIZE; y++) {
      let line = "";
      const ny = (y / (FALLBACK_GRID_SIZE - 1) - 0.5) * 2;

      for (let x = 0; x < FALLBACK_GRID_SIZE; x++) {
        const nx = (x / (FALLBACK_GRID_SIZE - 1) - 0.5) * 2;
        const diskX = nx;
        const diskY = ny / tilt;
        const radius = Math.hypot(diskX, diskY);

        if (radius > 0.92 || radius < 0.18) {
          line += " ";
          continue;
        }

        const angle = Math.atan2(diskY, diskX);
        const wave = Math.sin(angle * 5 + spin) * 0.5 + Math.cos(radius * 18 - spin * 1.5) * 0.5;
        const edgeFade = 1 - Math.abs(radius - 0.55) / 0.42;
        const density = wave * 0.45 + edgeFade * 0.85;

        line += density > 0.82 ? "▪" : density > 0.58 ? "▫" : density > 0.36 ? "·" : " ";
      }

      lines.push(line);
    }

    return lines.join("\n");
  });
}

async function decodeFrames(payload: string): Promise<string[]> {
  if (typeof DecompressionStream === "undefined") {
    return buildFallbackFrames();
  }

  try {
    const binary = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const stream = new Blob([binary as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const text = await new Response(stream).text();
    const frames = text.split("\x00").filter((f) => f.length > 0);
    return frames.length > 0 ? frames : buildFallbackFrames();
  } catch {
    return buildFallbackFrames();
  }
}

function buildFrameHtml(frame: string): string {
  let html = "";
  let lastTier = 0;

  for (let i = 0; i < frame.length; i++) {
    const ch = frame[i];

    if (ch === "\n") {
      if (lastTier !== 0) html += "</span>";
      html += "\n";
      lastTier = 0;
      continue;
    }

    let tier = 0;
    let glyph = " ";
    if (ch === "▪") {
      tier = 4;
      glyph = "0";
    } else if (ch === "▫") {
      tier = 3;
      glyph = "1";
    } else if (ch === "·") {
      tier = 2;
      glyph = "1";
    }

    if (tier === 0) {
      if (lastTier !== 0) html += "</span>";
      html += " ";
      lastTier = 0;
      continue;
    }

    if (tier !== lastTier) {
      if (lastTier !== 0) html += "</span>";
      html += `<span style="${TIER_STYLE[tier]}" aria-hidden="true">`;
    }
    html += glyph;
    lastTier = tier;
  }

  if (lastTier !== 0) html += "</span>";
  return html;
}

interface AsciiSpiralProps {
  className?: string;
}

export function AsciiSpiral({ className }: AsciiSpiralProps) {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const pre = preRef.current;
    if (!pre) return;

    let rafId = 0;
    let lastFrameTime = 0;
    let frameIdx = 0;
    let inView = true;
    let cancelled = false;
    let htmlFrames: string[] = [];
    let observer: IntersectionObserver | null = null;

    const render = (now: number) => {
      if (cancelled) return;
      if (now - lastFrameTime < FRAME_INTERVAL_MS) {
        if (inView) rafId = requestAnimationFrame(render);
        return;
      }
      lastFrameTime = now;
      if (htmlFrames.length > 0) {
        pre.innerHTML = htmlFrames[frameIdx % htmlFrames.length] ?? "";
        frameIdx++;
      }
      if (inView) rafId = requestAnimationFrame(render);
    };

    const startLoop = () => {
      cancelAnimationFrame(rafId);
      lastFrameTime = 0;
      rafId = requestAnimationFrame(render);
    };

    void decodeFrames(SPIRAL_PAYLOAD_B64).then((decoded) => {
      if (cancelled) return;

      htmlFrames = decoded.map(buildFrameHtml);
      pre.innerHTML = htmlFrames[0] ?? "";

      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) return;

      observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry || cancelled) return;
          const wasInView = inView;
          // Treat near-viewport as visible — empty/rotated pre can report 0 intersection briefly.
          inView = entry.isIntersecting || entry.intersectionRatio > 0;
          if (!wasInView && inView) startLoop();
        },
        { threshold: [0, 0.01], rootMargin: "80px" },
      );
      observer.observe(pre);
      inView = true;
      startLoop();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, []);

  return (
    <pre
      ref={preRef}
      aria-hidden="true"
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        background: "transparent",
        color: "var(--color-brand)",
        padding: 0,
        margin: 0,
        overflow: "visible",
        textRendering: "geometricPrecision",
        WebkitFontSmoothing: "none",
        MozOsxFontSmoothing: "grayscale",
      }}
      className={cn(
        "ascii-spiral select-none whitespace-pre font-bold leading-none",
        "text-[3.5px] sm:text-[4.5px] md:text-[5px] lg:text-[5.5px] xl:text-[6px]",
        className,
      )}
    />
  );
}
