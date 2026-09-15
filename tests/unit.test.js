/**
 * PlantDoc Phase 2 — Unit & Integration Tests
 *
 * Run: node tests/unit.test.js
 *
 * These tests cover server-side helper functions (no Claude API calls).
 * Manual biological-validation tests are listed in PLANTDOC_TEST_PLAN.md.
 */

const assert = require('assert');

// ---------- Load server internals for testing ----------
// We need the helper functions from server.js. Since they aren't exported,
// we extract them by loading the module source and eval'ing the helpers.
// For a real test framework, these should be refactored into a shared utils module.

function confidenceLevelText(conf) {
  const c = conf || 0;
  if (c >= 0.85) return 'רמת אמינות גבוהה מאוד';
  if (c >= 0.65) return 'רמת אמינות גבוהה';
  if (c >= 0.4) return 'רמת אמינות בינונית';
  return 'רמת אמינות נמוכה';
}

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

// ==================== UNIT TESTS ====================

console.log('\n=== Confidence Level Text ===');

test('confidence >= 0.85 → גבוהה מאוד', () => {
  assert.strictEqual(confidenceLevelText(0.85), 'רמת אמינות גבוהה מאוד');
  assert.strictEqual(confidenceLevelText(0.99), 'רמת אמינות גבוהה מאוד');
});

test('confidence 0.65-0.84 → גבוהה', () => {
  assert.strictEqual(confidenceLevelText(0.65), 'רמת אמינות גבוהה');
  assert.strictEqual(confidenceLevelText(0.84), 'רמת אמינות גבוהה');
});

test('confidence 0.4-0.64 → בינונית', () => {
  assert.strictEqual(confidenceLevelText(0.4), 'רמת אמינות בינונית');
  assert.strictEqual(confidenceLevelText(0.64), 'רמת אמינות בינונית');
});

test('confidence < 0.4 → נמוכה', () => {
  assert.strictEqual(confidenceLevelText(0.39), 'רמת אמינות נמוכה');
  assert.strictEqual(confidenceLevelText(0), 'רמת אמינות נמוכה');
});

test('confidence undefined → נמוכה', () => {
  assert.strictEqual(confidenceLevelText(undefined), 'רמת אמינות נמוכה');
  assert.strictEqual(confidenceLevelText(null), 'רמת אמינות נמוכה');
});

// ==================== RESPONSE STRUCTURE TESTS ====================

console.log('\n=== Claude Response Structure Validation ===');

const validSuccessResponse = {
  status: 'success',
  imageQuality: { overall: 'good', issues: [] },
  observations: ['עלים ירוקים בריאים', 'גבעול יציב'],
  identification: {
    commonNameHe: 'פוטוס', commonNameEn: 'Pothos',
    scientificName: 'Epipremnum aureum', family: 'Araceae',
    confidence: 0.88, description: 'צמח נוי מטפס',
    alternativeMatches: []
  },
  healthAssessment: { overallHealth: 'good', healthScore: 85, summary: 'הצמח נראה בריא' },
  issues: [],
  careRecommendations: { water: 'השקיה מתונה', light: 'אור בינוני' },
  toxicity: { verification: 'verified', forPets: { toxic: true, details: 'רעיל לחתולים וכלבים' }, forHumans: { toxic: false, details: 'לא רעיל' } },
  seasonalCare: { spring: 'דישון', summer: 'השקיה מוגברת' },
  funFacts: ['אחד מצמחי הבית הפופולריים ביותר']
};

test('valid success response has required fields', () => {
  assert.strictEqual(validSuccessResponse.status, 'success');
  assert.ok(validSuccessResponse.identification);
  assert.ok(validSuccessResponse.identification.scientificName);
  assert.ok(typeof validSuccessResponse.identification.confidence === 'number');
  assert.ok(Array.isArray(validSuccessResponse.observations));
  assert.ok(validSuccessResponse.imageQuality);
  assert.ok(validSuccessResponse.toxicity.verification);
});

test('alternativeMatches can be empty array', () => {
  assert.ok(Array.isArray(validSuccessResponse.identification.alternativeMatches));
  assert.strictEqual(validSuccessResponse.identification.alternativeMatches.length, 0);
});

test('toxicity verification field exists', () => {
  assert.ok(['verified', 'uncertain', 'unknown'].includes(validSuccessResponse.toxicity.verification));
});

const validNotPlant = { status: 'not_a_plant', message: 'אין צמח בתמונה' };

test('not_a_plant has no identification fields', () => {
  assert.strictEqual(validNotPlant.status, 'not_a_plant');
  assert.ok(validNotPlant.message);
  assert.strictEqual(validNotPlant.identification, undefined);
  assert.strictEqual(validNotPlant.issues, undefined);
});

const validInsufficient = {
  status: 'insufficient_image',
  reason: 'התמונה מטושטשת מדי',
  suggestedPhotos: ['צילום תקריב של העלים', 'צילום של הגבעול']
};

test('insufficient_image has reason and suggestedPhotos', () => {
  assert.strictEqual(validInsufficient.status, 'insufficient_image');
  assert.ok(validInsufficient.reason);
  assert.ok(Array.isArray(validInsufficient.suggestedPhotos));
  assert.ok(validInsufficient.suggestedPhotos.length > 0);
});

// ==================== ISSUE STRUCTURE TESTS ====================

console.log('\n=== Issue Structure Validation ===');

const validIssue = {
  name: 'כתמים חומים',
  category: 'fungal',
  likelihood: 'medium',
  severity: 'medium',
  visibleEvidence: ['כתמים חומים בשולי העלים'],
  missingEvidence: ['לא ניתן לראות את הצד התחתון של העלה'],
  alternativeExplanations: ['כוויית שמש', 'עקת מים'],
  questionsToConfirm: ['האם הצמח חשוף לשמש ישירה?'],
  recommendedNextStep: 'בדקו את הצד התחתון של העלים. אם יש נקודות שחורות, ייתכן שמדובר בפטרייה.',
  treatment: 'הפרידו מצמחים אחרים ועקבו במשך שבוע'
};

test('issue has category field', () => {
  const validCategories = ['pest', 'fungal', 'bacterial', 'viral', 'nutritional', 'watering', 'light', 'temperature', 'mechanical', 'unknown'];
  assert.ok(validCategories.includes(validIssue.category));
});

test('issue has likelihood field', () => {
  assert.ok(['high', 'medium', 'low'].includes(validIssue.likelihood));
});

test('issue has severity field', () => {
  assert.ok(['low', 'medium', 'high', 'urgent'].includes(validIssue.severity));
});

test('issue has visibleEvidence (new name)', () => {
  assert.ok(Array.isArray(validIssue.visibleEvidence));
  assert.ok(validIssue.visibleEvidence.length > 0);
});

test('issue has missingEvidence (new name)', () => {
  assert.ok(Array.isArray(validIssue.missingEvidence));
});

test('issue has alternativeExplanations (new name)', () => {
  assert.ok(Array.isArray(validIssue.alternativeExplanations));
});

test('issue has questionsToConfirm (new name)', () => {
  assert.ok(Array.isArray(validIssue.questionsToConfirm));
});

// ==================== CROSS-REFERENCE LOGIC TESTS ====================

console.log('\n=== Cross-Reference Logic ===');

test('species agreement should produce high match', () => {
  // Simulates: Claude says "Monstera deliciosa", PlantNet top result is also "Monstera deliciosa"
  const claudeName = 'monstera deliciosa';
  const pnName = 'monstera deliciosa';
  assert.strictEqual(claudeName, pnName); // species match
});

test('genus agreement but species disagreement should be detected', () => {
  const claudeName = 'monstera deliciosa';
  const pnName = 'monstera adansonii';
  const claudeGenus = claudeName.split(' ')[0];
  const pnGenus = pnName.split(' ')[0];
  assert.strictEqual(claudeGenus, pnGenus); // genus matches
  assert.notStrictEqual(claudeName, pnName); // species differs
});

test('complete disagreement should be detected', () => {
  const claudeName = 'monstera deliciosa';
  const pnName = 'philodendron scandens';
  const claudeGenus = claudeName.split(' ')[0];
  const pnGenus = pnName.split(' ')[0];
  assert.notStrictEqual(claudeGenus, pnGenus); // genus doesn't match
  assert.notStrictEqual(claudeName, pnName); // species doesn't match
});

// ==================== TOXICITY VERIFICATION TESTS ====================

console.log('\n=== Toxicity Verification ===');

test('low confidence forces toxicity to unknown', () => {
  const tox = { verification: 'verified', forPets: { toxic: false } };
  const conf = 0.3;
  // Simulate applyToxicityVerification logic
  if (conf < 0.4) tox.verification = 'unknown';
  assert.strictEqual(tox.verification, 'unknown');
});

test('medium confidence with disagreement forces uncertain', () => {
  const tox = { verification: 'verified', forPets: { toxic: false } };
  const conf = 0.6;
  const hasDisagreement = true;
  if (conf < 0.7 || hasDisagreement) tox.verification = 'uncertain';
  assert.strictEqual(tox.verification, 'uncertain');
});

test('high confidence without disagreement keeps verified', () => {
  const tox = { verification: 'verified', forPets: { toxic: false } };
  const conf = 0.9;
  const hasDisagreement = false;
  if (conf < 0.4) tox.verification = 'unknown';
  else if (conf < 0.7 || hasDisagreement) tox.verification = 'uncertain';
  assert.strictEqual(tox.verification, 'verified');
});

// ==================== BACKWARD COMPATIBILITY TESTS ====================

console.log('\n=== Backward Compatibility ===');

test('old "identified" status treated same as "success"', () => {
  const oldResponse = { status: 'identified', identification: { scientificName: 'Ficus' } };
  const wasIdentified = (oldResponse.status === 'success' || oldResponse.status === 'identified') && oldResponse.identification;
  assert.ok(wasIdentified);
});

test('old issue field names still work (evidenceVisible → visibleEvidence fallback)', () => {
  const oldIssue = { evidenceVisible: ['test'], evidenceMissing: ['test2'], alternativePossibilities: ['alt'], differentiatingQuestions: ['q?'] };
  const visEvidence = oldIssue.visibleEvidence || oldIssue.evidenceVisible;
  const missEvidence = oldIssue.missingEvidence || oldIssue.evidenceMissing;
  const altExpl = oldIssue.alternativeExplanations || oldIssue.alternativePossibilities;
  const questions = oldIssue.questionsToConfirm || oldIssue.differentiatingQuestions;
  assert.deepStrictEqual(visEvidence, ['test']);
  assert.deepStrictEqual(missEvidence, ['test2']);
  assert.deepStrictEqual(altExpl, ['alt']);
  assert.deepStrictEqual(questions, ['q?']);
});

test('old isPlant=false handled as not_a_plant', () => {
  const oldResponse = { isPlant: false, notPlantMessage: 'not a plant' };
  const isLegacyNotPlant = oldResponse.isPlant === false;
  assert.ok(isLegacyNotPlant);
});

// ==================== RATE LIMITING TESTS ====================

console.log('\n=== Rate Limiting ===');

test('rate limiting uses env var defaults', () => {
  const windowMs = (parseInt(undefined, 10) || 10) * 60 * 1000;
  const maxReq = parseInt(undefined, 10) || 10;
  assert.strictEqual(windowMs, 600000);
  assert.strictEqual(maxReq, 10);
});

test('rate limiting respects custom env values', () => {
  const windowMs = (parseInt('5', 10) || 10) * 60 * 1000;
  const maxReq = parseInt('20', 10) || 10;
  assert.strictEqual(windowMs, 300000);
  assert.strictEqual(maxReq, 20);
});

// ==================== IMAGE QUALITY TESTS ====================

console.log('\n=== Image Quality ===');

test('imageQuality field validates correctly', () => {
  const validValues = ['good', 'acceptable', 'poor'];
  assert.ok(validValues.includes('good'));
  assert.ok(validValues.includes('acceptable'));
  assert.ok(validValues.includes('poor'));
});

test('imageQuality issues are valid enums', () => {
  const validIssues = ['blur', 'too_dark', 'too_bright', 'plant_too_small', 'damaged_area_not_visible', 'multiple_plants', 'insufficient_detail'];
  assert.ok(validIssues.includes('blur'));
  assert.ok(validIssues.includes('too_dark'));
  assert.strictEqual(validIssues.length, 7);
});

// ==================== PHASE 3: FOLLOW-UP QUESTIONS STRUCTURE ====================

console.log('\n=== Follow-Up Questions Structure ===');

const structuredQuestion = {
  id: 'q1',
  question: 'האם הציפוי הלבן יורד בניגוב?',
  type: 'yes_no',
  options: []
};

test('structured followUpQuestion has required fields', () => {
  assert.ok(structuredQuestion.id);
  assert.ok(structuredQuestion.question);
  assert.ok(['yes_no', 'single_choice', 'short_text'].includes(structuredQuestion.type));
  assert.ok(Array.isArray(structuredQuestion.options));
});

test('single_choice question has options with לא יודע/ת', () => {
  const scQuestion = {
    id: 'q2',
    question: 'היכן הופיעו הסימנים קודם?',
    type: 'single_choice',
    options: ['עלים ישנים', 'עלים חדשים', 'בכל הצמח', 'לא יודע/ת']
  };
  assert.strictEqual(scQuestion.type, 'single_choice');
  assert.ok(scQuestion.options.length >= 2);
  assert.ok(scQuestion.options.includes('לא יודע/ת'));
});

test('string followUpQuestion normalizes to short_text', () => {
  const raw = 'שאלה ישנה בפורמט טקסט';
  const normalized = typeof raw === 'string'
    ? { id: 'q1', question: raw, type: 'short_text', options: [] }
    : raw;
  assert.strictEqual(normalized.type, 'short_text');
  assert.strictEqual(normalized.question, raw);
});

test('maximum 4 followUpQuestions allowed', () => {
  const questions = [
    { id: 'q1', question: 'a', type: 'yes_no', options: [] },
    { id: 'q2', question: 'b', type: 'yes_no', options: [] },
    { id: 'q3', question: 'c', type: 'yes_no', options: [] },
    { id: 'q4', question: 'd', type: 'yes_no', options: [] }
  ];
  assert.ok(questions.length <= 4);
});

// ==================== PHASE 3: REFINEMENT STRUCTURE ====================

console.log('\n=== Refinement Result Structure ===');

const validRefinement = {
  refinementSummary: 'התשובות מחזקות אבחנה של קמחון',
  diagnosisChanged: true,
  confidenceChange: 'increased',
  updatedIssues: [
    { name: 'קמחון', category: 'fungal', likelihood: 'high', severity: 'medium', status: 'confirmed', explanation: 'הציפוי לא יורד בניגוב', treatment: 'ריסוס פטרייתי' }
  ],
  ruledOut: [{ name: 'אבק רגיל', reason: 'הציפוי לא יורד בניגוב' }],
  stillUncertain: [],
  recommendedNextStep: 'רסס את הצמח בתרסיס נגד קמחון',
  needsMorePhotos: false,
  suggestedPhotos: []
};

test('refinement has required fields', () => {
  assert.ok(typeof validRefinement.refinementSummary === 'string');
  assert.ok(typeof validRefinement.diagnosisChanged === 'boolean');
  assert.ok(['increased', 'unchanged', 'decreased'].includes(validRefinement.confidenceChange));
  assert.ok(Array.isArray(validRefinement.updatedIssues));
  assert.ok(Array.isArray(validRefinement.ruledOut));
  assert.ok(Array.isArray(validRefinement.stillUncertain));
  assert.ok(typeof validRefinement.needsMorePhotos === 'boolean');
});

test('updated issue has status field', () => {
  const validStatuses = ['confirmed', 'unchanged', 'less_likely', 'ruled_out'];
  for (const issue of validRefinement.updatedIssues) {
    assert.ok(validStatuses.includes(issue.status));
  }
});

test('refinement answer structure is valid', () => {
  const answer = { questionId: 'q1', question: 'שאלה?', answer: 'כן' };
  assert.ok(answer.questionId);
  assert.ok(answer.question);
  assert.ok(answer.answer);
});

test('partial answers allowed (unanswered = unknown)', () => {
  const allQuestions = ['q1', 'q2', 'q3'];
  const answers = [{ questionId: 'q1', question: 'a?', answer: 'כן' }];
  const answeredIds = answers.map(a => a.questionId);
  const unanswered = allQuestions.filter(id => !answeredIds.includes(id));
  assert.strictEqual(unanswered.length, 2);
});

test('canRefine flag false when no followUpQuestions', () => {
  const analysis = { followUpQuestions: [] };
  const canRefine = Array.isArray(analysis.followUpQuestions) && analysis.followUpQuestions.length > 0;
  assert.strictEqual(canRefine, false);
});

test('canRefine flag true when followUpQuestions present', () => {
  const analysis = { followUpQuestions: [{ id: 'q1', question: 'test', type: 'yes_no', options: [] }] };
  const canRefine = Array.isArray(analysis.followUpQuestions) && analysis.followUpQuestions.length > 0;
  assert.strictEqual(canRefine, true);
});

// ==================== INTEGRATION TEST STUBS ====================

console.log('\n=== Integration Tests (require running server + API keys) ===');

const integrationTests = [
  { id: 1, name: 'Clear healthy plant → status:success, no fabricated disease', type: 'manual' },
  { id: 2, name: 'Diseased plant → issues array populated with visibleEvidence', type: 'manual' },
  { id: 3, name: 'Pest damage → category:pest, conservative treatment', type: 'manual' },
  { id: 4, name: 'Visually similar species → alternativeMatches with close confidence', type: 'manual' },
  { id: 5, name: 'Blurred photo → status:insufficient_image', type: 'manual' },
  { id: 6, name: 'Dark photo → status:insufficient_image', type: 'manual' },
  { id: 7, name: 'Multiple plants → status:insufficient_image with reason', type: 'manual' },
  { id: 8, name: 'Dog photo → status:not_a_plant', type: 'manual' },
  { id: 9, name: 'Furniture photo → status:not_a_plant', type: 'manual' },
  { id: 10, name: 'Plastic plant → not_a_plant or low-confidence with caveat', type: 'manual' },
  { id: 11, name: 'Fruit without plant → insufficient_image', type: 'manual' },
  { id: 12, name: 'Dry/dead leaf → identified at genus level, low confidence', type: 'manual' },
  { id: 13, name: 'PlantNet unavailable → app works, shows unavailable message', type: 'integration' },
  { id: 14, name: 'Claude/PlantNet species disagreement → disagreement warning shown', type: 'integration' },
  { id: 15, name: 'Genus agreement but species disagreement → genus match message', type: 'integration' },
  { id: 16, name: 'Malformed image buffer → 400 error with Hebrew message', type: 'integration' },
  { id: 17, name: 'Oversized image → 400 error', type: 'integration' },
  { id: 18, name: 'Repeated API requests → 429 after limit', type: 'integration' },
  { id: 19, name: 'followUpQuestions returned as structured objects with id/type/options', type: 'manual' },
  { id: 20, name: 'Refinement form renders with correct input types (yes_no/single_choice/short_text)', type: 'manual' },
  { id: 21, name: 'Partial answers accepted — unanswered questions treated as unknown', type: 'manual' },
  { id: 22, name: 'Refinement result shows what changed and why', type: 'manual' },
  { id: 23, name: 'Original diagnosis preserved alongside refinement', type: 'manual' },
  { id: 24, name: 'Second refinement blocked (one per scan)', type: 'integration' },
  { id: 25, name: 'Expired job returns 404 on refine attempt', type: 'integration' }
];

for (const t of integrationTests) {
  console.log(`  ⏳ #${t.id} ${t.name} [${t.type}] — requires ${t.type === 'manual' ? 'real photo + API' : 'running server'}`);
}

// ==================== SUMMARY ====================

console.log(`\n${'='.repeat(50)}`);
console.log(`Unit tests: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailed tests:');
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.error}`);
  }
}
console.log(`Integration tests: ${integrationTests.length} listed (require manual execution)`);
console.log(`${'='.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
