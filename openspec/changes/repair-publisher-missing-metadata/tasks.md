## 1. Owner-scoped repair
- [x] 1.1 Reuse the attributed publisher inline capture and cached bookmark checks to collect the missing source metadata.
- [x] 1.2 Fill only the blank fields for that private owner and HTML bookmark. Exercise replay, partial evidence, an existing alias, ordinary users and other owners.

- [x] 1.3 Preserve structured WeChat article attribution through parsing.

## 2. Verify and backfill
- [x] 2.1 Exercise an existing starred bookmark end to end. Confirm both owner reads and public list/detail reads, original URL, bookmark IDs, body digest and star.

Post-merge operator rollout:

- [ ] 2.2 Deploy through the normal beta flow. Pick the smallest real sample that exercises each missing field. If the live inventory contains no empty-title WeChat article, verify title and WeChat attribution on separately identified canaries.
- [ ] 2.3 Run the same idempotent submission for the uniquely matched remaining eligible entries only after those canaries pass. Count repairs by readback and report incomplete records separately.
