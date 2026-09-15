# PlantDoc Phase 2 — Changelog

## Summary
Focused reliability improvement for plant identification and diagnosis. No redesign, no architecture changes, no new external dependencies.

## Files Changed

| File | Change type |
|------|-------------|
| `services/claude-vision.js` | **Rewritten** — new prompt with honesty rules, observation/diagnosis separation, treatment safety, toxicity verification |
| `server.js` | **Modified** — status check, cross-reference logic, rate limiting env vars, image validation, toxicity verification, logging |
| `public/js/app.js` | **Modified** — new UI sections, backward compat for old responses, toxicity warnings, follow-up questions |
| `public/index.html` | **Modified** — added cards: image quality, observations, follow-up questions, error suggestions |
| `public/css/styles.css` | **Modified** — styles for new UI elements |
| `public/sw.js` | **Modified** — cache version bumped to v11 |
| `tests/unit.test.js` | **New** — 30 unit tests + 18 integration test stubs |
| `PHASE2_CHANGELOG.md` | **New** — this file |

## Changes Made

### 1. Claude Prompt (claude-vision.js)
- **Status field**: Changed `"identified"` → `"success"` (server handles both for backward compat)
- **Alternative matches**: Removed forced requirement for 2+ alternatives. Now returns `[]` when identification is clear.
- **Image classification**: Explicit step-by-step: not_a_plant → insufficient_image → success
- **Multiple plants**: Detection added — returns `insufficient_image` with reason when multiple species visible
- **Image quality**: New `imageQuality` field with `overall` (good/acceptable/poor) and `issues` array
- **Observations**: New `observations` array — separates what is visible (facts) from interpretation (diagnosis)
- **Diagnosis structure**: Issues now use `category`, `likelihood`, `visibleEvidence`, `missingEvidence`, `alternativeExplanations`, `questionsToConfirm`
- **Treatment safety**: Rules enforced — low likelihood → only safe reversible actions; never recommend pesticides/drastic measures when uncertain
- **Toxicity**: New `verification` field (verified/uncertain/unknown); model instructed to never say "not toxic" with certainty from image alone
- **Follow-up questions**: New `followUpQuestions` top-level field when diagnoses can't be differentiated
- **Israeli context**: Still checks common Israeli plants first, but no longer assumes user is in Israel
- **insufficient_image response**: Now includes `reason` and `suggestedPhotos` array

### 2. Server (server.js)
- **Status handling**: Accepts both `"success"` (new) and `"identified"` (legacy) as identified responses
- **Rate limiting**: Values now configurable via `ANALYZE_RATE_LIMIT` and `ANALYZE_RATE_WINDOW_MINUTES` env vars (defaults: 10 requests / 10 minutes)
- **Image validation**: New `validateImageBuffer()` function — uses sharp to verify the uploaded buffer is actually a decodable image before processing (catches MIME spoofing)
- **Cross-reference logic**:
  - Distinguishes species agreement, genus-only agreement, and full disagreement
  - Genus agreement no longer boosts confidence — caps at 0.75 with disagreement warning
  - New message: "המקורות מסכימים על הסוג (genus) אך חלוקים על המין (species)"
  - Factors in image quality (poor → cap at 0.6, acceptable → cap at 0.85)
  - Factors in significant alternatives (if close confidence → cap at 0.8)
- **PlantNet failure**: When PlantNet is unavailable (timeout/error/missing key), shows "הצלבה עם PlantNet לא הייתה זמינה בסריקה זו" instead of pretending it verified
- **Wikipedia clarification**: Source note says "אימות קיום השם, לא זיהוי התמונה" (taxon name verification, not image verification)
- **Toxicity verification**: New `applyToxicityVerification()` — downgrades toxicity confidence when identification is uncertain (combinedConfidence < 0.7 → uncertain, < 0.4 → unknown)
- **Logging**: Added timing (ms), no sensitive data logged. New log line at startup shows rate limit config.
- **Timeout**: Kept at 120s (from previous fix)

### 3. Frontend (app.js)
- **Status handling**: Handles `"success"` and `"identified"` (backward compat for cached history items)
- **Image quality card**: Shows when quality is "acceptable" or "poor" with translated issue names
- **Observations card**: Displays what the model actually sees before the diagnostic interpretation
- **Follow-up questions card**: Shows practical questions when diagnosis is ambiguous
- **Insufficient image display**: Friendly card with camera icon, reason text, and suggested photo types (not a technical error)
- **Issue rendering**: Supports both new field names (`visibleEvidence`, `missingEvidence`, etc.) and legacy names (`evidenceVisible`, etc.) via fallbacks
- **Issue badges**: Shows `category` and `likelihood` badges when present
- **Toxicity display**: Three states — verified (green/red checkmarks), uncertain (question marks + warning), unknown (question marks + stronger warning). Never shows green checkmark when unverified.
- **Cross-reference display**: Genus-only match shown with orange icon (🔶) instead of green. Unavailable PlantNet shown with info icon.

### 4. HTML & CSS
- New result cards: `imageQualityCard`, `observationsCard`, `followUpCard`
- New `errorSuggestions` div in error section
- CSS for: `.toxicity-uncertain`, `.toxicity-warning`, `.observations-list`, `.image-quality-notice`, `.follow-up-list`, `.suggested-photos`
- Service worker cache bumped to `plantdoc-v11`

## Bugs Fixed
- Confidence could be "very high" even when PlantNet only agreed at genus level → now capped at 0.75
- Toxicity showed green "not toxic" checkmark even when identification was uncertain → now shows warning
- PlantNet unavailability looked like verification passed → now explicitly shows unavailable
- Wikipedia verification was presented as "confirming the identification" → now clarified as taxon name verification only
- Rate limit values were hardcoded → now configurable via environment variables
- No validation that uploaded file was actually a decodable image (only MIME type checked) → now validated with sharp

## New Behaviour
- Empty `alternativeMatches: []` when identification is clear (no invented alternatives)
- Observation/diagnosis separation visible in results
- Conservative treatment recommendations when diagnosis confidence is low
- Follow-up questions shown to help users narrow ambiguous diagnoses
- Image quality assessment shown when suboptimal
- Multiple plants in image detected and handled
- Toxicity safety: three-tier verification system

## Known Limitations
- Unit tests validate structure and logic but do NOT call the Claude API (require API key)
- Integration tests (#1-#18) require manual execution with real photos
- Image quality assessment depends on Claude's judgment (no independent image analysis)
- Multiple-plant detection depends on Claude recognizing multiple species (no computer vision)
- Toxicity verification is based on identification confidence, not an independent toxicity database
- History items from Phase 1 use old field names — frontend handles them via fallbacks but they won't show new fields (observations, image quality, etc.)

## Tests Performed

### Unit Tests (30/30 passed)
- Confidence level text thresholds ✅
- Response structure validation (success, not_a_plant, insufficient_image) ✅
- Issue structure with new fields ✅
- Cross-reference logic (species/genus/disagreement) ✅
- Toxicity verification logic ✅
- Backward compatibility (old status, old field names, isPlant fallback) ✅
- Rate limiting defaults and env var override ✅
- Image quality enum validation ✅

### Integration Tests (18 listed, require manual execution)
See `tests/unit.test.js` for full list.

### Server Tests
- Server starts without errors ✅
- Frontend loads without console errors ✅
- Health endpoint responds correctly ✅
- Rate limit configuration logged at startup ✅

## Things Intentionally NOT Changed
- PlantDoc branding and design
- Claude model (claude-sonnet-4-6)
- PlantNet integration (kept as-is)
- Wikipedia/Wikidata integration (kept as-is)
- Polling architecture (POST → jobId → GET polling)
- No login, payments, subscriptions, database, or accounts added
- No weather API or location tracking
- No "My Garden" feature
- No multi-image support
- No framework migration
- max_tokens stays at 6000
- File size limit stays at 15MB
