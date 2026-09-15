require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const { analyzeWithClaude } = require('./services/claude-vision');
const { identifyWithPlantNet } = require('./services/plantnet');
const { verifyWithWikipedia } = require('./services/wiki-verify');

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('יש להעלות קובץ תמונה בלבד'));
    }
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// In-memory job store (jobs expire after 5 minutes)
const jobs = new Map();

function cleanOldJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.created > 5 * 60 * 1000) jobs.delete(id);
  }
}

async function compressImage(buffer, mimetype) {
  const image = sharp(buffer);
  const metadata = await image.metadata();

  let processed = image;
  const maxDim = 1500;
  if (metadata.width > maxDim || metadata.height > maxDim) {
    processed = processed.resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });
  }

  const output = await processed.jpeg({ quality: 80 }).toBuffer();
  return { buffer: output, mimetype: 'image/jpeg' };
}

// Step 1: Upload image, start analysis, return job ID immediately
app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'לא הועלתה תמונה' });
    }

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
      return res.status(500).json({ error: 'מפתח API של Anthropic לא הוגדר' });
    }

    cleanOldJobs();

    const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    jobs.set(jobId, { status: 'processing', created: Date.now() });

    // Return job ID immediately (within 1-2 seconds)
    res.json({ jobId });

    // Process in background (with safety catch)
    processImage(jobId, req.file.buffer, req.file.mimetype).catch(err => {
      console.error('Unhandled processing error:', err);
      jobs.set(jobId, { status: 'error', error: 'שגיאה לא צפויה. נסו שוב.', created: Date.now() });
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'שגיאה בהעלאת התמונה' });
  }
});

async function processImage(jobId, fileBuffer, fileMimetype) {
  try {
    console.log(`[${jobId}] Starting image processing...`);
    const compressed = await compressImage(fileBuffer, fileMimetype);
    console.log(`[${jobId}] Image compressed to ${Math.round(compressed.buffer.length / 1024)}KB`);
    const imageBase64 = compressed.buffer.toString('base64');

    // Claude API call with 60s timeout
    const claudePromise = analyzeWithClaude(imageBase64, compressed.mimetype);
    const claudeTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Claude API timeout (60s)')), 60000)
    );

    const tasks = [Promise.race([claudePromise, claudeTimeout])];

    if (process.env.PLANTNET_API_KEY && process.env.PLANTNET_API_KEY !== 'your_plantnet_api_key_here') {
      tasks.push(identifyWithPlantNet(compressed.buffer));
    } else {
      tasks.push(Promise.resolve(null));
    }

    console.log(`[${jobId}] Calling Claude API...`);
    const [claudeResult, plantNetResult] = await Promise.allSettled(tasks);
    console.log(`[${jobId}] Claude: ${claudeResult.status}, PlantNet: ${plantNetResult.status}`);

    const claude = claudeResult.status === 'fulfilled' ? claudeResult.value : null;
    const plantNet = plantNetResult.status === 'fulfilled' ? plantNetResult.value : null;

    if (!claude) {
      const errMsg = claudeResult.reason?.message || 'שגיאה בניתוח התמונה';
      console.error(`[${jobId}] Claude failed:`, errMsg);
      jobs.set(jobId, { status: 'error', error: errMsg, created: Date.now() });
      return;
    }
    console.log(`[${jobId}] Claude identified: ${claude?.identification?.scientificName}`);

    // Wikipedia verification (non-blocking, with timeout)
    const sciName = claude?.identification?.scientificName;
    let wikiResult = null;
    let altWikiResult = null;
    try {
      wikiResult = await Promise.race([
        verifyWithWikipedia(sciName),
        new Promise((_, reject) => setTimeout(() => reject(), 6000))
      ]);
      if (wikiResult && !wikiResult.verified && claude?.identification?.alternativeMatches?.length > 0) {
        const altName = claude.identification.alternativeMatches[0].scientificName;
        altWikiResult = await Promise.race([
          verifyWithWikipedia(altName),
          new Promise((_, reject) => setTimeout(() => reject(), 6000))
        ]);
      }
    } catch(e) {}

    const crossReference = buildCrossReference(claude, plantNet, wikiResult, altWikiResult);

    jobs.set(jobId, {
      status: 'done',
      created: Date.now(),
      result: {
        analysis: claude,
        plantNet,
        crossReference,
        timestamp: new Date().toISOString()
      }
    });
    console.log(`[${jobId}] Done!`);
  } catch (error) {
    console.error(`[${jobId}] Processing error:`, error.message || error);
    jobs.set(jobId, { status: 'error', error: 'שגיאה בניתוח התמונה. נסו שוב.', created: Date.now() });
  }
}

// Step 2: Poll for results (fast response, no timeout issues)
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
  // Done
  const result = job.result;
  jobs.delete(req.params.jobId);
  res.json({ status: 'done', ...result });
});

function buildCrossReference(claude, plantNet, wikiResult, altWikiResult) {
  const claudeName = claude?.identification?.scientificName?.toLowerCase().trim() || '';
  const claudeGenus = claudeName.split(' ')[0];
  const claudeConf = claude?.identification?.confidence || 0;

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
    sources.push({
      name: 'PlantNet',
      topResult: plantNetTop?.species?.scientificNameWithoutAuthor || 'לא זוהה',
      score: plantNetTop?.score || 0,
      agrees: matchLevel !== 'none'
    });
  }

  if (wikiResult) {
    if (wikiResult.verified) {
      sources.push({
        name: 'ויקיפדיה',
        topResult: wikiResult.taxonName || wikiResult.englishName,
        hebrewName: wikiResult.hebrewName,
        score: 1,
        agrees: true
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
  const totalSources = sources.length;

  let combinedConfidence;
  let agreementMessage;

  if (totalSources === 0) {
    return {
      available: false,
      message: 'הצלבה עם מקורות חיצוניים לא זמינה',
      confidence: claudeConf,
      sources: []
    };
  }

  if (agreeingSources === totalSources && totalSources >= 2) {
    combinedConfidence = Math.min(1, claudeConf * 1.2);
    agreementMessage = `כל ${totalSources} המקורות מסכימים — רמת ודאות גבוהה מאוד`;
  } else if (agreeingSources === totalSources) {
    combinedConfidence = Math.min(1, claudeConf * 1.1);
    agreementMessage = 'הזיהוי אומת מול מקור חיצוני';
  } else if (agreeingSources > 0) {
    combinedConfidence = claudeConf * 0.85;
    agreementMessage = 'חלק מהמקורות מסכימים — מומלץ לצלם מזווית נוספת';
  } else {
    combinedConfidence = claudeConf * 0.5;
    agreementMessage = 'המקורות לא מאשרים — מומלץ לבדוק שוב או להתייעץ עם מומחה';
  }

  return {
    available: true,
    matchLevel,
    combinedConfidence: Math.round(combinedConfidence * 100) / 100,
    agreementMessage,
    sources,
    plantNetTopResult: plantNetTop ? {
      name: plantNetTop.species?.scientificNameWithoutAuthor,
      commonNames: plantNetTop.species?.commonNames?.slice(0, 3) || [],
      score: plantNetTop.score
    } : null
  };
}

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'הקובץ גדול מדי. הגודל המרבי הוא 15MB' });
    }
    return res.status(400).json({ error: 'שגיאה בהעלאת הקובץ: ' + err.message });
  }
  if (err.message === 'יש להעלות קובץ תמונה בלבד') {
    return res.status(400).json({ error: err.message });
  }
  next(err);
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
});
