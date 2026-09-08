import { describe, expect, it } from "vitest";
import {
  BINANCE_REASON_CODES,
  DecimalParseError,
  applyBpsUp,
  formatScaled,
  parseScaled,
  roundDownToStep,
  roundUpToStep,
  walkAsksForQuote,
} from "../src/index.js";

describe("binance decimal", () => {
  it("parses and formats without floats", () => {
    expect(formatScaled(parseScaled("12.34"))).toBe("12.34");
    expect(formatScaled(parseScaled("0.001"))).toBe("0.001");
    expect(formatScaled(parseScaled("100"))).toBe("100");
  });

  it("rejects invalid decimals", () => {
    for (const bad of ["", " 1", "1 ", "1e2", "-1", "+1", "01.2", "NaN", "Infinity", ".5"]) {
      expect(() => parseScaled(bad)).toThrow(DecimalParseError);
    }
  });

  it("rounds to step conservatively", () => {
    const step = parseScaled("0.001");
    expect(formatScaled(roundDownToStep(parseScaled("1.2349"), step))).toBe("1.234");
    expect(formatScaled(roundUpToStep(parseScaled("600.101"), parseScaled("0.01")))).toBe("600.11");
  });

  it("applies bps with ceil", () => {
    expect(formatScaled(applyBpsUp(parseScaled("100"), 20))).toBe("0.2");
  });
});

describe("binance orderbook", () => {
  it("walks asks for quote and reports slippage", () => {
    const walk = walkAsksForQuote(
      [
        { price: "100", quantity: "1" },
        { price: "101", quantity: "1" },
      ],
      "150",
    );
    expect(walk.ok).toBe(true);
    if (!walk.ok) return;
    expect(walk.filledQuote).toBe("150");
    expect(Number(walk.vwap)).toBeGreaterThan(100);
    expect(walk.slippageBps).toBeGreaterThan(0);
  });

  it("fails closed on insufficient depth", () => {
    const walk = walkAsksForQuote([{ price: "100", quantity: "0.1" }], "50");
    expect(walk.ok).toBe(false);
  });
});

describe("binance reason codes", () => {
  it("locks the public reason-code set", () => {
    expect(BINANCE_REASON_CODES).toContain("VERIFIED_COMPLIANT");
    expect(BINANCE_REASON_CODES).toContain("SLIPPAGE_BINDING");
    expect(BINANCE_REASON_CODES).toHaveLength(34);
  });
});
