# PlantDoc — Homepage & Performance Review

## Date: 2026-09-16

---

## 1. Overview

This update addresses two areas of the PlantDoc web app:
1. **Better first impression** — redesigned homepage with hero, benefits, how-it-works, and demoted history
2. **Better perceived + real performance** — progress bar, faster step transitions, deferred non-critical work, immediate button feedback

All changes are purely frontend. No backend changes were made. The existing Android Capacitor app compatibility is preserved via `npx cap sync android`.

---

## 2. What Was Done

### Homepage Redesign
- **Hero section**: Green gradient header with logo, Hebrew headline ("זהו כל צמח. אבחנו כל בעיה."), subtitle, and prominent CTA buttons. Web-only shows "העלו תמונה"; native Capacitor shows camera + gallery buttons.
- **Benefits cards**: Three cards highlighting plant identification, health diagnosis, and care recommendations. Responsive grid: 3 columns on desktop, stacked horizontal cards on mobile.
- **How-it-works**: Three numbered steps explaining the flow: upload → analyze → get insights.
- **Demoted history**: Scan history moved to bottom with smaller heading, compact thumbnails, and hidden during non-upload screens.
- **Upload area**: Retained in full — drag-and-drop, file input, camera input (native), preview, analyze button.

### Performance Improvements
- **`defer` on app.js**: Non-blocking script loading — HTML renders before JS executes.
- **Deferred health check**: `checkApiStatus()` delayed by 2 seconds, no longer blocks initial render.
- **Progress bar**: Horizontal bar at top of loading card fills from 8% to 92% over time, hits 100% on completion.
- **Faster step transitions**: Steps advance every 2.5s (was 4s). Each shows ✅ when done.
- **Spinning button**: Immediate visual feedback on "נתח את הצמח" button with CSS spinner overlay.
- **Loading state reset**: `resetLoadingState()` clears stale state between scans.
- **Timer delay**: Elapsed-time counter only shows after 3 seconds, reducing initial visual noise.

---

## 3. What Was NOT Changed

- **Backend** (`server.js`): No changes — all API routes, CORS, polling, job store unchanged
- **Results screens**: All result cards, follow-up questions, refinement results, follow-up image upload preserved as-is
- **Capacitor config**: `capacitor.config.json` unchanged — package ID `com.plantdoc.app`, webDir `public`
- **Config module**: `config.js` unchanged — `PlantDocConfig.API_BASE_URL` and `IS_NATIVE` detection preserved
- **Dependencies**: No new packages added, no framework changes
- **Service Worker logic**: Only cache version bumped (v14 → v15); SW still disabled in Capacitor context
- **All 5 fetch calls**: Still use `PlantDocConfig.API_BASE_URL` prefix for Capacitor compatibility

---

## 4. Verification Results

### Desktop (full width)
- Hero section renders with gradient background, logo, headline, CTA buttons
- Benefits grid shows 3 columns
- How-it-works shows 3 numbered steps
- Upload area, preview, and analyze flow work correctly
- History section renders compactly at bottom

### Mobile (375×812)
- Hero adapts: full-width CTA buttons, adjusted padding
- Benefits cards stack vertically with horizontal layout (icon left, text right)
- How-it-works steps stack vertically
- Upload area takes full width
- All sections scroll naturally, no horizontal overflow

### Console
- No JavaScript errors in browser console
- No network errors (API key warning is expected in local dev without .env)

### RTL
- All Hebrew text renders correctly right-to-left
- Layout respects `dir="rtl"` throughout

### Android Sync
- `npx cap sync android` completed successfully
- Web assets copied to `android/app/src/main/assets/public/`

---

## 5. Constraints Compliance

| Constraint | Status |
|------------|--------|
| Do NOT rebuild from scratch | ✅ Targeted edits to existing files |
| Do NOT change backend architecture | ✅ No server.js changes |
| Do NOT break Android Capacitor app | ✅ cap sync successful, native detection preserved |
| Do NOT remove existing functionality | ✅ All features preserved |
| Do NOT redesign results screens | ✅ Results/error/follow-up unchanged |
| No chatbot | ✅ Not added |
| No accounts/database/My Garden/subscriptions | ✅ Not added |
| No wide redesign | ✅ Focused on homepage + loading only |
| Keep Claude AI backend | ✅ Unchanged |
| Keep PlantNet | ✅ Unchanged |
| No API keys in client/config | ✅ None added |
| Keep relative /api/ paths for web | ✅ config.js unchanged |
| No framework migration | ✅ Vanilla HTML/CSS/JS only |
| Package ID com.plantdoc.app | ✅ Preserved |
| All AI through PlantDoc backend | ✅ All fetch calls go through /api/ routes |

---

## 6. Known Limitations

- The API key warning ("מפתח API לא הוגדר") shows in local development when `.env` is missing. This is expected and does not appear in production.
- The progress bar fill rate is time-based (not actual progress), capping at 92% until the result arrives. This is intentional for perceived performance.
- No dark mode was added (not requested in the spec).

---

## 7. Recommended Next Steps

1. Deploy to Render and verify production behavior
2. Test the full analyze flow end-to-end in production
3. Test on a physical Android device via Android Studio debug build
4. Consider adding subtle entrance animations to benefit cards (CSS only, if desired)
