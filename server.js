require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const { analyzeWithClaude, refineWithClaude, analyzeFollowUpImage } = require('./services/claude-vision');
const { identifyWithPlantNet } = require('./services/plantnet');
const { verifyWithWikipedia } = require('./services/wiki-verify');

const app = express();
const PORT = process.env.PORT || 3000;

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

async function compressImage(buffer, mimetype) {
  const image = sharp(buffer, { limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();

  let processed = image;
  const maxDim = 1500;
  if (metadata.width > maxDim || metadata.height > maxDim) {
    processed = processed.resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });
  }

  const output = await processed.jpeg({ quality: 80 }).toBuffer();
  return { buffer: output, mimetype: 'image/jpeg' };
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

async function processImage(jobId, fileBuffer, fileMimetype) {
  const startTime = Date.now();
  try {
    console.log(`[${jobId}] Starting image processing...`);
    const compressed = await compressImage(fileBuffer, fileMimetype);
    console.log(`[${jobId}] Image compressed to ${Math.round(compressed.buffer.length / 1024)}KB`);
    const imageBase64 = compressed.buffer.toString('base64');

    // Claude API call with 180s timeout safety net
    const claudePromise = analyzeWithClaude(imageBase64, compressed.mimetype);
    const claudeTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Claude API timeout')), 180000)
    );

    const tasks = [Promise.race([claudePromise, claudeTimeout])];

    if (process.env.PLANTNET_API_KEY && process.env.PLANTNET_API_KEY !== 'your_plantnet_api_key_here') {
      tasks.push(identifyWithPlantNet(compressed.buffer));
    } else {
      tasks.push(Promise.resolve(null));
    }

    console.log(`[${jobId}] Calling Claude API + PlantNet...`);
    const [claudeResult, plantNetResult] = await Promise.allSettled(tasks);

    const claudeDuration = Date.now() - startTime;
    console.log(`[${jobId}] Claude: ${claudeResult.status} (${claudeDuration}ms), PlantNet: ${plantNetResult.status}`);

    const claude = claudeResult.status === 'fulfilled' ? claudeResult.value : null;
    const plantNet = plantNetResult.status === 'fulfilled' ? plantNetResult.value : null;

    if (!claude) {
      const errMsg = claudeResult.reason?.message || 'שגיאה בניתוח התמונה';
      console.error(`[${jobId}] Claude failed:`, errMsg);
      jobs.set(jobId, { status: 'error', error: errMsg, created: Date.now() });
      return;
    }

    // "success" is the new status; "identified" kept for backward compat
    const wasIdentified = (claude?.status === 'success' || claude?.status === 'identified') && claude?.identification;
    console.log(`[${jobId}] Claude status: ${claude?.status}, identified: ${claude?.identification?.scientificName || 'n/a'}`);

    let crossReference = { available: false, message: 'הצלבה עם מקורות חיצוניים לא זמינה', sources: [] };
    let plantNetAvailable = true;

    if (plantNetResult.status !== 'fulfilled' || !plantNet) {
      plantNetAvailable = false;
    }

    if (wasIdentified) {
      maybePromoteAlternative(claude, plantNet);

      const sciName = claude.identification.scientificName;
      let wikiResult = null;
      let altWikiResult = null;
      try {
        wikiResult = await Promise.race([
          verifyWithWikipedia(sciName),
          new Promise((_, reject) => setTimeout(() => reject(), 6000))
        ]);
        if (wikiResult && !wikiResult.verified && claude.identification.alternativeMatches?.length > 0) {
          const altName = claude.identification.alternativeMatches[0].scientificName;
          altWikiResult = await Promise.race([
            verifyWithWikipedia(altName),
            new Promise((_, reject) => setTimeout(() => reject(), 6000))
          ]);
          if (altWikiResult?.verified) {
            maybePromoteByWiki(claude, altName);
          }
        }
      } catch(e) {}

      crossReference = buildCrossReference(claude, plantNet, wikiResult, altWikiResult, plantNetAvailable);
      claude.identification.confidenceLevel = confidenceLevelText(crossReference.combinedConfidence || claude.identification.confidence);

      // Override toxicity verification when identification is uncertain
      applyToxicityVerification(claude, crossReference);
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[${jobId}] Done in ${totalDuration}ms, cross-ref match: ${crossReference.matchLevel || 'n/a'}`);

    jobs.set(jobId, {
      status: 'done',
      created: Date.now(),
      imageBase64,
      imageMimetype: compressed.mimetype,
      result: {
        analysis: claude,
        plantNet,
        crossReference,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.error(`[${jobId}] Processing error after ${totalDuration}ms:`, error.message || error);
    jobs.set(jobId, { status: 'error', error: 'שגיאה בניתוח התמונה. נסו שוב.', created: Date.now() });
  }
}

function maybePromoteAlternative(claude, plantNet) {
  if (!plantNet?.results?.length || !claude?.identification?.alternativeMatches?.length) return;

  const primaryName = claude.identification.scientificName?.toLowerCase().trim() || '';
  const primaryGenus = primaryName.split(' ')[0];

  const pnTopName = plantNet.results[0]?.species?.scientificNameWithoutAuthor?.toLowerCase().trim() || '';
  const pnTopGenus = pnTopName.split(' ')[0];

  if (pnTopName === primaryName || pnTopGenus === primaryGenus) return;

  for (let i = 0; i < claude.identification.alternativeMatches.length; i++) {
    const alt = claude.identification.alternativeMatches[i];
    const altName = alt.scientificName?.toLowerCase().trim() || '';
    const altGenus = altName.split(' ')[0];

    for (const pnResult of plantNet.results.slice(0, 3)) {
      const pnName = pnResult.species?.scientificNameWithoutAuthor?.toLowerCase().trim() || '';
      const pnGenus = pnName.split(' ')[0];

      if (pnName === altName || pnGenus === altGenus) {
        console.log(`Promoting alternative "${alt.scientificName}" (matched PlantNet) over primary "${claude.identification.scientificName}"`);
        const oldPrimary = { ...claude.identification };
        delete oldPrimary.alternativeMatches;
        claude.identification.commonNameHe = alt.commonNameHe || oldPrimary.commonNameHe;
        claude.identification.commonNameEn = alt.commonNameEn || oldPrimary.commonNameEn;
        claude.identification.scientificName = alt.scientificName;
        claude.identification.confidence = Math.max(alt.confidence || 0, oldPrimary.confidence || 0);
        claude.identification.description = alt.description || oldPrimary.description;
        claude.identification.alternativeMatches[i] = {
          scientificName: oldPrimary.scientificName,
          commonNameHe: oldPrimary.commonNameHe,
          commonNameEn: oldPrimary.commonNameEn,
          confidence: oldPrimary.confidence * 0.8,
          differentiatingFeature: alt.differentiatingFeature || ''
        };
        return;
      }
    }
  }
}

function maybePromoteByWiki(claude, verifiedAltName) {
  if (!claude?.identification?.alternativeMatches?.length) return;
  const altIdx = claude.identification.alternativeMatches.findIndex(
    a => a.scientificName?.toLowerCase().trim() === verifiedAltName?.toLowerCase().trim()
  );
  if (altIdx === -1) return;

  const alt = claude.identification.alternativeMatches[altIdx];
  console.log(`Promoting alternative "${alt.scientificName}" (verified by Wikipedia) over primary "${claude.identification.scientificName}"`);

  const oldPrimary = { ...claude.identification };
  delete oldPrimary.alternativeMatches;
  claude.identification.commonNameHe = alt.commonNameHe || oldPrimary.commonNameHe;
  claude.identification.commonNameEn = alt.commonNameEn || oldPrimary.commonNameEn;
  claude.identification.scientificName = alt.scientificName;
  claude.identification.confidence = Math.max(alt.confidence || 0, oldPrimary.confidence || 0);
  claude.identification.alternativeMatches[altIdx] = {
    scientificName: oldPrimary.scientificName,
    commonNameHe: oldPrimary.commonNameHe,
    commonNameEn: oldPrimary.commonNameEn,
    confidence: oldPrimary.confidence * 0.8,
    differentiatingFeature: alt.differentiatingFeature || ''
  };
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
  const result = job.result;
  const hasFollowUp = Array.isArray(result.analysis?.followUpQuestions) && result.analysis.followUpQuestions.length > 0;
  const needsPhotos = !!(result.analysis?.needsMorePhotos || result.analysis?.suggestedPhotos?.length);
  const canFollowUpImage = needsPhotos && !job.followUpImageDone;
  res.json({ status: 'done', jobId: req.params.jobId, canRefine: hasFollowUp && !job.refined, canFollowUpImage, ...result });
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
    if (wikiResult.verified) {
      sources.push({
        name: 'ויקיפדיה',
        topResult: wikiResult.taxonName || wikiResult.englishName,
        hebrewName: wikiResult.hebrewName,
        score: 1,
        agrees: true,
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
        note: `השם "${claudeName}" לא נמצא. ייתכן ש-"${altName?.scientificName}" מדויק יותר.`
      });
    } else {
      sources.push({
        name: 'ויקיפדיה',
        topResult: null,
        score: 0,
        agrees: false,
        note: 'השם המדעי לא נמצא בוויקיפדיה'
      });
    }
  }

  const agreeingSources = sources.filter(s => s.agrees).length;
  const totalSources = sources.filter(s => s.matchLevel !== 'unavailable').length;

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
