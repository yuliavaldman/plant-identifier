# PlantDoc — Homepage & Performance Changelog

## Date: 2026-09-16

---

### Homepage Redesign

#### Hero Section (NEW)
- Added gradient hero header with PlantDoc logo, headline, subtitle, and CTA buttons
- Hero CTA: "העלו תמונה" (web) / "צלמו עכשיו" + "בחרו מהגלריה" (native/Capacitor)
- Decorative leaf elements with subtle animation
- Files: `index.html` lines 19–44, `styles.css` (`.app-header`, `.hero-*` rules)

#### Benefits Section (NEW)
- Three benefit cards: Plant ID, Health Diagnosis, Care Recommendations
- 3-column grid on desktop, single-column horizontal cards on mobile (<600px)
- Files: `index.html` lines 95–113, `styles.css` (`.benefits-section`, `.benefit-card`)

#### How It Works Section (NEW)
- Three numbered steps: "מעלים תמונה" → "מנתחים" → "מקבלים תובנות"
- Green numbered circles with gradient background
- Files: `index.html` lines 116–141, `styles.css` (`.how-section`, `.how-step`)

#### Upload Area
- Retained existing drag-and-drop and file input functionality unchanged
- Upload area remains visible by default on the homepage
- Files: `index.html` lines 49–92 (unchanged structure)

#### History Section (DEMOTED)
- Removed emoji from heading, now plain "היסטוריית סריקות"
- Smaller heading (1rem), compact thumbnails (52px), tighter spacing
- Hidden when not on upload/home screen
- All history functionality preserved
- Files: `index.html` lines 298–303, `styles.css` (`.history-section`)

#### Results / Error / Follow-up Sections
- No changes to structure or styling — preserved as-is
- Follow-up questions, refinement results, follow-up image upload all intact

---

### Performance Improvements

#### Script Loading
- Added `defer` attribute to `app.js` script tag for non-blocking HTML parsing
- File: `index.html` line 312

#### Deferred Health Check
- `checkApiStatus()` now deferred by 2 seconds via `setTimeout(checkApiStatus, 2000)` instead of immediate call at DOMContentLoaded
- File: `app.js` line 1450

#### Loading State — Progress Bar (NEW)
- Added horizontal progress bar at top of loading card
- Fills gradually: `Math.min(92, 8 + elapsedSeconds * 1.4)%` — starts at 8%, caps at 92% during polling
- Hits 100% when results arrive
- Files: `index.html` lines 147–148, `styles.css` (`.loading-progress-bar`, `.loading-progress-fill`), `app.js` lines 204–214

#### Loading State — Faster Step Transitions
- Step transitions now every 2.5 seconds (was 4 seconds)
- Steps show ✅ icon when completed
- Cycling loading messages: "מעלה תמונה...", "מזהה את הצמח...", "בודק מחלות ומזיקים...", etc.
- Timer text only appears after 3 seconds elapsed
- File: `app.js` lines 189–235

#### Loading State — Spinner
- Replaced plant-grow CSS animation with a standard spinner
- File: `styles.css` (`.loading-spinner`)

#### Button Feedback
- Immediate `btn-loading` class on analyze button with spinning border pseudo-element
- Button text becomes transparent, spinner overlay appears
- Removed on completion/error
- Files: `app.js` lines 183–184, 328; `styles.css` (`.btn-loading`)

#### Reset Loading State
- New `resetLoadingState()` function resets step classes, icons, progress bar, and text before each analysis
- Prevents stale state from previous scans
- File: `app.js` lines 162–178

#### Section Visibility Management
- `showSection()` updated to hide benefits/how-it-works/history when not on upload screen
- Cleaner transitions between app states
- File: `app.js` lines 110–124

---

### Service Worker
- Cache version bumped from v14 to v15 to invalidate old cached assets
- File: `sw.js` line 1

### Android Sync
- `npx cap sync android` run successfully to push all web changes to Android project
- Android assets updated in `android/app/src/main/assets/public/`

---

### Files Modified
| File | Changes |
|------|---------|
| `public/index.html` | Hero section, benefits, how-it-works, loading card with progress bar, defer on app.js |
| `public/css/styles.css` | Full stylesheet rewrite — hero, benefits, how-it-works, loading card, spinner, btn-loading, demoted history, mobile responsive |
| `public/js/app.js` | Section refs, showSection updates, resetLoadingState, progress bar, faster steps, deferred health check, btn-loading |
| `public/sw.js` | Cache version v14 → v15 |
| `android/app/src/main/assets/public/*` | Synced via `npx cap sync android` |

### Files NOT Modified
- `server.js` — no backend changes
- `public/js/config.js` — Capacitor config unchanged
- `capacitor.config.json` — unchanged
- `package.json` — no dependency changes
