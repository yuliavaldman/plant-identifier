# PlantDoc — Visual Polish Changelog

## Date: 2026-09-16

---

### Files Changed

| File | Changes |
|------|---------|
| `public/index.html` | Hero rewrite (SVG logo, badge, copy, illustration), SVG benefit icons, how-it-works connectors, upload wording |
| `public/css/styles.css` | Color refinement, typography, spacing, hero illustration, benefit icon containers, how-it-works connectors, fade-in animation, prefers-reduced-motion |
| `public/sw.js` | Cache version v16 → v17 |
| `android/app/src/main/assets/public/*` | Synced via `npx cap sync android` |

### Files NOT Changed
- `public/js/app.js` — no JS logic changes
- `server.js` — no backend changes
- `public/js/config.js` — Capacitor config unchanged
- `capacitor.config.json` — unchanged
- `package.json` — no dependency changes

---

### Visual Changes

#### Hero Section
- **Logo**: Replaced 🌿 emoji with inline SVG botanical leaf (3-leaf motif with stem)
- **Capability badge**: Added "זיהוי • אבחון • טיפול" chip below title — translucent background, subtle border, letter-spacing
- **Headline**: Changed to "מעלים. מזהים. מבינים מה הצמח צריך."
- **Supporting text**: Changed to "העלו תמונה של הצמח וקבלו זיהוי, אבחון בעיות והמלצות טיפול."
- **CTA button**: Text changed to "העלאת תמונה" with upload arrow icon (was camera icon)
- **Background illustration**: Added subtle SVG plant with scan-frame crosshair (dashed rectangle, tick marks) — suggests "image → analysis" concept
- **Gradient**: Refined to 5-stop gradient (darker at top, more depth)
- **Decorative leaves**: Simplified to 2 larger, more subtle blobs (was 3)
- **CTA hover**: Added glow ring on hover, scale-down on active press

#### Icons Replaced (emoji → SVG)
- **זיהוי צמחים**: 🌱 → SVG leaf with scan circle overlay
- **אבחון בריאותי**: 🔬 → SVG magnifying glass with + crosshair
- **המלצות טיפול**: 💊 → SVG leaf/plant with care branches
- All icons housed in 48×48 rounded-square containers with green tint background
- Consistent 28px icon size, 1.5px stroke width

#### Benefit Cards
- Increased padding (28px 20px)
- Icon placed in rounded-square container (`border-radius: 14px`, `background: rgba(45,106,79,0.07)`)
- Improved hover: 4px lift (was 3px), refined shadow
- Mobile: 16px gap between icon and text, 18px 20px padding

#### How It Works Section
- Added green connector lines between steps (`how-connector` divs)
- Steps capped at 440px max-width for cleaner centering
- Step 2 text changed to "PlantDoc מנתח"
- Step 3 text changed to "מקבלים זיהוי והמלצות"
- Number circles: added subtle box-shadow
- Reduced number size to 34px (was 36px) for compactness

#### Upload Area Wording
- Web heading: "גררו תמונה לכאן או בחרו קובץ"
- Native heading: "בחרו תמונה מהגלריה"
- Upload icon: changed from camera to upload arrow

---

### Typography Changes
- Title: 2.6rem, -1px letter-spacing (was 2.4rem, -0.5px)
- Headline: 1.2rem, weight 700 (was 1.15rem, weight 600)
- Badge: 0.78rem, 1px letter-spacing
- CTA button shadow: 24px spread (was 20px)
- Added `-webkit-font-smoothing: antialiased` to body
- Container max-width: 760px (was 800px) for tighter feel

---

### Color Refinement
- `--bg`: #f5f2ec (was #f8f6f1) — warmer, slightly darker off-white
- `--text`: #2a3a2a (was #2c3e2c) — darker for better contrast
- `--text-light`: #4d6a4d (was #5a7a5a) — darker for readability
- `--border`: #dde8d6 (was #e0ead8) — slightly softer
- `--shadow-card`: reduced opacity for subtlety
- Hero gradient: 5 color stops instead of 4, starts darker (#0a1f14)
- theme-color meta: changed to #1b4332 (was #2d6a4f)

---

### Spacing Changes
- Container padding: 0 20px 24px (was 0 16px 20px)
- Benefits section margin-bottom: 40px (was 32px)
- How section margin-bottom: 40px (was 36px)
- Hero padding: 52px 24px 64px (was 48px 20px 56px)
- Hero curve: 36px height (was 32px)
- Footer padding: 28px/40px (was 24px/36px)

---

### Animation Added
- Fade-in animation on benefits and how-it-works sections (0.5s ease-out, 12px translateY)
- How section has 0.1s delay
- `@media (prefers-reduced-motion: reduce)` disables all animations and transitions
- No animation libraries added — pure CSS

---

### Performance Impact
- No external dependencies added
- No images added — all SVG inline
- No new JS code
- Total CSS size similar (structural changes, not additions)
- All SVG elements are lightweight (<1KB total)

---

### Known Limitations
- Hero botanical illustration may not be visible on very small screens due to opacity — this is intentional (decorative only)
- Loading section emoji icons (step1-4) are unchanged — they are part of the analysis flow, not the homepage
- Results page cards still use emoji in headers — unchanged per spec

---

### Testing
- Desktop (800px+): verified layout, spacing, hover states
- Mobile (375×812): verified hero, cards, steps, history, footer
- No horizontal overflow confirmed via JS check
- No console errors
- RTL layout correct throughout
- Android Capacitor: `npx cap sync android` successful
