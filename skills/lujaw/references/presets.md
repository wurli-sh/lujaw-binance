# Care Plan presets (6-decimal USDT)

| Preset | alertBelow | interveneBelow | restoreTo | maxTopUpRaw | Session |
|--------|-----------:|---------------:|----------:|------------:|--------:|
| conservative | 1.65 | 1.60 | 1.80 | 25000000 (25 USDT) | 24h |
| balanced | 1.50 | 1.45 | 1.65 | 15000000 (15 USDT) | 24h |
| custom / NL | user | user | user | ≤ 25000000 | ≤ 24h |

`alertBelow = interveneBelow + 0.05` when the NL extract omits alert.
