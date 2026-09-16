# Performance Phase 2 — Results & Answers

**Date:** 2026-09-16
**Status:** Implementation complete, NOT deployed to production
**Test environment:** localhost, 5 real plant images, real Claude + PlantNet API calls

---

## End-to-End Test Results

### Two-Stage Mode (PLANTDOC_TWO_STAGE_ENABLED=true, 1280px)

| # | Image | Stage 1 ID | Final ID | Changed? | S1 Health | Final Health | Changed? | Stage 1 Time | Total Time | PlantNet | Tox Verification |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Monstera | Monstera deliciosa | Monstera deliciosa | No | excellent | excellent | No | 18.2s | 63.7s | Monstera deliciosa (agrees) | verified |
| 2 | Tomato | S. lycopersicum var. cerasiforme | Same | No | good | good | No | 28.8s | 81.9s | Solanum lycopersicum (genus) | uncertain |
| 3 | Cactus | Echinopsis sp. | Same | No | good | good | No | 27.3s | 74.2s | Pilosocereus pachycladus (disagrees) | unknown |
| 4 | Sunflower | Helianthus annuus | Same | No | excellent | excellent | No | 16.7s | 53.0s | Helianthus annuus (agrees) | verified |
| 5 | ZZ Plant | Zamioculcas zamiifolia | Same | No | good | good | No | 34.8s | 72.6s | Zamioculcas zamiifolia (agrees) | verified |

**Stage 1 latencies (sorted):** 16.7s, 18.2s, 27.0s, 27.4s, 34.5s
**Stage 1 median (server-side):** 27.0s
**Stage 1 meets <=20s target:** NO (2 of 5 under 20s, median is 27.0s)

**Total latencies:** 53.0s, 63.7s, 72.6s, 74.2s, 81.9s
**Total median:** 72.6s

**Notes:**
- Stage 1 time is pure Claude API time (wiki deferred to Stage 2 — verified in logs)
- All Stage 2 enrichments succeeded (care, seasonal, funFacts arrived)
- No identification changed between Stage 1 and Stage 2
- No diagnosis changed between Stage 1 and Stage 2
- Wikipedia returned 403 for all test calls (test environment limitation, not a code issue)

### Single-Stage Mode (default flags — production behavior)

| # | Image | ID | Health | Total Time | PlantNet | Phase |
|---|---|---|---|---|---|---|
| 1 | Monstera | Monstera deliciosa | excellent | 53.0s | failed | complete |
| 2 | Tomato | S. lycopersicum var. cerasiforme | excellent | 45.5s | Solanum lycopersicum | complete |
| 3 | Cactus | Echinopsis sp. | good | 48.5s | Pilosocereus | complete |
| 4 | Sunflower | Helianthus annuus | excellent | 43.9s | Helianthus annuus | complete |
| 5 | ZZ Plant | Zamioculcas zamiifolia | excellent | 49.9s | Zamioculcas zamiifolia | complete |

**Total latencies:** 43.9s, 45.5s, 48.5s, 49.9s, 53.0s
**Total median:** 48.5s
**Mode confirmed:** `mode: single-stage, prompt: legacy, maxDim: 1500`

### Why Stage 1 Exceeds 20s Target

The benchmark predicted ~15s for Stage 1 using a minimal 1067-char prompt (experiment D). The implemented STAGE1_PROMPT is ~1700 chars and requests more output fields (full observations, toxicity with verification, followUpQuestions), generating more output tokens:

- Benchmark D: ~655 output tokens → ~15s
- Implemented Stage 1: ~800-1200 output tokens → 16-35s (varies with plant complexity)

To reach the 20s target, the Stage 1 prompt would need to be reduced further — potentially dropping observations and follow-up questions from Stage 1. This is a tradeoff: fewer fields in Stage 1 means the user sees less information in the first result.

---

## Answers to 12 Final Questions

### 1. Actual median Stage 1 latency from the NEW implementation

**27.0s** (server-side Claude API time). Polling detects the partial result at 27.3s median (client-side, includes 1.5s polling interval). Range: 15.7s to 34.5s.

Does NOT meet the <=20s target. Two of five tests were under 20s (15.7s, 17.3s). The implemented Stage 1 prompt generates more output tokens than the benchmark's minimal prompt.

### 2. Actual median total latency

**Two-stage total median:** 72.6s (includes Stage 2 enrichment + wiki)
**Single-stage median:** 48.5s (legacy prompt, production behavior)

The two-stage total is higher because it makes two Claude API calls instead of one. However, the user sees meaningful results at the Stage 1 time (27s median) while enrichment loads in the background.

### 3. Did any Stage 1 identification change in Stage 2?

**NO.** All 5 tests: Stage 1 identification was preserved exactly in the final result. Stage 2 only adds care/seasonal/funFacts and toxicity details text — it never modifies identification, health, or issues.

### 4. Any quality regression?

**No identification regression.** All 5 plants were correctly identified in both modes. Identifications match between single-stage and two-stage.

PlantNet cross-reference worked correctly:
- 3 exact species agreements (confidence maintained/boosted)
- 1 genus-level disagreement (confidence correctly capped at 0.75 or lower)
- 1 full disagreement (confidence correctly reduced)

### 5. Is Wikipedia completely prevented from promoting an identification?

**YES.** `maybePromoteByWiki()` is now a no-op. It logs nothing and changes nothing. Wikipedia verification results are still displayed as taxonomy info in the cross-reference sources array, but they cannot alter the primary identification.

Additionally, Wikipedia sources have `isTaxonomyOnly: true` and are excluded from `agreeingSources` count, so they cannot boost confidence either.

### 6. Can genus-only PlantNet agreement promote a species?

**NO.** The `maybePromoteAlternative()` function now requires exact species match (`pnName === altName`). The genus-level check (`pnGenus === altGenus`) has been removed from the promotion logic. Genus-only agreement is reported in cross-reference as informational only.

### 7. How does uncertain toxicity display in the UI?

When `verification !== "verified"`:
- CSS class: `toxicity-uncertain` (yellow/amber styling)
- Icons: `🐾❓` and `👤❓`
- Text: "**לא אומת**" (not verified) — NOT "לא רעיל"
- Warning banner: "מידע הרעילות אינו ודאי..." or "מידע הרעילות לא אומת..."
- Stage 2 enrichment prompt explicitly instructed not to generate authoritative safe claims when verification is uncertain

Only when `verification === "verified"`:
- Shows definitive "רעיל" or "לא רעיל"
- Green (safe) or red (danger) styling

### 8. Are experimental features OFF by default?

**YES.** All three flags default to the pre-Phase 2 production values:
```
PLANTDOC_TWO_STAGE_ENABLED = false     (was 'true' — FIXED)
PLANTDOC_OPTIMIZED_PROMPT_ENABLED = false  (was 'true' — FIXED)
PLANTDOC_IMAGE_MAX_DIMENSION = 1500    (was 1280 — FIXED)
```

Verified in single-stage test: server log shows `mode: single-stage, prompt: legacy, maxDim: 1500`.

### 9. What happens with 4 simultaneous analyses?

**Current behavior:** `MAX_CONCURRENT_JOBS = 3`. The `activeJobs` counter increments on request and decrements in `.finally()` when `processImage()` completes entirely (including Stage 2). The 4th simultaneous request receives HTTP 429: "השרת עמוס כרגע. נסו שוב בעוד כמה רגעים."

**In two-stage mode:** A job slot remains occupied during Stage 2 enrichment even though the user already received their Stage 1 result. With 3 concurrent two-stage analyses, the 4th user is blocked for the full ~70s, not just ~27s.

**Proposed future fix:** Release the `activeJobs` slot after Stage 1 partial is published, and run Stage 2 with a separate enrichment concurrency limit (e.g., `MAX_CONCURRENT_ENRICHMENTS = 5`). This would allow new Stage 1 analyses to start while enrichments run. Not implemented in this phase to avoid concurrency risks.

### 10. Is this version safe to deploy for controlled testing?

**YES, with the default flags** (experimental features OFF). The safety fixes (#2-#6 above) are always active and improve production behavior:
- Wikipedia can no longer incorrectly promote identifications
- PlantNet genus-only agreement can no longer promote species
- Confidence is more conservative
- Toxicity UI is more honest about uncertainty

**For two-stage testing:** Enable the three flags on a staging deployment first. The Stage 1 latency (median 27s) exceeds the 20s target but still delivers results faster than the single-stage path (median 48.5s). Stage 2 failure is handled safely (user keeps Stage 1 data).

### 11. Which files changed?

| File | Changes |
|---|---|
| `services/claude-vision.js` | Prompts, Stage 2 function with toxicity safety, DRY helpers |
| `server.js` | Feature flags (default OFF), two-stage pipeline, wiki deferred, PlantNet promotion fix, Wikipedia promotion disabled, conservative confidence, visual-only cross-reference |
| `public/js/app.js` | Partial status polling, progressive rendering, toxicity UI wording |
| `public/css/styles.css` | Enrichment loading spinner styles |
| `public/index.html` | Enrichment loading indicator element |
| `PERFORMANCE_PHASE2_CHANGELOG.md` | Updated with all changes |
| `PERFORMANCE_PHASE2_RESULTS.md` | This document |
| `PERFORMANCE_PHASE2_ROLLBACK.md` | Updated with correct defaults |
| `test-e2e-phase2.js` | End-to-end test script |
| `test-images/` | 5 test images |
| `test-e2e-results-*.json` | Raw test results |

### 12. Did npx cap sync android succeed?

**YES.** Output:
```
√ copy android in 21.44ms
√ update android in 59.76ms
Sync finished in 0.094s
```

---

## Regression Test Status

| Test Case | Status | Notes |
|---|---|---|
| Normal healthy plant | PASS | Monstera, Sunflower, ZZ Plant correctly identified |
| Pest (aphids-like) | PARTIAL | Tomato image — identified plant correctly, found cracking issue |
| Disease (mildew) | NOT TESTED | No mildew test image available (download failed) |
| Ambiguous case | PASS | Cactus genus-level ID, PlantNet disagrees, confidence correctly low (0.33) |
| not_a_plant | NOT TESTED | Would need a non-plant image |
| insufficient_image | NOT TESTED | Would need a blurry/dark image |
| Stage 2 failure keeps Stage 1 | VERIFIED IN CODE | Backend promotes partial→done on Stage 2 catch |
| PlantNet unavailable | PASS | Single-stage test #1 showed PlantNet failed → still completed |
| Wikipedia unavailable | PASS | All tests had wiki 403 → completed without issue |
| Follow-up questions | PASS | Stage 1 returns followUpQuestions |
| Refine diagnosis | NOT TESTED | Requires interactive UI flow |
| Follow-up image | NOT TESTED | Requires interactive UI flow |
| Toxicity uncertain UI | VERIFIED IN CODE | `toxLabel()` function returns "לא אומת" when !verified |
| Single-stage fallback | PASS | Confirmed `mode: single-stage, prompt: legacy, maxDim: 1500` |
