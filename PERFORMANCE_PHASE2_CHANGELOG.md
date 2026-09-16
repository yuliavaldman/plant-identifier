# Performance Phase 2 — Changelog

**Date:** 2026-09-16

## Summary

Implemented two-stage analysis pipeline with progressive frontend rendering, plus safety fixes to identification promotion and toxicity display. All experimental features default to OFF — production behavior is unchanged unless flags are explicitly enabled.

## Safety Fixes (always active, regardless of feature flags)

### Wikipedia identification promotion — DISABLED
- `maybePromoteByWiki()` converted to a no-op
- Wikipedia/Wikidata verifies taxonomy (taxon name existence), NOT visual identification
- Wikipedia results are still displayed as taxonomy verification info in cross-reference
- Rationale: verifying that a scientific name exists in Wikipedia is not evidence that an image contains that species

### PlantNet alternative promotion — restricted to exact species match
- Genus-only match no longer triggers promotion (e.g., Monstera obliqua matching Monstera adansonii was incorrectly treated as species-level agreement)
- Only exact species-level match between PlantNet and a Claude alternative may promote
- Promoted alternative preserves its own confidence — never inherits higher confidence from the rejected primary

### Confidence handling — conservative
- Wikipedia sources excluded from `agreeingSources` count (`isTaxonomyOnly: true`)
- Wikipedia can never boost visual identification confidence
- PlantNet genus-only agreement already capped confidence at 0.75 (unchanged)
- Only PlantNet exact species agreement can increase confidence

### Toxicity UI wording — fixed
- When `verification !== "verified"`, display "לא אומת" instead of "לא רעיל"
- Verification warning still shown for uncertain/unknown states
- Only verified toxicity shows definitive "רעיל" / "לא רעיל" labels
- Applies to both pets and humans sections

### Toxicity Stage 2 safety
- Stage 2 enrichment prompt includes explicit rules about uncertain toxicity
- Enrichment input now includes: `toxicity.verification`, `identification.confidence`, `confidenceLevel`, and PlantNet species disagreement flag
- If verification is uncertain/unknown, Stage 2 must not generate authoritative safe claims
- If identification is uncertain, toxicity details must state this explicitly

## Two-Stage Pipeline (feature-flag gated)

### Feature Flags (defaults preserve pre-Phase 2 behavior)

| Flag | Default | Effect |
|---|---|---|
| `PLANTDOC_TWO_STAGE_ENABLED` | **`false`** | Two-stage pipeline with partial results |
| `PLANTDOC_OPTIMIZED_PROMPT_ENABLED` | **`false`** | Optimized 2708-char prompt (single-stage only) |
| `PLANTDOC_IMAGE_MAX_DIMENSION` | **`1500`** | Max image dimension for Claude |

To enable: set all three in Render environment variables:
```
PLANTDOC_TWO_STAGE_ENABLED=true
PLANTDOC_OPTIMIZED_PROMPT_ENABLED=true
PLANTDOC_IMAGE_MAX_DIMENSION=1280
```

### Backend Changes

**`services/claude-vision.js`:**
- Renamed `ANALYSIS_PROMPT` to `LEGACY_ANALYSIS_PROMPT` (preserved for fallback)
- Added `OPTIMIZED_ANALYSIS_PROMPT` (2708 chars, benchmarked 25% faster, same schema)
- Added `STAGE1_PROMPT` (~1700 chars) — core fields only
- Added `STAGE2_ENRICHMENT_PROMPT` with toxicity safety rules
- Added `getAnalysisPrompt(options)` — selects prompt based on flags
- Extracted `parseClaudeJson(text, errorLabel)` — DRY helper
- Modified `analyzeWithClaude(imageBase64, mimetype, options={})` — accepts options
- Added `enrichWithClaude(stage1Result, enrichmentContext)` — text-only, passes uncertainty context
- Added `mergeStage2IntoResult(stage1, stage2)` — safe merge

**`server.js`:**
- Feature flags default to OFF (safe production behavior)
- Added `buildVisualCrossReference()` — fast visual-only cross-reference for Stage 1 (no wiki wait)
- Added `finalizeCrossReference()` — full cross-reference including wiki (used in single-stage and Stage 2)
- Rewrote `processImage()`:
  - Two-stage: Claude + PlantNet parallel → visual cross-reference → publish partial → Stage 2 enrichment + wiki parallel → merge → done
  - Single-stage: Claude + PlantNet parallel → full cross-reference (with wiki) → done
- Wikipedia deferred to Stage 2 in two-stage mode (saves ~4s from Stage 1)
- Added `logPerfSummary()` for consistent timing output
- Updated `/api/result/:jobId` for "partial" status with phase info

### Frontend Changes

**`public/js/app.js`:**
- Polling handles "partial" status: renders Stage 1 immediately, shows enrichment loader, continues polling
- Stage 2 failure or timeout: keeps Stage 1 result, resolves gracefully
- Toxicity display: "לא אומת" when verification is not "verified"

**`public/css/styles.css`:**
- `.enrichment-loading` styles with spinner animation

**`public/index.html`:**
- Enrichment loading indicator element

## Architecture

```
TWO_STAGE_ENABLED=true:
  Image → compress(1280px) → [Stage 1 Claude + PlantNet] parallel
    → visual cross-reference (no wiki) → publish "partial"
    → [Stage 2 enrichment + wiki verification] parallel
    → merge → publish "done"
    (Stage 2 failure → promote partial to "done" with Stage 1 data)

TWO_STAGE_ENABLED=false (default):
  Image → compress(1500px) → [Claude (legacy prompt) + PlantNet] parallel
    → full cross-reference (with wiki) → publish "done"
```

## Concurrency Behavior

`MAX_CONCURRENT_JOBS = 3` — the active job slot remains occupied through both Stage 1 AND Stage 2. With 4+ simultaneous analyses, the 4th user gets a 429 error even though users 1-3 may have already received their Stage 1 results and are waiting for enrichment only.

Future improvement: release the concurrency slot after Stage 1 completes and run Stage 2 enrichment outside the slot, possibly with a separate enrichment concurrency limit. Not implemented in this phase to avoid risk.

## No Changes Made To

- PlantNet API integration
- Payment/account architecture
- Android package configuration
- UI design/layout
- Refine/follow-up image flows
- Service Worker version
- Model selection (still claude-sonnet-4-6)
