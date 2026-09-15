require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const { analyzeWithClaude } = require('./services/claude-vision');
const { identifyWithPlantNet } = require('./services/plantnet');

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
      const errMsg = claudeResult.reason?.message || 'שגיאה בניתוח התמונה';
      return res.status(500).json({ error: errMsg });
    }

    const crossReference = buildCrossReference(claude, plantNet);

    res.json({
      analysis: claude,
      plantNet,
      crossReference,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'שגיאה בניתוח התמונה. נסו שוב.' });
  }
});

function buildCrossReference(claude, plantNet) {
  if (!plantNet || !plantNet.results || plantNet.results.length === 0) {
    return {
      available: false,
      message: 'הצלבה עם PlantNet לא זמינה',
      confidence: claude?.identification?.confidence || null
    };
  }

  const claudeName = claude?.identification?.scientificName?.toLowerCase().trim() || '';
  const claudeGenus = claudeName.split(' ')[0];

  let bestMatch = null;
  let matchLevel = 'none';

  for (const result of plantNet.results) {
    const pnName = result.species?.scientificNameWithoutAuthor?.toLowerCase().trim() || '';
    const pnGenus = pnName.split(' ')[0];

    if (pnName === claudeName) {
      bestMatch = result;
      matchLevel = 'species';
      break;
    }
    if (pnGenus === claudeGenus && !bestMatch) {
      bestMatch = result;
      matchLevel = 'genus';
    }
  }

  const plantNetTop = plantNet.results[0];
  const plantNetScore = plantNetTop?.score || 0;
  const claudeConf = claude?.identification?.confidence || 0;

  let combinedConfidence;
  let agreementMessage;

  if (matchLevel === 'species') {
    combinedConfidence = Math.min(1, (claudeConf + plantNetScore) / 1.5);
    agreementMessage = 'שתי המערכות מסכימות על הזיהוי — רמת ודאות גבוהה';
  } else if (matchLevel === 'genus') {
    combinedConfidence = Math.min(1, (claudeConf + plantNetScore) / 2);
    agreementMessage = 'המערכות מסכימות על הסוג (Genus) אך לא על המין המדויק';
  } else {
    combinedConfidence = Math.max(claudeConf, plantNetScore) * 0.7;
    agreementMessage = 'המערכות חלוקות — מומלץ לצלם מזווית נוספת או להתייעץ עם מומחה';
  }

  return {
    available: true,
    matchLevel,
    combinedConfidence: Math.round(combinedConfidence * 100) / 100,
    agreementMessage,
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
