# IPTV phrase word list

`server/core/iptv-words.ts` adapts [EFF's Long Wordlist](https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt), created by Joseph Bonneau for the Electronic Frontier Foundation. Source retrieved October 25, 2026; SHA-256 `addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e`.

EFF material is distributed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/), per [EFF's copyright policy](https://www.eff.org/copyright). This adaptation removes dice indices, retains lowercase ASCII words of three through seven letters, and removes words matching the following conservative exclusion pattern. Some harmless words are also excluded to keep the filter simple:

```text
sex|porn|rape|kill|dead|death|suicid|murder|nazi|racis|terror|demon|hell|damn|bastard|idiot|moron|drunk|toilet|feces|urine|penis|vagina|genital|breast|nipple|erotic|fetish|lust|coital|cocaine|heroin|drug|cancer|corpse|bloody|blood|slave|violent|abuse|ass$|^ass|butt|fart|puke|vomit
```

The filtered inventory contains 4,420 distinct words. Each of the three words is chosen independently and uniformly with Node's cryptographic `randomInt`, with replacement, providing about 36.33 bits of randomness. Tests require at least 4,096 distinct entries. A phrase is at most 23 characters including its two hyphens. This deliberately short alias is an online access credential protected by a shared pre-lookup limit of 60 requests per minute. It is not a general password recommendation or an encryption passphrase. EFF's general passphrase guidance recommends longer phrases.
