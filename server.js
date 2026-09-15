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

async function compressImage(buffer, mimetype) {
  const image = sharp(buffer);
  const metadata = await image.metadata();

  let processed = image;
  const maxDim = 2048;
  if (metadata.width > maxDim || metadata.height > maxDim) {
    processed = processed.resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });
  }

  const output = await processed.jpeg({ quality: 85 }).toBuffer();
  return { buffer: output, mimetype: 'image/jpeg' };
}

app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'לא הועלתה תמונה' });
    }

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
      return res.status(500).json({ error: 'מפתח API של Anthropic לא הוגדר. יש לעדכן את קובץ .env' });
    }

    // Use SSE to keep connection alive on Render free tier (30s timeout)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Send heartbeats every 10s to prevent timeout
    const heartbeat = setInterval(() => {
      res.write('event: heartbeat\ndata: {}\n\n');
    }, 10000);

    const compressed = await compressImage(req.file.buffer, req.file.mimetype);
    const imageBase64 = compressed.buffer.toString('base64');

    const tasks = [analyzeWithClaude(imageBase64, compressed.mimetype)];

    if (process.env.PLANTNET_API_KEY && process.env.PLANTNET_API_KEY !== 'your_plantnet_api_key_here') {
      tasks.push(identifyWithPlantNet(compressed.buffer));
    } else {
      tasks.push(Promise.resolve(null));
    }

    const [claudeResult, plantNetResult] = await Promise.allSettled(tasks);

    const claude = claudeResult.status === 'fulfilled' ? claudeResult.value : null;
    const plantNet = plantNetResult.status === 'fulfilled' ? plantNetResult.value : null;

    if (!claude) {
      clearInterval(heartbeat);
      const errMsg = claudeResult.reason?.message || 'שגיאה בניתוח התמונה';
      res.write(`event: error\ndata: ${JSON.stringify({ error: errMsg })}\n\n`);
      res.end();
      return;
    }

    // Verify identification with Wikipedia/Wikidata
    const sciName = claude?.identification?.scientificName;
    const wikiResult = await verifyWithWikipedia(sciName).catch(() => null);

    // Also verify top alternative if main ID not found in Wikipedia
    let altWikiResult = null;
    if (wikiResult && !wikiResult.verified && claude?.identification?.alternativeMatches?.length > 0) {
      const altName = claude.identification.alternativeMatches[0].scientificName;
      altWikiResult = await verifyWithWikipedia(altName).catch(() => null);
    }

    clearInterval(heartbeat);

    const crossReference = buildCrossReference(claude, plantNet, wikiResult, altWikiResult);

    const result = {
      analysis: claude,
      plantNet,
      crossReference,
      timestamp: new Date().toISOString()
    };

    res.write(`event: result\ndata: ${JSON.stringify(result)}\n\n`);
    res.end();
  } catch (error) {
    console.error('Analysis error:', error);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'שגיאה בניתוח התמונה. נסו שוב.' })}\n\n`);
    res.end();
  }
});

function buildCrossReference(claude, plantNet, wikiResult, altWikiResult) {
  const claudeName = claude?.identification?.scientificName?.toLowerCase().trim() || '';
  const claudeGenus = claudeName.split(' ')[0];
  const claudeConf = claude?.identification?.confidence || 0;

  const sources = [];
  let matchLevel = 'none';
  let plantNetTop = null;

  // PlantNet cross-reference
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

  // Wikipedia/Wikidata verification
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
        note: `השם "${claudeName}" לא נמצא בוויקיפדיה. ייתכן שהזיהוי החלופי "${altName?.scientificName}" מדויק יותר.`
      });
    } else {
      sources.push({
        name: 'ויקיפדיה',
        topResult: null,
        score: 0,
        agrees: false,
        note: 'השם המדעי לא נמצא בוויקיפדיה — ייתכן שהזיהוי לא מדויק'
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
    agreementMessage = `כל ${totalSources} המקורות מסכימים על הזיהוי — רמת ודאות גבוהה מאוד`;
  } else if (agreeingSources === totalSources) {
    combinedConfidence = Math.min(1, claudeConf * 1.1);
    agreementMessage = 'הזיהוי אומת מול מקור חיצוני';
  } else if (agreeingSources > 0) {
    combinedConfidence = claudeConf * 0.85;
    agreementMessage = 'חלק מהמקורות מסכימים — מומלץ לצלם מזווית נוספת לדיוק';
  } else {
    combinedConfidence = claudeConf * 0.5;
    agreementMessage = 'המקורות החיצוניים לא מאשרים את הזיהוי — מומלץ לבדוק שוב או להתייעץ עם מומחה';
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
