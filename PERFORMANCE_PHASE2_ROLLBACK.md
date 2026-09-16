# Performance Phase 2 — Rollback Plan

## Current Production Behavior (Pre-Phase 2)

- Model: `claude-sonnet-4-6`
- Prompt: Full 5924-char ANALYSIS_PROMPT (single call)
- Image max dimension: 1500px, JPEG quality 80
- max_tokens: 6000
- Single-stage: one Claude vision call returns full result
- Average latency: ~53.6s
- Polling returns: `processing` → `done`

## Files Changed

| File | Purpose |
|---|---|
| `services/claude-vision.js` | Added Stage 1 + Stage 2 prompts and functions, toxicity safety rules |
| `server.js` | Feature flags (default OFF), two-stage pipeline, visual-only cross-reference, wiki deferred to Stage 2, fixed PlantNet promotion (species-only), disabled Wikipedia promotion, conservative confidence |
| `public/js/app.js` | Progressive rendering on partial status, Stage 2 loading UX, toxicity UI wording fix |
| `public/css/styles.css` | Stage 2 enrichment loading styles |
| `public/index.html` | Enrichment loading indicator element |

## Backup Location

All original files backed up to: `backup-pre-phase2/`

- `backup-pre-phase2/server.js`
- `backup-pre-phase2/claude-vision.js`
- `backup-pre-phase2/app.js`
- `backup-pre-phase2/styles.css`

## How to Revert

### Option 1: Restore from backup (full revert)

```bash
cp backup-pre-phase2/server.js server.js
cp backup-pre-phase2/claude-vision.js services/claude-vision.js
cp backup-pre-phase2/app.js public/js/app.js
cp backup-pre-phase2/styles.css public/css/styles.css
npx cap sync android
```

### Option 2: Disable via feature flags (no code rollback needed)

These are the **default values** — missing environment variables already preserve production behavior:

```
PLANTDOC_TWO_STAGE_ENABLED=false     (default)
PLANTDOC_OPTIMIZED_PROMPT_ENABLED=false  (default)
PLANTDOC_IMAGE_MAX_DIMENSION=1500    (default)
```

To explicitly disable, add these to `.env` or Render environment variables. Server restart required.

### To Enable Experimental Mode

Set in Render environment variables:

```
PLANTDOC_TWO_STAGE_ENABLED=true
PLANTDOC_OPTIMIZED_PROMPT_ENABLED=true
PLANTDOC_IMAGE_MAX_DIMENSION=1280
```

## Feature Flags

| Flag | Default | Effect |
|---|---|---|
| `PLANTDOC_TWO_STAGE_ENABLED` | **`false`** | When `true`, uses two-stage architecture. When `false` (default), falls back to single full-analysis call — identical to pre-Phase 2 production behavior. |
| `PLANTDOC_OPTIMIZED_PROMPT_ENABLED` | **`false`** | When `true`, uses the benchmarked optimized prompt (single-stage mode only). When `false` (default), uses the original 5924-char prompt. |
| `PLANTDOC_IMAGE_MAX_DIMENSION` | **`1500`** | Max image dimension for Claude. Default matches pre-Phase 2 production. Set to `1280` for optimized mode. |

## Safe Rollback Sequence

1. Remove or set all experimental flags to off in Render environment variables
2. Restart server
3. Test one analysis to confirm original behavior
4. If still broken, restore from `backup-pre-phase2/`

## Safety Changes (always active, regardless of flags)

These fixes apply even in single-stage mode:
- Wikipedia/Wikidata can never promote an alternative identification
- PlantNet alternative promotion requires exact species match (genus-only is insufficient)
- PlantNet promotion preserves the alternative's own confidence (never inflates)
- Wikipedia verification excluded from confidence boosting (taxonomy only, not visual)
- Toxicity UI shows "לא אומת" instead of "לא רעיל" when verification is not "verified"
