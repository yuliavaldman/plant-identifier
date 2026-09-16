require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const { analyzeWithClaude, enrichWithClaude, mergeStage2IntoResult, refineWithClaude, analyzeFollowUpImage } = require('./services/claude-vision');
const { identifyWithPlantNet } = require('./services/plantnet');
const { verifyWithWikipedia } = require('./services/wiki-verify');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Feature flags (defaults preserve pre-Phase-2 production behavior) ──
// To enable experimental optimizations, set in Render environment variables:
//   PLANTDOC_TWO_STAGE_ENABLED=true
//   PLANTDOC_OPTIMIZED_PROMPT_ENABLED=true
//   PLANTDOC_IMAGE_MAX_DIMENSION=1280
const TWO_STAGE_ENABLED = (process.env.PLANTDOC_TWO_STAGE_ENABLED || 'false').toLowerCase() === 'true';
const OPTIMIZED_PROMPT_ENABLED = (process.env.PLANTDOC_OPTIMIZED_PROMPT_ENABLED || 'false').toLowerCase() === 'true';
const IMAGE_MAX_DIMENSION = parseInt(process.env.PLANTDOC_IMAGE_MAX_DIMENSION, 10) || 1500;

app.set('trust proxy', 1);

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('יש להעלות קובץ תמונה בפורמט JPEG, PNG, WebP או GIF בלבד'));
    }
  }
});

// CORS for Capacitor (Android app) origins
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = ['https://localhost', 'capacitor://localhost', 'http://localhost'];
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '100kb' }));

// --- Rate limiting (configurable via env vars) ---
const RATE_LIMIT_WINDOW_MS = (parseInt(process.env.ANALYZE_RATE_WINDOW_MINUTES, 10) || 10) * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.ANALYZE_RATE_LIMIT, 10) || 10;
const requestLog = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestLog.set(ip, timestamps);
    return true;
  }
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return false;
}

function cleanOldRateLimitEntries() {
  const now = Date.now();
  for (const [ip, timestamps] of requestLog) {
    const fresh = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (fresh.length === 0) requestLog.delete(ip);
    else requestLog.set(ip, fresh);
  }
}

const MAX_CONCURRENT_JOBS = 3;
let activeJobs = 0;

const jobs = new Map();

function cleanOldJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.created > 5 * 60 * 1000) jobs.delete(id);
  }
}

// Validate that a buffer is a real decodable image (not just a renamed file).
async function validateImageBuffer(buffer) {
  try {
    const metadata = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
    if (!metadata || !metadata.width || !metadata.height) {
      return { valid: false, reason: 'לא ניתן לפענח את קובץ התמונה' };
    }
    return { valid: true, metadata };
  } catch (e) {
    return { valid: false, reason: 'הקובץ אינו תמונה תקינה או שהוא גדול מדי' };
  }
}

async function compressImage(buffer, mimetype, maxDim) {
  maxDim = maxDim || IMAGE_MAX_DIMENSION;
  const image = sharp(buffer, { limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();

  let processed = image;
  if (metadata.width > maxDim || metadata.height > maxDim) {
    processed = processed.resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });
  }

  const output = await processed.jpeg({ quality: 80 }).toBuffer();
  return { buffer: output, mimetype: 'image/jpeg', originalWidth: metadata.width, originalHeight: metadata.height };
}

app.post('/api/analyze', (req, res, next) => {
  if (isRateLimited(req.ip)) {
    return res.status(429).json({ error: 'יותר מדי בקשות. נסו שוב בעוד כמה דקות.' });
  }
  next();
}, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'לא הועלתה תמונה' });
    }

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
      return res.status(500).json({ error: 'מפתח API של Anthropic לא הוגדר' });
    }

    // Validate that the uploaded buffer is actually a decodable image
    const validation = await validateImageBuffer(req.file.buffer);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.reason });
    }

    if (activeJobs >= MAX_CONCURRENT_JOBS) {
      return res.status(429).json({ error: 'השרת עמוס כרגע. נסו שוב בעוד כמה רגעים.' });
    }

    cleanOldJobs();
    cleanOldRateLimitEntries();

    const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    jobs.set(jobId, { status: 'processing', created: Date.now() });

    console.log(`[${jobId}] [PERF] request-received: ${new Date().toISOString()}`);

    res.json({ jobId });

    activeJobs++;
    processImage(jobId, req.file.buffer, req.file.mimetype)
      .catch(err => {
        console.error(`[${jobId}] Unhandled processing error:`, err.message || err);
        jobs.set(jobId, { status: 'error', error: 'שגיאה לא צפויה. נסו שוב.', created: Date.now() });
      })
      .finally(() => {
        activeJobs--;
      });
  } catch (error) {
    console.error('Upload error:', error.message || error);
    res.status(500).json({ error: 'שגיאה בהעלאת התמונה' });
  }
});

// Visual-only cross-reference (PlantNet only, no Wikipedia) — fast path for Stage 1
function buildVisualCrossReference(jobId, claude, plantNet, plantNetAvailable, perf) {
  const wasIdentified = (claude?.status === 'success' || claude?.status === 'identified') && claude?.identification;
  if (!wasIdentified) {
    return { available: false, message: 'הצלבה עם מקורות חיצוניים לא זמינה', sources: [] };
  }

  maybePromoteAlternative(claude, plantNet);

  const tCross = performance.now();
  const crossReference = buildCrossReference(claude, plantNet, null, null, plantNetAvailable);
  claude.identification.confidenceLevel = confidenceLevelText(crossReference.combinedConfidence || claude.identification.confidence);
  perf.crossReference = performance.now() - tCross;

  applyToxicityVerification(claude, crossReference);
  console.log(`[${jobId}] [PERF] cross-reference (visual only): ${perf.crossReference.toFixed(0)}ms`);
  return crossReference;
}

// Full cross-reference including Wikipedia taxonomy verification
function finalizeCrossReference(jobId, claude, plantNet, plantNetAvailable, perf) {
  let crossReference = { available: false, message: 'הצלבה עם מקורות חיצוניים לא זמינה', sources: [] };
  const wasIdentified = (claude?.status === 'success' || claude?.status === 'identified') && claude?.identification;

  if (!wasIdentified) return crossReference;

  maybePromoteAlternative(claude, plantNet);

  const sciName = claude.identification.scientificName;
  const altName = claude.identification.alternativeMatches?.[0]?.scientificName;

  const wikiPromises = [];
  wikiPromises.push(
    Promise.race([
      verifyWithWikipedia(sciName),
      new Promise((_, reject) => setTimeout(() => reject(new Error('wiki-timeout')), 4000))
    ]).catch(() => null)
  );
  if (altName) {
    wikiPromises.push(
      Promise.race([
        verifyWithWikipedia(altName),
        new Promise((_, reject) => setTimeout(() => reject(new Error('wiki-timeout')), 4000))
      ]).catch(() => null)
    );
  } else {
    wikiPromises.push(Promise.resolve(null));
  }

  const tWiki = performance.now();
  return Promise.all(wikiPromises).then(([wikiResult, altWikiResult]) => {
    perf.wiki = performance.now() - tWiki;
    console.log(`[${jobId}] [PERF] wiki: ${(perf.wiki / 1000).toFixed(1)}s (primary: ${wikiResult?.verified ? 'verified' : 'not found'}, alt: ${altWikiResult?.verified ? 'verified' : altName ? 'not found' : 'skipped'})`);

    maybePromoteByWiki(claude, altName);

    const tCross = performance.now();
    crossReference = buildCrossReference(claude, plantNet, wikiResult, altWikiResult, plantNetAvailable);
    claude.identification.confidenceLevel = confidenceLevelText(crossReference.combinedConfidence || claude.identification.confidence);
    perf.crossReference = performance.now() - tCross;

    applyToxicityVerification(claude, crossReference);
    console.log(`[${jobId}] [PERF] cross-reference: ${perf.crossReference.toFixed(0)}ms`);
    return crossReference;
  });
}

async function processImage(jobId, fileBuffer, fileMimetype) {
  const t0 = performance.now();
  const perf = {};
  const useTwoStage = TWO_STAGE_ENABLED;
  const useOptimized = OPTIMIZED_PROMPT_ENABLED;

  console.log(`[${jobId}] [CONFIG] twoStage=${useTwoStage} optimizedPrompt=${useOptimized} imageMaxDimension=${IMAGE_MAX_DIMENSION} model=claude-sonnet-4-6`);

  try {
    // --- Image validation + compression ---
    const tImg = performance.now();
    const compressed = await compressImage(fileBuffer, fileMimetype);
    perf.imageProcessing = performance.now() - tImg;

    const origW = compressed.originalWidth;
    const origH = compressed.originalHeight;
    const maxDim = IMAGE_MAX_DIMENSION;
    let sentW = origW, sentH = origH;
    if (origW > maxDim || origH > maxDim) {
      const scale = Math.min(maxDim / origW, maxDim / origH);
      sentW = Math.round(origW * scale);
      sentH = Math.round(origH * scale);
    }
    const origSizeKB = Math.round(fileBuffer.length / 1024);
    const compSizeKB = Math.round(compressed.buffer.length / 1024);
    console.log(`[${jobId}] [IMAGE] width=${sentW} height=${sentH} compressedKB=${compSizeKB}`);
    console.log(`[${jobId}] [PERF] image-processing: ${perf.imageProcessing.toFixed(0)}ms (${origW}x${origH} → ${sentW}x${sentH}, ${compSizeKB}KB JPEG, original ${origSizeKB}KB, maxDim=${maxDim})`);

    const imageBase64 = compressed.buffer.toString('base64');
    const payloadSizeKB = Math.round(imageBase64.length / 1024);

    // --- Claude + PlantNet in parallel ---
    const tApi = performance.now();

    const claudeOptions = useTwoStage ? { stage1: true } : (useOptimized ? { optimized: true } : {});
    const claudePromise = analyzeWithClaude(imageBase64, compressed.mimetype, claudeOptions);
    const claudeTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Claude API timeout')), 180000)
    );

    const tasks = [Promise.race([claudePromise, claudeTimeout])];

    if (process.env.PLANTNET_API_KEY && process.env.PLANTNET_API_KEY !== 'your_plantnet_api_key_here') {
      tasks.push(identifyWithPlantNet(compressed.buffer));
    } else {
      tasks.push(Promise.resolve(null));
    }

    const [claudeResult, plantNetResult] = await Promise.allSettled(tasks);
    perf.claudeStage1 = performance.now() - tApi;
    console.log(`[${jobId}] [PERF] claude-${useTwoStage ? 'stage1' : 'full'}: ${(perf.claudeStage1 / 1000).toFixed(1)}s (model: claude-sonnet-4-6, payload: ~${payloadSizeKB}KB base64)`);
    console.log(`[${jobId}] [PERF] plantnet: ${plantNetResult.status === 'fulfilled' ? 'ok' : 'failed'} (ran in parallel with Claude)`);

    const claude = claudeResult.status === 'fulfilled' ? claudeResult.value : null;
    const plantNet = plantNetResult.status === 'fulfilled' ? plantNetResult.value : null;

    if (!claude) {
      const errMsg = claudeResult.reason?.message || 'שגיאה בניתוח התמונה';
      console.error(`[${jobId}] Claude failed:`, errMsg);
      perf.total = performance.now() - t0;
      console.log(`[${jobId}] [PERF] total: ${(perf.total / 1000).toFixed(1)}s (failed at Claude)`);
      jobs.set(jobId, { status: 'error', error: errMsg, created: Date.now() });
      return;
    }

    const wasIdentified = (claude?.status === 'success' || claude?.status === 'identified') && claude?.identification;
    console.log(`[${jobId}] Claude status: ${claude?.status}, identified: ${claude?.identification?.scientificName || 'n/a'}`);

    let plantNetAvailable = plantNetResult.status === 'fulfilled' && !!plantNet;

    // For non-success statuses (not_a_plant, insufficient_image), skip cross-reference & Stage 2
    if (!wasIdentified) {
      const crossReference = { available: false, message: 'הצלבה עם מקורות חיצוניים לא זמינה', sources: [] };
      perf.total = performance.now() - t0;
      console.log(`[${jobId}] [PERF] total: ${(perf.total / 1000).toFixed(1)}s (non-success: ${claude?.status})`);
      jobs.set(jobId, {
        status: 'done',
        phase: 'complete',
        created: Date.now(),
        imageBase64,
        imageMimetype: compressed.mimetype,
        result: { analysis: claude, plantNet, crossReference, timestamp: new Date().toISOString() }
      });
      return;
    }

    if (!useTwoStage) {
      // --- Single-stage path: full cross-reference including wiki ---
      const crossReference = await finalizeCrossReference(jobId, claude, plantNet, plantNetAvailable, perf);
      perf.total = performance.now() - t0;
      logPerfSummary(jobId, perf, 'single-stage');
      jobs.set(jobId, {
        status: 'done',
        phase: 'complete',
        created: Date.now(),
        imageBase64,
        imageMimetype: compressed.mimetype,
        result: { analysis: claude, plantNet, crossReference, timestamp: new Date().toISOString() }
      });
      return;
    }

    // --- Two-stage path: visual-only cross-reference (no wiki wait) ---
    const visualCrossRef = buildVisualCrossReference(jobId, claude, plantNet, plantNetAvailable, perf);

    perf.stage1Total = performance.now() - t0;
    console.log(`[${jobId}] [PERF] stage1-total: ${(perf.stage1Total / 1000).toFixed(1)}s — publishing partial result (wiki deferred to Stage 2)`);

    jobs.set(jobId, {
      status: 'partial',
      phase: 'stage1_complete',
      created: Date.now(),
      imageBase64,
      imageMimetype: compressed.mimetype,
      result: { analysis: claude, plantNet, crossReference: visualCrossRef, timestamp: new Date().toISOString() }
    });

    // --- Stage 2: wiki + enrichment in parallel (no image re-send) ---
    const tStage2 = performance.now();
    const plantNetSpeciesDisagreement = visualCrossRef?.matchLevel === 'genus' || (visualCrossRef?.matchLevel === 'none' && plantNetAvailable);
    try {
      const [enrichmentResult, fullCrossRef] = await Promise.allSettled([
        Promise.race([
          enrichWithClaude(claude, { plantNetSpeciesDisagreement }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Stage 2 enrichment timeout')), 60000))
        ]),
        finalizeCrossReference(jobId, claude, plantNet, plantNetAvailable, perf)
      ]);

      perf.stage2 = performance.now() - tStage2;
      console.log(`[${jobId}] [PERF] stage2 (enrichment + wiki): ${(perf.stage2 / 1000).toFixed(1)}s`);

      const crossReference = fullCrossRef.status === 'fulfilled' ? fullCrossRef.value : visualCrossRef;
      let mergedAnalysis = claude;
      if (enrichmentResult.status === 'fulfilled') {
        mergedAnalysis = mergeStage2IntoResult(claude, enrichmentResult.value);
      } else {
        console.error(`[${jobId}] Stage 2 enrichment failed:`, enrichmentResult.reason?.message);
      }

      perf.total = performance.now() - t0;
      logPerfSummary(jobId, perf, 'two-stage');

      const job = jobs.get(jobId);
      if (job) {
        jobs.set(jobId, {
          status: 'done',
          phase: enrichmentResult.status === 'fulfilled' ? 'stage2_complete' : 'stage2_failed',
          created: Date.now(),
          imageBase64,
          imageMimetype: compressed.mimetype,
          result: { analysis: mergedAnalysis, plantNet, crossReference, timestamp: new Date().toISOString() }
        });
      }
    } catch (stage2Err) {
      perf.stage2 = performance.now() - tStage2;
      perf.total = performance.now() - t0;
      console.error(`[${jobId}] Stage 2 failed after ${(perf.stage2 / 1000).toFixed(1)}s:`, stage2Err.message);
      logPerfSummary(jobId, perf, 'two-stage (stage2 failed)');

      // Stage 2 failure: promote partial to done — user keeps Stage 1 result
      const job = jobs.get(jobId);
      if (job && job.status === 'partial') {
        jobs.set(jobId, {
          ...job,
          status: 'done',
          phase: 'stage2_failed',
          created: Date.now()
        });
      }
    }
  } catch (error) {
    perf.total = performance.now() - t0;
    console.error(`[${jobId}] Processing error after ${(perf.total / 1000).toFixed(1)}s:`, error.message || error);
    jobs.set(jobId, { status: 'error', error: 'שגיאה בניתוח התמונה. נסו שוב.', created: Date.now() });
  }
}

function logPerfSummary(jobId, perf, mode) {
  console.log(`[${jobId}] [PERF] === SUMMARY (${mode}) ===`);
  console.log(`[${jobId}] [PERF] image-processing: ${perf.imageProcessing.toFixed(0)}ms`);
  console.log(`[${jobId}] [PERF] claude-stage1: ${(perf.claudeStage1 / 1000).toFixed(1)}s`);
  if (perf.stage2) console.log(`[${jobId}] [PERF] claude-stage2: ${(perf.stage2 / 1000).toFixed(1)}s`);
  console.log(`[${jobId}] [PERF] wiki: ${perf.wiki ? (perf.wiki / 1000).toFixed(1) + 's' : 'skipped'}`);
  console.log(`[${jobId}] [PERF] cross-reference: ${perf.crossReference ? perf.crossReference.toFixed(0) + 'ms' : 'skipped'}`);
  if (perf.stage1Total) console.log(`[${jobId}] [PERF] stage1-total: ${(perf.stage1Total / 1000).toFixed(1)}s`);
  console.log(`[${jobId}] [PERF] total: ${(perf.total / 1000).toFixed(1)}s`);
}

function maybePromoteAlternative(claude, plantNet) {
  if (!plantNet?.results?.length || !claude?.identification?.alternativeMatches?.length) return;

  const primaryName = claude.identification.scientificName?.toLowerCase().trim() || '';

  // If PlantNet top result already matches primary at species level, no promotion needed
  const pnTopName = plantNet.results[0]?.species?.scientificNameWithoutAuthor?.toLowerCase().trim() || '';
  if (pnTopName === primaryName) return;

  // Only promote on EXACT SPECIES match — genus-only agreement is NOT evidence
  for (let i = 0; i < claude.identification.alternativeMatches.length; i++) {
    const alt = claude.identification.alternativeMatches[i];
    const altName = alt.scientificName?.toLowerCase().trim() || '';

    for (const pnResult of plantNet.results.slice(0, 3)) {
      const pnName = pnResult.species?.scientificNameWithoutAuthor?.toLowerCase().trim() || '';

      if (pnName === altName) {
        console.log(`Promoting alternative "${alt.scientificName}" (exact species match with PlantNet) over primary "${claude.identification.scientificName}"`);
        const oldPrimary = { ...claude.identification };
        delete oldPrimary.alternativeMatches;
        claude.identification.commonNameHe = alt.commonNameHe || oldPrimary.commonNameHe;
        claude.identification.commonNameEn = alt.commonNameEn || oldPrimary.commonNameEn;
        claude.identification.scientificName = alt.scientificName;
        // Preserve the alternative's own confidence — never inherit higher from rejected primary
        claude.identification.confidence = alt.confidence || 0;
        claude.identification.description = alt.description || oldPrimary.description;
        claude.identification.alternativeMatches[i] = {
          scientificName: oldPrimary.scientificName,
          commonNameHe: oldPrimary.commonNameHe,
          commonNameEn: oldPrimary.commonNameEn,
          confidence: oldPrimary.confidence || 0,
          differentiatingFeature: alt.differentiatingFeature || ''
        };
        return;
      }
    }
  }
}

// Wikipedia/Wikidata verifies taxonomy (taxon name existence), NOT visual identification.
// It must NEVER promote an alternative identification over Claude's primary.
// This function is intentionally disabled — kept as a no-op for documentation.
function maybePromoteByWiki(claude, verifiedAltName) {
  // Disabled: Wikipedia verification is not visual evidence.
  // See PERFORMANCE_PHASE2_CHANGELOG.md for rationale.
}

app.get('/api/result/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.json({ status: 'not_found' });
  }
  if (job.status === 'processing') {
    return res.json({ status: 'processing' });
  }
  if (job.status === 'error') {
    jobs.delete(req.params.jobId);
    return res.json({ status: 'error', error: job.error });
  }
  if (job.status === 'partial') {
    const result = job.result;
    const hasFollowUp = Array.isArray(result.analysis?.followUpQuestions) && result.analysis.followUpQuestions.length > 0;
    const needsPhotos = !!(result.analysis?.needsMorePhotos || result.analysis?.suggestedPhotos?.length);
    const canFollowUpImage = needsPhotos && !job.followUpImageDone;
    return res.json({ status: 'partial', phase: job.phase || 'stage1_complete', jobId: req.params.jobId, canRefine: hasFollowUp && !job.refined, canFollowUpImage, ...result });
  }
  const result = job.result;
  const hasFollowUp = Array.isArray(result.analysis?.followUpQuestions) && result.analysis.followUpQuestions.length > 0;
  const needsPhotos = !!(result.analysis?.needsMorePhotos || result.analysis?.suggestedPhotos?.length);
  const canFollowUpImage = needsPhotos && !job.followUpImageDone;
  res.json({ status: 'done', phase: job.phase || 'complete', jobId: req.params.jobId, canRefine: hasFollowUp && !job.refined, canFollowUpImage, ...result });
});

function confidenceLevelText(conf) {
  const c = conf || 0;
  if (c >= 0.85) return 'רמת אמינות גבוהה מאוד';
  if (c >= 0.65) return 'רמת אמינות גבוהה';
  if (c >= 0.4) return 'רמת אמינות בינונית';
  return 'רמת אמינות נמוכה';
}

const DISAGREEMENT_WARNING = 'הזיהוי אינו ודאי — מומלץ לצלם תמונות נוספות.';

function buildCrossReference(claude, plantNet, wikiResult, altWikiResult, plantNetAvailable) {
  const claudeName = claude?.identification?.scientificName?.toLowerCase().trim() || '';
  const claudeGenus = claudeName.split(' ')[0];
  const claudeConf = claude?.identification?.confidence || 0;
  const hasSignificantAlternatives = (claude?.identification?.alternativeMatches || [])
    .some(a => (a.confidence || 0) >= claudeConf - 0.15);
  const imageQuality = claude?.imageQuality?.overall || 'good';

  const sources = [];
  let matchLevel = 'none';
  let plantNetTop = null;

  if (plantNet && plantNet.results && plantNet.results.length > 0) {
    plantNetTop = plantNet.results[0];
    for (const result of plantNet.results) {
      const pnName = result.species?.scientificNameWithoutAuthor?.toLowerCase().trim() || '';
      const pnGenus = pnName.split(' ')[0];
      if (pnName === claudeName) { matchLevel = 'species'; break; }
      if (pnGenus === claudeGenus && matchLevel === 'none') { matchLevel = 'genus'; }
    }

    const pnTopSci = plantNetTop?.species?.scientificNameWithoutAuthor || 'לא זוהה';
    let agreementNote = '';
    if (matchLevel === 'genus') {
      agreementNote = `PlantNet מזהה את אותו סוג (${claudeGenus}) אך מין שונה: ${pnTopSci}`;
    }

    sources.push({
      name: 'PlantNet',
      topResult: pnTopSci,
      score: plantNetTop?.score || 0,
      agrees: matchLevel === 'species',
      matchLevel,
      note: agreementNote || undefined
    });
  } else if (!plantNetAvailable) {
    sources.push({
      name: 'PlantNet',
      topResult: null,
      score: 0,
      agrees: false,
      matchLevel: 'unavailable',
      note: 'הצלבה עם PlantNet לא הייתה זמינה בסריקה זו.'
    });
  }

  if (wikiResult) {
    // Wikipedia verifies taxonomy (taxon existence), NOT visual identification.
    // It must NEVER count as "agrees" for confidence boosting.
    if (wikiResult.verified) {
      sources.push({
        name: 'ויקיפדיה',
        topResult: wikiResult.taxonName || wikiResult.englishName,
        hebrewName: wikiResult.hebrewName,
        score: 1,
        agrees: false,
        isTaxonomyOnly: true,
        note: 'השם המדעי אומת כ-taxon תקין בוויקיפדיה (אימות קיום השם, לא זיהוי התמונה).'
      });
    } else if (altWikiResult?.verified) {
      const altName = claude?.identification?.alternativeMatches?.[0];
      sources.push({
        name: 'ויקיפדיה',
        topResult: altWikiResult.taxonName || altWikiResult.englishName,
        hebrewName: altWikiResult.hebrewName,
        score: 0.7,
        agrees: false,
        isTaxonomyOnly: true,
        note: `השם "${claudeName}" לא נמצא בוויקיפדיה. "${altName?.scientificName || ''}" נמצא.`
      });
    } else {
      sources.push({
        name: 'ויקיפדיה',
        topResult: null,
        score: 0,
        agrees: false,
        isTaxonomyOnly: true,
        note: 'השם המדעי לא נמצא בוויקיפדיה'
      });
    }
  }

  // Only count visual identification sources (not taxonomy-only like Wikipedia)
  const visualSources = sources.filter(s => !s.isTaxonomyOnly && s.matchLevel !== 'unavailable');
  const agreeingSources = visualSources.filter(s => s.agrees).length;
  const totalSources = visualSources.length;

  let combinedConfidence;
  let agreementMessage;
  let disagreementWarning = null;

  if (totalSources === 0) {
    return {
      available: false,
      message: 'הצלבה עם מקורות חיצוניים לא זמינה',
      confidence: claudeConf,
      confidenceLevel: confidenceLevelText(claudeConf),
      sources
    };
  }

  if (agreeingSources === totalSources && totalSources >= 2) {
    combinedConfidence = Math.min(1, claudeConf * 1.15);
    agreementMessage = `כל ${totalSources} המקורות מסכימים על הזיהוי`;
  } else if (agreeingSources === totalSources) {
    combinedConfidence = Math.min(1, claudeConf * 1.05);
    agreementMessage = 'הזיהוי אומת מול מקור חיצוני';
  } else if (matchLevel === 'genus') {
    // Genus agreement but species disagreement — do NOT boost
    combinedConfidence = Math.min(claudeConf, 0.75);
    agreementMessage = 'המקורות מסכימים על הסוג (genus) אך חלוקים על המין (species)';
    disagreementWarning = DISAGREEMENT_WARNING;
  } else if (agreeingSources > 0) {
    combinedConfidence = claudeConf * 0.85;
    agreementMessage = 'חלק מהמקורות מסכימים עם הזיהוי';
    disagreementWarning = DISAGREEMENT_WARNING;
  } else {
    combinedConfidence = claudeConf * 0.5;
    agreementMessage = 'המקורות אינם מאשרים את הזיהוי';
    disagreementWarning = DISAGREEMENT_WARNING;
  }

  // Factor in significant alternatives and poor image quality
  if (hasSignificantAlternatives && combinedConfidence > 0.8) {
    combinedConfidence = Math.min(combinedConfidence, 0.8);
  }
  if (imageQuality === 'poor' && combinedConfidence > 0.6) {
    combinedConfidence = Math.min(combinedConfidence, 0.6);
  } else if (imageQuality === 'acceptable' && combinedConfidence > 0.85) {
    combinedConfidence = Math.min(combinedConfidence, 0.85);
  }

  combinedConfidence = Math.round(combinedConfidence * 100) / 100;

  return {
    available: true,
    matchLevel,
    combinedConfidence,
    confidenceLevel: confidenceLevelText(combinedConfidence),
    agreementMessage,
    disagreementWarning,
    sources,
    plantNetTopResult: plantNetTop ? {
      name: plantNetTop.species?.scientificNameWithoutAuthor,
      commonNames: plantNetTop.species?.commonNames?.slice(0, 3) || [],
      score: plantNetTop.score
    } : null
  };
}

// Ensure toxicity verification is conservative when identification is uncertain
function applyToxicityVerification(claude, crossReference) {
  if (!claude?.toxicity) return;

  const idConfidence = claude.identification?.confidence || 0;
  const combinedConfidence = crossReference?.combinedConfidence || idConfidence;
  const hasDisagreement = !!crossReference?.disagreementWarning;

  // If Claude already set verification, check if we need to downgrade
  const currentVerification = claude.toxicity.verification || 'unknown';

  if (combinedConfidence < 0.4 || currentVerification === 'unknown') {
    claude.toxicity.verification = 'unknown';
  } else if (combinedConfidence < 0.7 || hasDisagreement || currentVerification === 'uncertain') {
    claude.toxicity.verification = 'uncertain';
  }
  // If verified and confidence is high with no disagreement, keep "verified"
}

app.post('/api/refine-diagnosis', async (req, res) => {
  try {
    if (isRateLimited(req.ip)) {
      return res.status(429).json({ error: 'יותר מדי בקשות. נסו שוב בעוד כמה דקות.' });
    }

    const { jobId, answers } = req.body;
    if (!jobId || !answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: 'נתונים חסרים לעדכון האבחנה' });
    }

    if (answers.length === 0) {
      return res.status(400).json({ error: 'לא נשלחו תשובות' });
    }

    if (answers.length > 4) {
      return res.status(400).json({ error: 'מספר תשובות חורג מהמותר' });
    }

    const job = jobs.get(jobId);
    if (!job || job.status !== 'done') {
      return res.status(404).json({ error: 'הניתוח המקורי לא נמצא או שפג תוקפו. נסו סריקה חדשה.' });
    }

    if (job.refined) {
      return res.status(400).json({ error: 'כבר בוצע עדכון אבחנה לסריקה זו.' });
    }

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
      return res.status(500).json({ error: 'מפתח API של Anthropic לא הוגדר' });
    }

    const originalAnalysis = job.result?.analysis;
    if (!originalAnalysis) {
      return res.status(400).json({ error: 'אין נתוני ניתוח מקוריים' });
    }

    const startTime = Date.now();
    console.log(`[refine:${jobId}] Starting refinement with ${answers.length} answers`);

    const refinePromise = refineWithClaude(
      originalAnalysis,
      answers,
      job.imageBase64 || null,
      job.imageMimetype || null
    );
    const refineTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Claude API timeout')), 180000)
    );

    const refinement = await Promise.race([refinePromise, refineTimeout]);
    const duration = Date.now() - startTime;
    console.log(`[refine:${jobId}] Done in ${duration}ms, changed: ${refinement.diagnosisChanged}`);

    job.refined = true;
    job.refinementResult = refinement;
    job.created = Date.now();

    res.json({ status: 'ok', refinement });
  } catch (error) {
    console.error('Refinement error:', error.message || error);
    res.status(500).json({ error: error.message || 'שגיאה בעדכון האבחנה. נסו שוב.' });
  }
});

app.post('/api/analyze-followup-image', (req, res, next) => {
  if (isRateLimited(req.ip)) {
    return res.status(429).json({ error: 'יותר מדי בקשות. נסו שוב בעוד כמה דקות.' });
  }
  next();
}, upload.single('image'), async (req, res) => {
  try {
    const jobId = req.body.jobId;
    if (!jobId) {
      return res.status(400).json({ error: 'חסר מזהה סריקה' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'לא הועלתה תמונה' });
    }

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
      return res.status(500).json({ error: 'מפתח API של Anthropic לא הוגדר' });
    }

    const job = jobs.get(jobId);
    if (!job || job.status !== 'done') {
      return res.status(404).json({ error: 'הניתוח המקורי לא נמצא או שפג תוקפו. נסו סריקה חדשה.' });
    }

    if (job.followUpImageDone) {
      return res.status(400).json({ error: 'כבר הועלה צילום נוסף לסריקה זו.' });
    }

    const validation = await validateImageBuffer(req.file.buffer);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.reason });
    }

    const compressed = await compressImage(req.file.buffer, req.file.mimetype);
    const newImageBase64 = compressed.buffer.toString('base64');

    const originalAnalysis = job.result?.analysis;
    if (!originalAnalysis) {
      return res.status(400).json({ error: 'אין נתוני ניתוח מקוריים' });
    }

    const startTime = Date.now();
    console.log(`[followup:${jobId}] Starting follow-up image analysis...`);

    const followUpPromise = analyzeFollowUpImage(
      originalAnalysis,
      job.refinementResult || null,
      null,
      newImageBase64,
      compressed.mimetype,
      job.imageBase64 || null,
      job.imageMimetype || null
    );
    const followUpTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Claude API timeout')), 180000)
    );

    const followUpResult = await Promise.race([followUpPromise, followUpTimeout]);
    const duration = Date.now() - startTime;
    console.log(`[followup:${jobId}] Done in ${duration}ms, changed: ${followUpResult.diagnosisChanged}, plantChanged: ${followUpResult.plantIdentificationChanged}`);

    job.followUpImageDone = true;
    job.created = Date.now();

    res.json({ status: 'ok', followUpResult });
  } catch (error) {
    console.error('Follow-up image error:', error.message || error);
    res.status(500).json({ error: error.message || 'שגיאה בניתוח הצילום הנוסף. נסו שוב.' });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'הקובץ גדול מדי. הגודל המרבי הוא 15MB' });
    }
    return res.status(400).json({ error: 'שגיאה בהעלאת הקובץ' });
  }
  if (err.message && err.message.startsWith('יש להעלות קובץ תמונה')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'שגיאה בשרת. נסו שוב מאוחר יותר.' });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    anthropicKey: !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here',
    plantNetKey: !!process.env.PLANTNET_API_KEY && process.env.PLANTNET_API_KEY !== 'your_plantnet_api_key_here'
  });
});

app.listen(PORT, () => {
  console.log(`Plant Identifier running at http://localhost:${PORT}`);
  console.log(`Anthropic API: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'MISSING'}`);
  console.log(`PlantNet API: ${process.env.PLANTNET_API_KEY ? 'configured' : 'not configured (optional)'}`);
  console.log(`Rate limit: ${RATE_LIMIT_MAX_REQUESTS} requests per ${RATE_LIMIT_WINDOW_MS / 60000} minutes`);
});
