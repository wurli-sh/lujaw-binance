export const SITE = {
  brand: "LUJAW",
  title: "LUJAW — Give your position a safety line",
  description:
    "Bounded Venus collateral top-up on BSC testnet via a scoped Altana session. User-invoked rescue for one verified USDT market.",
  docsUrl: process.env.NEXT_PUBLIC_DOCS_URL ?? "https://github.com/wurli-sh/lujaw-binance",
  ctaUrl: process.env.NEXT_PUBLIC_CTA_URL ?? "https://github.com/wurli-sh/lujaw-binance",
  ctaLabel: "Open docs",
  hero: {
    eyebrow: "On-chain rescue for Venus positions",
    headlineLead: "Give your position a safety line",
    headlineAccent: ".",
    sub: "Set a Care Plan, grant a short-lived Altana session, and top up the smallest allowed USDT collateral on BSC testnet — then verify recovery on a pinned block. One market. No continuous monitoring.",
  },
  footer: {
    blurb:
      "Bounded, user-invoked rescue for one Venus lending market on BSC testnet — scoped Altana authority and verified post-state.",
    limitation:
      "LUJAW performs bounded user-invoked rescue for one supported Venus market. It does not make DeFi risk-free, clear token allowances, or monitor positions continuously.",
    copyright: "© 2026 LUJAW · BSC testnet demo",
  },
} as const;
