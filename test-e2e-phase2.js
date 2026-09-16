/**
 * End-to-end test for Phase 2 two-stage pipeline.
 * Tests both two-stage and single-stage (fallback) modes.
 *
 * Usage: node test-e2e-phase2.js [mode]
 *   mode: 'two-stage' or 'single-stage' (default: 'two-stage')
 *
 * Requires the server to be running with appropriate env vars.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const MODE = process.argv[2] || 'two-stage';

const testImages = [
  { file: 'test-images/1-healthy-monstera.jpg', description: 'Healthy Monstera plant' },
  { file: 'test-images/2-aphids.jpg', description: 'Plant with possible pest issues' },
  { file: 'test-images/3-succulent.jpg', description: 'Succulent plant' },
  { file: 'test-images/4-rose.jpg', description: 'Rose flower' },
  { file: 'test-images/5-fern.jpg', description: 'Fern plant' },
];

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOpts = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function buildMultipart(filePath) {
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const fileData = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const header = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fileName}"\r\nContent-Type: image/jpeg\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([Buffer.from(header), fileData, Buffer.from(footer)]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function pollResult(jobId, maxWaitSec = 300) {
  const startPoll = performance.now();
  let stage1Time = null;
  let stage1Data = null;
  let attempts = 0;

  while (true) {
    attempts++;
    const elapsed = (performance.now() - startPoll) / 1000;
    if (elapsed > maxWaitSec) throw new Error(`Timeout after ${maxWaitSec}s`);

    const res = await httpRequest(`${BASE_URL}/api/result/${jobId}`);
    const d = res.data;

    if (d.status === 'partial' && !stage1Time) {
      stage1Time = elapsed;
      stage1Data = JSON.parse(JSON.stringify(d));
      console.log(`  Stage 1 received at ${stage1Time.toFixed(1)}s`);
    }
    if (d.status === 'done') {
      return {
        stage1Time,
        stage1Data,
        totalTime: elapsed,
        finalData: d,
        pollAttempts: attempts,
      };
    }
    if (d.status === 'error') {
      throw new Error(`Analysis error: ${d.error}`);
    }
    if (d.status === 'not_found') {
      throw new Error('Job not found');
    }

    await new Promise(r => setTimeout(r, 1500));
  }
}

async function runTest(imageInfo) {
  const filePath = path.resolve(imageInfo.file);
  if (!fs.existsSync(filePath)) {
    console.log(`  SKIP: ${filePath} not found`);
    return null;
  }

  const { body, contentType } = buildMultipart(filePath);

  const t0 = performance.now();
  const uploadRes = await httpRequest(`${BASE_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'Content-Length': body.length },
    body,
  });

  if (uploadRes.status !== 200 || !uploadRes.data.jobId) {
    console.log(`  UPLOAD FAILED: ${uploadRes.status} ${JSON.stringify(uploadRes.data)}`);
    return null;
  }

  const jobId = uploadRes.data.jobId;
  console.log(`  jobId: ${jobId}, upload took ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  const result = await pollResult(jobId);
  return result;
}

function extractResultSummary(data) {
  if (!data) return {};
  const a = data.analysis || {};
  return {
    status: a.status,
    scientificName: a.identification?.scientificName,
    commonNameHe: a.identification?.commonNameHe,
    confidence: a.identification?.confidence,
    confidenceLevel: a.identification?.confidenceLevel,
    health: a.healthAssessment?.overallHealth,
    healthScore: a.healthAssessment?.healthScore,
    issueCount: (a.issues || []).length,
    issueNames: (a.issues || []).map(i => i.name),
    hasCare: !!a.careRecommendations,
    hasSeasonal: !!a.seasonalCare,
    hasFunFacts: !!(a.funFacts?.length),
    toxVerification: a.toxicity?.verification,
    toxPets: a.toxicity?.forPets?.toxic,
    toxHumans: a.toxicity?.forHumans?.toxic,
    followUpQs: (a.followUpQuestions || []).length,
    phase: data.phase,
    crossRefMatch: data.crossReference?.matchLevel,
    crossRefConfidence: data.crossReference?.combinedConfidence,
    plantNetTop: data.crossReference?.plantNetTopResult?.name,
  };
}

async function main() {
  console.log(`\n=== PlantDoc Phase 2 E2E Test (${MODE} mode) ===\n`);
  console.log(`Server: ${BASE_URL}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  const results = [];

  for (let i = 0; i < testImages.length; i++) {
    const img = testImages[i];
    console.log(`\n[${i + 1}/${testImages.length}] ${img.description} (${img.file})`);

    try {
      const result = await runTest(img);
      if (!result) { results.push({ image: img.description, error: 'skipped' }); continue; }

      const stage1 = result.stage1Data ? extractResultSummary(result.stage1Data) : null;
      const final = extractResultSummary(result.finalData);

      const entry = {
        image: img.description,
        file: img.file,
        stage1Time: result.stage1Time ? `${result.stage1Time.toFixed(1)}s` : 'N/A (single-stage)',
        totalTime: `${result.totalTime.toFixed(1)}s`,
        stage1Id: stage1?.scientificName || final.scientificName,
        finalId: final.scientificName,
        idChanged: stage1 ? (stage1.scientificName !== final.scientificName) : false,
        stage1Health: stage1?.health || final.health,
        finalHealth: final.health,
        diagnosisChanged: stage1 ? (stage1.health !== final.health) : false,
        stage1Issues: stage1?.issueNames || final.issueNames,
        finalIssues: final.issueNames,
        plantNetResult: final.plantNetTop || 'N/A',
        wikiVerification: final.crossRefMatch,
        toxVerification: final.toxVerification,
        toxPets: final.toxPets,
        toxHumans: final.toxHumans,
        hasCare: final.hasCare,
        hasSeasonal: final.hasSeasonal,
        hasFunFacts: final.hasFunFacts,
        confidence: final.confidence,
        crossRefConfidence: final.crossRefConfidence,
        phase: final.phase,
        errors: [],
      };

      console.log(`  Final ID: ${final.scientificName} (${final.commonNameHe})`);
      console.log(`  Confidence: ${final.confidence} → ${final.crossRefConfidence || 'N/A'}`);
      console.log(`  Health: ${final.health} (score: ${final.healthScore})`);
      console.log(`  Issues: ${final.issueNames?.join(', ') || 'none'}`);
      console.log(`  Tox: verification=${final.toxVerification} pets=${final.toxPets} humans=${final.toxHumans}`);
      console.log(`  Care: ${final.hasCare} Seasonal: ${final.hasSeasonal} FunFacts: ${final.hasFunFacts}`);
      console.log(`  PlantNet: ${final.plantNetTop || 'N/A'}`);
      console.log(`  Phase: ${final.phase}`);
      if (result.stage1Time) {
        console.log(`  Stage 1: ${result.stage1Time.toFixed(1)}s | Total: ${result.totalTime.toFixed(1)}s`);
        console.log(`  ID changed S1→S2: ${entry.idChanged} | Diagnosis changed: ${entry.diagnosisChanged}`);
      } else {
        console.log(`  Total: ${result.totalTime.toFixed(1)}s (single-stage)`);
      }

      results.push(entry);
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
      results.push({ image: img.description, error: e.message });
    }
  }

  // Summary
  console.log('\n\n=== SUMMARY ===\n');
  const successful = results.filter(r => !r.error);
  if (successful.length === 0) {
    console.log('No successful tests.');
  } else {
    const stage1Times = successful.map(r => parseFloat(r.stage1Time) || null).filter(Boolean);
    const totalTimes = successful.map(r => parseFloat(r.totalTime)).filter(Boolean);

    if (stage1Times.length > 0) {
      stage1Times.sort((a, b) => a - b);
      const median = stage1Times[Math.floor(stage1Times.length / 2)];
      console.log(`Stage 1 latencies: ${stage1Times.map(t => t.toFixed(1) + 's').join(', ')}`);
      console.log(`Stage 1 median: ${median.toFixed(1)}s`);
      console.log(`Stage 1 meets <=20s target: ${median <= 20 ? 'YES' : 'NO'}`);
    }

    totalTimes.sort((a, b) => a - b);
    const totalMedian = totalTimes[Math.floor(totalTimes.length / 2)];
    console.log(`Total latencies: ${totalTimes.map(t => t.toFixed(1) + 's').join(', ')}`);
    console.log(`Total median: ${totalMedian.toFixed(1)}s`);

    const anyIdChanged = successful.some(r => r.idChanged);
    console.log(`Any Stage 1→2 ID change: ${anyIdChanged ? 'YES' : 'NO'}`);

    const anyDiagChanged = successful.some(r => r.diagnosisChanged);
    console.log(`Any Stage 1→2 diagnosis change: ${anyDiagChanged ? 'YES' : 'NO'}`);
  }

  // Write results to file
  const outPath = path.join(__dirname, `test-e2e-results-${MODE}-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ mode: MODE, timestamp: new Date().toISOString(), results }, null, 2));
  console.log(`\nFull results saved to: ${outPath}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
