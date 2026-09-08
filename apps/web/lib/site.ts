const REPO_URL =
  process.env.NEXT_PUBLIC_DOCS_URL ?? "https://github.com/wurli-sh/lujaw-binance";

export const SITE = {
  brand: "LUJAW",
  title: "LUJAW — Trading power needs a seatbelt",
  description:
    "Seatbelt for Binance Agent OS. Policy, preflight, one-shot authorize, Binance confirmation, episode verify — hostile all-in dies before a trade tool runs.",
  docsUrl: REPO_URL,
  ctaUrl: `${REPO_URL}/blob/main/docs/binance-cursor-demo.md`,
  ctaLabel: "Open the demo",
  hero: {
    eyebrow: "Seatbelt for Binance Agent OS",
    headlineLead: "Trading power needs a seatbelt",
    headlineAccent: ".",
    sub: "Set caps once. LUJAW preflights size, binds one authorized order, and verifies the fill after Binance confirms.",
  },
  footer: {
    blurb:
      "Seatbelt for AI Spot trades on Binance — policy, preflight, one-shot authorize, episode verify.",
    limitation:
      "Does not make trading safe or profitable. Does not stop a bypass of LUJAW.",
    copyright: "© 2026 LUJAW · Binance Spot demo",
  },
  links: {
    repo: REPO_URL,
    cursorDemo: `${REPO_URL}/blob/main/docs/binance-cursor-demo.md`,
    threatModel: `${REPO_URL}/blob/main/docs/binance-threat-model.md`,
    noFundsDemo: `${REPO_URL}/blob/main/docs/binance-no-funds-demo.md`,
  },
} as const;
