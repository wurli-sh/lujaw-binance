# Deployment profile

Load addresses and market facts from `deployments/bsc-testnet.json` (version `lujaw.deployment/1`).

Required locks:

- `chainId`: **97**
- Market: Venus mock **USDT**, `underlyingDecimals: 6`
- Supply: `mint(uint256)` selector `0xa0712d68` on `venus.market.vToken`
- Gate 0: `verification.gate0FullPath === "passed"`

Do not hard-code explorer or contract addresses in prompts; copy from the profile at runtime.
