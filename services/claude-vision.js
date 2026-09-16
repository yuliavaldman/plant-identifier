const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  timeout: 180000,
});

// ── Legacy full prompt (preserved for fallback) ────────────────────────────
const LEGACY_ANALYSIS_PROMPT = `You are a careful botanist and plant-health assistant. Analyze this image and return ONLY valid JSON (no markdown fences). All text values in Hebrew. Be concise.

STEP 1 — CLASSIFY THE IMAGE:
- No plant visible → {"status":"not_a_plant","message":"הסבר קצר בעברית"}
- Multiple different plant species, unclear which is the target → {"status":"insufficient_image","reason":"נראים מספר צמחים שונים בתמונה.","suggestedPhotos":["צלמו את הצמח הרצוי בנפרד, קרוב ככל האפשר."]}
- Plant visible but image too blurry/dark/far/missing key features for reliable ID → {"status":"insufficient_image","reason":"...","suggestedPhotos":["צילום של הצמח כולו","צילום תקריב של העלים","צילום של הגבעול","צילום של פרח או פרי אם קיימים"]}
- Plant clearly visible → status:"success", continue full analysis.

For not_a_plant or insufficient_image: return ONLY those fields. Do NOT fabricate species, diseases, care, or toxicity data.

STEP 2 — IMAGE QUALITY (include in "success" response):
Assess: "good", "acceptable", or "poor". List issues from: blur, too_dark, too_bright, plant_too_small, damaged_area_not_visible, multiple_plants, insufficient_detail.
If quality is "poor" and you truly cannot identify reliably → use insufficient_image instead of success.

HONESTY RULES (highest priority):
- Never invent a species, disease, or pest not supported by visible evidence.
- Separate FACT (what is visible) from ASSESSMENT (your interpretation) from SUSPICION (unconfirmed possibility). Never present suspicion as fact.
- alternativeMatches: include ONLY genuinely plausible alternatives based on visible features. If identification is clear with no reasonable alternative, return []. Do NOT invent alternatives to fill a quota.
- If two+ species are genuinely plausible, give them similar confidence scores (within 0.1 of each other). Do not artificially inflate the top pick.
- If unsure of species, stay at genus level, set confidence below 0.7, explain in uncertaintyNote.

OBSERVATION vs DIAGNOSIS:
- "observations": list ONLY what you actually see in the image — no interpretation (e.g. "כתמים חומים יבשים בשולי העלים").
- Each item in "issues" is your diagnostic interpretation of those observations.

DIAGNOSIS RULES (each issue):
- category: pest|fungal|bacterial|viral|nutritional|watering|light|temperature|mechanical|unknown
- likelihood: high|medium|low — how confident you are in THIS specific diagnosis
- visibleEvidence: what in the image supports this diagnosis
- missingEvidence: what you cannot see that would confirm it
- alternativeExplanations: other plausible explanations you cannot rule out ([] if truly none)
- questionsToConfirm: questions that would help differentiate
- Do not force all fields to be populated if there is no real data for them.

TREATMENT SAFETY:
- likelihood "low" or thin evidence → ONLY safe reversible actions: isolate, check soil moisture, improve photo, monitor several days, check leaf undersides.
- NEVER recommend pesticides, fungicides, drastic pruning, discarding the plant, or irreversible treatment when diagnosis confidence is not high.
- likelihood "medium" → cautious advice only, note to confirm before aggressive action.

TOXICITY:
- Include verification field: "verified" (confident from known botanical data), "uncertain" (identification uncertain or toxicity data ambiguous), "unknown" (insufficient data).
- If identification confidence < 0.7, toxicity verification MUST be "uncertain" or "unknown".
- NEVER present "not toxic" with certainty based solely on image analysis.

FOLLOW-UP QUESTIONS:
When you cannot reliably differentiate between diagnoses, include "followUpQuestions" at top level.
Each question MUST be a structured object:
{"id":"q1","question":"שאלה בעברית","type":"yes_no|single_choice|short_text","options":["only for single_choice"]}
Rules:
- Maximum 4 questions per analysis.
- Each question must be able to CHANGE the diagnosis outcome. Do not include general questions that won't affect the decision.
- Types: "yes_no" (binary), "single_choice" (2-5 Hebrew options, always include "לא יודע/ת" as last option), "short_text" (open, when categories don't fit).
- If no questions would meaningfully change the diagnosis: followUpQuestions: []

CONTEXT:
Common Israeli/Mediterranean plants: Bougainvillea, Plumbago, Lantana, Jasmine, Ficus, Citrus, Olive, Rosemary, Geranium — check these first. But do not assume the user is in Israel; give general care advice when location is unknown.

JSON for "success":
{
  "status": "success",
  "imageQuality": {"overall": "good|acceptable|poor", "issues": []},
  "observations": ["תצפית 1 — מה נראה בפועל"],
  "identification": {
    "commonNameHe": "...", "commonNameEn": "...", "scientificName": "Genus species",
    "family": "...", "confidence": 0.85, "description": "1-2 משפטים",
    "uncertaintyNote": "רק אם רלוונטי",
    "alternativeMatches": [{"scientificName":"..","commonNameHe":"..","commonNameEn":"..","confidence":0.5,"differentiatingFeature":".."}]
  },
  "healthAssessment": {"overallHealth": "excellent|good|fair|poor|critical", "healthScore": 80, "summary": "..."},
  "issues": [{
    "name": "שם הבעיה",
    "category": "pest|fungal|...|unknown",
    "likelihood": "high|medium|low",
    "severity": "low|medium|high|urgent",
    "visibleEvidence": ["..."], "missingEvidence": ["..."],
    "alternativeExplanations": ["..."], "questionsToConfirm": ["..."],
    "recommendedNextStep": "...", "treatment": "..."
  }],
  "followUpQuestions": [{"id":"q1","question":"שאלה בעברית","type":"yes_no|single_choice|short_text","options":[]}],
  "careRecommendations": {"water":"..","light":"..","soil":"..","temperature":"..","fertilizer":"..","pruning":".."},
  "toxicity": {"verification":"verified|uncertain|unknown","forPets":{"toxic":false,"details":".."},"forHumans":{"toxic":false,"details":".."}},
  "seasonalCare": {"spring":"..","summer":"..","autumn":"..","winter":".."},
  "funFacts": ["..."]
}`;

// ── Optimized full prompt (same schema, ~54% smaller, benchmarked identical quality) ──
const OPTIMIZED_ANALYSIS_PROMPT = `Botanist assistant. Return ONLY valid JSON. All text Hebrew. Be concise.

CLASSIFY:
- No plant → {"status":"not_a_plant","message":"..."}
- Bad image → {"status":"insufficient_image","reason":"...","suggestedPhotos":["..."]}
- Plant visible → "success", full analysis below.

For not_a_plant/insufficient_image return ONLY those fields.

RULES:
- Never invent species/disease/pest without visible evidence.
- Separate observation (visible) from assessment (interpretation) from suspicion.
- alternativeMatches: only genuinely plausible. Empty [] if clear ID.
- If 2+ species plausible, similar confidence (within 0.1). Unsure → genus level, confidence<0.7.
- observations: ONLY what is visible, no interpretation.
- issues: diagnostic interpretation of observations.
- Each issue needs: category, likelihood, visibleEvidence, missingEvidence, alternativeExplanations, questionsToConfirm.
- Categories: pest|fungal|bacterial|viral|nutritional|watering|light|temperature|mechanical|unknown
- Low likelihood → only safe reversible actions. Never pesticides/fungicides/drastic pruning without high confidence.
- Medium → cautious advice, confirm before aggressive action.
- Toxicity verification: "verified"|"uncertain"|"unknown". confidence<0.7 → must be uncertain/unknown.
- followUpQuestions: max 4, structured {id,question,type,options}. Only if answer would change diagnosis.
- Types: yes_no, single_choice (2-5 options + "לא יודע/ת"), short_text.
- Common Israeli plants: Bougainvillea, Plumbago, Lantana, Jasmine, Ficus, Citrus, Olive, Rosemary, Geranium.

JSON for "success":
{"status":"success","imageQuality":{"overall":"good|acceptable|poor","issues":[]},"observations":["..."],"identification":{"commonNameHe":"..","commonNameEn":"..","scientificName":"..","family":"..","confidence":0.85,"description":"1-2 sentences","uncertaintyNote":"if relevant","alternativeMatches":[{"scientificName":"..","commonNameHe":"..","commonNameEn":"..","confidence":0.5,"differentiatingFeature":".."}]},"healthAssessment":{"overallHealth":"excellent|good|fair|poor|critical","healthScore":80,"summary":".."},"issues":[{"name":"..","category":"..","likelihood":"high|medium|low","severity":"low|medium|high|urgent","visibleEvidence":[".."],"missingEvidence":[".."],"alternativeExplanations":[".."],"questionsToConfirm":[".."],"recommendedNextStep":"..","treatment":".."}],"followUpQuestions":[],"careRecommendations":{"water":"..","light":"..","soil":"..","temperature":"..","fertilizer":"..","pruning":".."},"toxicity":{"verification":"..","forPets":{"toxic":false,"details":".."},"forHumans":{"toxic":false,"details":".."}},"seasonalCare":{"spring":"..","summer":"..","autumn":"..","winter":".."},"funFacts":["..."]}`;

// ── Stage 1 prompt: fast core result (no care/seasonal/funFacts, concise toxicity) ──
const STAGE1_PROMPT = `Botanist assistant. Return ONLY valid JSON. All text Hebrew. Be concise.

CLASSIFY:
- No plant → {"status":"not_a_plant","message":"..."}
- Bad image → {"status":"insufficient_image","reason":"...","suggestedPhotos":["..."]}
- Plant visible → "success", analysis below.

For not_a_plant/insufficient_image return ONLY those fields.

RULES:
- Never invent species/disease/pest without visible evidence.
- Separate observation (visible) from assessment (interpretation) from suspicion.
- alternativeMatches: only genuinely plausible. Empty [] if clear ID.
- If 2+ species plausible, similar confidence (within 0.1). Unsure → genus level, confidence<0.7.
- observations: ONLY what is visible, no interpretation.
- issues: diagnostic interpretation of observations.
- Each issue needs: category, likelihood, visibleEvidence, missingEvidence, alternativeExplanations, questionsToConfirm, recommendedNextStep, short treatment.
- Categories: pest|fungal|bacterial|viral|nutritional|watering|light|temperature|mechanical|unknown
- Low likelihood → only safe reversible actions. Never pesticides/fungicides/drastic pruning without high confidence.
- Medium → cautious advice, confirm before aggressive action.
- Toxicity verification: "verified"|"uncertain"|"unknown". confidence<0.7 → must be uncertain/unknown.
- followUpQuestions: max 4, structured {id,question,type,options}. Only if answer would change diagnosis.
- Types: yes_no, single_choice (2-5 options + "לא יודע/ת"), short_text.
- Common Israeli plants: Bougainvillea, Plumbago, Lantana, Jasmine, Ficus, Citrus, Olive, Rosemary, Geranium.

JSON for "success":
{"status":"success","imageQuality":{"overall":"good|acceptable|poor","issues":[]},"observations":["..."],"identification":{"commonNameHe":"..","commonNameEn":"..","scientificName":"..","family":"..","confidence":0.85,"description":"1-2 sentences","uncertaintyNote":"if relevant","alternativeMatches":[{"scientificName":"..","commonNameHe":"..","commonNameEn":"..","confidence":0.5,"differentiatingFeature":".."}]},"healthAssessment":{"overallHealth":"excellent|good|fair|poor|critical","healthScore":80,"summary":".."},"issues":[{"name":"..","category":"..","likelihood":"high|medium|low","severity":"low|medium|high|urgent","visibleEvidence":[".."],"missingEvidence":[".."],"alternativeExplanations":[".."],"questionsToConfirm":[".."],"recommendedNextStep":"..","treatment":".."}],"followUpQuestions":[],"toxicity":{"verification":"..","forPets":{"toxic":false},"forHumans":{"toxic":false}}}`;

// ── Stage 2 enrichment prompt (text-only, no image) ──
const STAGE2_ENRICHMENT_PROMPT = `You are enriching a plant analysis with detailed care information. Return ONLY valid JSON. All text Hebrew. Be concise but helpful.

You already have the plant identification and health assessment from Stage 1 (below). Your task is to add:
1. careRecommendations — practical growing guidance
2. seasonalCare — season-by-season tips
3. funFacts — 3-4 interesting facts
4. Detailed toxicity text (details field for pets and humans)

Do NOT re-identify or re-diagnose the plant. Use the identification provided.

TOXICITY SAFETY RULES:
- Check the toxicity verification state and identification confidence provided below.
- If verification is "uncertain" or "unknown": do NOT write definitive safe/non-toxic claims. Instead explain that toxicity status has not been verified and advise caution.
- If identification confidence is below 0.7 or confidenceLevel indicates uncertainty: toxicity details must state explicitly that the identification is uncertain and therefore toxicity information may not apply.
- Never convert uncertain data into definitive safety advice.

JSON:
{"careRecommendations":{"water":"..","light":"..","soil":"..","temperature":"..","fertilizer":"..","pruning":".."},"seasonalCare":{"spring":"..","summer":"..","autumn":"..","winter":".."},"funFacts":["..."],"toxicityDetails":{"forPets":{"details":".."},"forHumans":{"details":".."}}}`;

// Select prompt based on feature flags
function getAnalysisPrompt(options = {}) {
  if (options.stage1) return STAGE1_PROMPT;
  if (options.optimized) return OPTIMIZED_ANALYSIS_PROMPT;
  return LEGACY_ANALYSIS_PROMPT;
}

// Backwards-compatible alias
const ANALYSIS_PROMPT = LEGACY_ANALYSIS_PROMPT;

function parseClaudeJson(text, errorLabel) {
  let jsonStr = text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  } else {
    const braceStart = jsonStr.indexOf('{');
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
      jsonStr = jsonStr.substring(braceStart, braceEnd + 1);
    }
  }
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error(`Failed to parse ${errorLabel} (first 500 chars):`, text.substring(0, 500));
    throw new Error('שגיאה בפענוח תשובת הניתוח. נסו שוב.');
  }
}

function toMediaType(mimetype) {
  if (mimetype === 'image/png') return 'image/png';
  if (mimetype === 'image/webp') return 'image/webp';
  if (mimetype === 'image/gif') return 'image/gif';
  return 'image/jpeg';
}

async function analyzeWithClaude(imageBase64, mimetype, options = {}) {
  const mediaType = toMediaType(mimetype);
  const prompt = getAnalysisPrompt(options);
  const maxTokens = options.stage1 ? 3000 : (options.optimized ? 4000 : 6000);
  const promptLabel = options.stage1 ? 'stage1' : (options.optimized ? 'optimized' : 'legacy');
  const model = 'claude-sonnet-4-6';

  console.log(`[PROMPT] chars=${prompt.length} maxTokens=${maxTokens}`);
  console.log(`[CLAUDE-REQUEST] prompt=${promptLabel} promptChars=${prompt.length} max_tokens=${maxTokens} model=${model} imagePayloadKB=${Math.round(imageBase64.length / 1024)}`);

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageBase64
            }
          },
          {
            type: 'text',
            text: prompt
          }
        ]
      }
    ]
  });

  if (response.stop_reason === 'max_tokens') {
    console.error('Response was truncated (max_tokens reached)');
  }

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error('לא התקבלה תשובה מהמודל');
  }

  return parseClaudeJson(textBlock.text, 'Claude response');
}

async function enrichWithClaude(stage1Result, enrichmentContext = {}) {
  const toxVerification = stage1Result.toxicity?.verification || 'unknown';
  const idConfidence = stage1Result.identification?.confidence || 0;
  const confidenceLevel = stage1Result.identification?.confidenceLevel || '';
  const plantNetDisagrees = enrichmentContext.plantNetSpeciesDisagreement || false;

  const plantInfo = `Plant: ${stage1Result.identification?.scientificName || 'unknown'} (${stage1Result.identification?.commonNameHe || ''})
Family: ${stage1Result.identification?.family || ''}
Health: ${stage1Result.healthAssessment?.overallHealth || 'unknown'}
Issues: ${(stage1Result.issues || []).map(i => i.name).join(', ') || 'none'}
Toxic to pets: ${stage1Result.toxicity?.forPets?.toxic ?? 'unknown'}
Toxic to humans: ${stage1Result.toxicity?.forHumans?.toxic ?? 'unknown'}
Toxicity verification: ${toxVerification}
Identification confidence: ${idConfidence}
Confidence level: ${confidenceLevel}
PlantNet species disagreement: ${plantNetDisagrees ? 'yes' : 'no'}`;

  const fullPrompt = STAGE2_ENRICHMENT_PROMPT + '\n\nStage 1 result:\n' + plantInfo;
  console.log(`[PROMPT] chars=${fullPrompt.length} maxTokens=2000`);
  console.log(`[CLAUDE-REQUEST] prompt=stage2-enrichment promptChars=${fullPrompt.length} max_tokens=2000 model=claude-sonnet-4-6 imagePayloadKB=0`);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: fullPrompt
      }
    ]
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error('לא התקבלה תשובה מהמודל (enrichment)');
  }

  return parseClaudeJson(textBlock.text, 'enrichment response');
}

function mergeStage2IntoResult(stage1, stage2) {
  const merged = { ...stage1 };

  if (stage2.careRecommendations) {
    merged.careRecommendations = stage2.careRecommendations;
  }
  if (stage2.seasonalCare) {
    merged.seasonalCare = stage2.seasonalCare;
  }
  if (stage2.funFacts && stage2.funFacts.length > 0) {
    merged.funFacts = stage2.funFacts;
  }
  if (stage2.toxicityDetails && merged.toxicity) {
    if (stage2.toxicityDetails.forPets?.details && merged.toxicity.forPets) {
      merged.toxicity.forPets.details = stage2.toxicityDetails.forPets.details;
    }
    if (stage2.toxicityDetails.forHumans?.details && merged.toxicity.forHumans) {
      merged.toxicity.forHumans.details = stage2.toxicityDetails.forHumans.details;
    }
  }

  return merged;
}

const REFINEMENT_PROMPT_PREFIX = `You are refining a previous plant diagnosis based on user answers to follow-up questions.
Return ONLY valid JSON (no markdown fences). All text in Hebrew.

RULES:
- Do NOT restart analysis from scratch. Build on the previous diagnosis.
- For each previously identified issue, determine if the user's answers make it: more likely, unchanged, less likely, or ruled out.
- Do not claim certainty when evidence is still incomplete.
- If the user answered "לא יודע/ת" or left a question unanswered, treat it as unknown — do not infer an answer.
- If answers contradict the original diagnosis significantly, explain what changed and why.
`;

const REFINEMENT_PROMPT_WITH_IMAGE = REFINEMENT_PROMPT_PREFIX + `
You have access to both the original image and the previous analysis. Use the image to verify any new conclusions.
`;

const REFINEMENT_PROMPT_WITHOUT_IMAGE = REFINEMENT_PROMPT_PREFIX + `
IMPORTANT: You do NOT have the original image. This refinement is based ONLY on previous observations and the user's answers. Do not describe or reference image features you cannot see. State explicitly that the refinement is based on prior observations and user responses.
`;

const REFINEMENT_JSON_SCHEMA = `
Return JSON:
{
  "refinementSummary": "Hebrew paragraph explaining what changed and why",
  "diagnosisChanged": true|false,
  "confidenceChange": "increased|unchanged|decreased",
  "updatedIssues": [{"name":"...","category":"...","likelihood":"high|medium|low","severity":"...","status":"confirmed|unchanged|less_likely|ruled_out","explanation":"why this changed","treatment":"updated treatment if needed"}],
  "ruledOut": [{"name":"...","reason":"Hebrew explanation of why ruled out"}],
  "stillUncertain": [{"name":"...","reason":"what's still missing"}],
  "recommendedNextStep": "Hebrew text",
  "needsMorePhotos": true|false,
  "suggestedPhotos": ["if needsMorePhotos is true"]
}`;

async function refineWithClaude(originalAnalysis, answers, imageBase64, imageMimetype) {
  const hasImage = !!imageBase64;
  const basePrompt = hasImage ? REFINEMENT_PROMPT_WITH_IMAGE : REFINEMENT_PROMPT_WITHOUT_IMAGE;

  const contextBlock = `
PREVIOUS PLANT IDENTIFICATION:
${JSON.stringify(originalAnalysis.identification || {}, null, 2)}

PREVIOUS OBSERVATIONS:
${JSON.stringify(originalAnalysis.observations || [], null, 2)}

PREVIOUS ISSUES:
${JSON.stringify(originalAnalysis.issues || [], null, 2)}

PREVIOUS HEALTH ASSESSMENT:
${JSON.stringify(originalAnalysis.healthAssessment || {}, null, 2)}

USER ANSWERS TO FOLLOW-UP QUESTIONS:
${JSON.stringify(answers, null, 2)}

${REFINEMENT_JSON_SCHEMA}`;

  const messages = [{
    role: 'user',
    content: []
  }];

  if (hasImage) {
    const mediaType = imageMimetype === 'image/png' ? 'image/png'
      : imageMimetype === 'image/webp' ? 'image/webp'
      : imageMimetype === 'image/gif' ? 'image/gif'
      : 'image/jpeg';

    messages[0].content.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: imageBase64 }
    });
  }

  messages[0].content.push({
    type: 'text',
    text: basePrompt + contextBlock
  });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error('לא התקבלה תשובה מהמודל');
  }

  return parseClaudeJson(textBlock.text, 'refinement response');
}

const FOLLOWUP_IMAGE_PROMPT = `You are refining a previous plant diagnosis based on a NEW follow-up image provided by the user.
Return ONLY valid JSON (no markdown fences). All text in Hebrew.

RULES:
- This is a CONTINUATION of the same diagnosis, NOT a new scan.
- Compare what you see in the new image with the previous diagnosis data.
- Separate OBSERVATIONS (what you see in the new image) from INTERPRETATION (how it changes the diagnosis).
- newObservations must contain ONLY factual descriptions of what is visible — no interpretation.
- If the new image shows a flower, fruit, bark, or clearer structure that was missing before, the plant identification CAN change.
- If identification changes, explain what new feature led to the change.
- Explain what changed and why in followUpSummary (e.g. "הצילום הנוסף מחזק את האבחנה..." or "הצילום הנוסף מגלה...").
- Do NOT invent observations not visible in the new image.
- If the new image doesn't add useful information, say so honestly.

TREATMENT SAFETY:
- Same rules as initial analysis: never recommend aggressive treatment without high confidence.
`;

const FOLLOWUP_IMAGE_JSON_SCHEMA = `
Return JSON:
{
  "followUpSummary": "Hebrew paragraph explaining what the new image reveals and how it affects the diagnosis",
  "newObservations": ["factual observation 1 from new image", "factual observation 2"],
  "diagnosisChanged": true|false,
  "confidenceChange": "increased|unchanged|decreased",
  "updatedReliability": "Hebrew text about overall reliability after this additional evidence",
  "supportedIssues": [{"name":"issue name","explanation":"why this issue is now more supported"}],
  "weakenedIssues": [{"name":"issue name","explanation":"why this issue is now less likely"}],
  "ruledOut": [{"name":"issue name","reason":"why ruled out based on new image"}],
  "newIssues": [{"name":"new issue","category":"pest|fungal|...|unknown","likelihood":"high|medium|low","severity":"low|medium|high","description":"what was seen","treatment":"safe treatment"}],
  "plantIdentificationChanged": true|false,
  "updatedPlantIdentification": {"commonNameHe":"...","commonNameEn":"...","scientificName":"...","confidence":0.85,"changeReason":"why identification changed"} | null,
  "recommendedNextStep": "Hebrew text",
  "needsMorePhotos": true|false,
  "suggestedPhotos": ["if more photos still needed"]
}`;

async function analyzeFollowUpImage(originalAnalysis, refinementResult, answers, newImageBase64, newImageMimetype, originalImageBase64, originalImageMimetype) {
  const content = [];

  if (originalImageBase64) {
    const origMediaType = originalImageMimetype === 'image/png' ? 'image/png'
      : originalImageMimetype === 'image/webp' ? 'image/webp'
      : originalImageMimetype === 'image/gif' ? 'image/gif'
      : 'image/jpeg';
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: origMediaType, data: originalImageBase64 }
    });
  }

  const newMediaType = newImageMimetype === 'image/png' ? 'image/png'
    : newImageMimetype === 'image/webp' ? 'image/webp'
    : newImageMimetype === 'image/gif' ? 'image/gif'
    : 'image/jpeg';
  content.push({
    type: 'image',
    source: { type: 'base64', media_type: newMediaType, data: newImageBase64 }
  });

  let contextBlock = `
${originalImageBase64 ? 'The FIRST image is the original scan. The SECOND image is the new follow-up image.' : 'You do not have the original image. The image shown is the NEW follow-up image.'}

PREVIOUS PLANT IDENTIFICATION:
${JSON.stringify(originalAnalysis.identification || {}, null, 2)}

PREVIOUS OBSERVATIONS:
${JSON.stringify(originalAnalysis.observations || [], null, 2)}

PREVIOUS ISSUES:
${JSON.stringify(originalAnalysis.issues || [], null, 2)}

PREVIOUS HEALTH ASSESSMENT:
${JSON.stringify(originalAnalysis.healthAssessment || {}, null, 2)}
`;

  if (refinementResult) {
    contextBlock += `
REFINEMENT RESULT (from user answers):
${JSON.stringify(refinementResult, null, 2)}
`;
  }

  if (answers && answers.length > 0) {
    contextBlock += `
USER ANSWERS TO FOLLOW-UP QUESTIONS:
${JSON.stringify(answers, null, 2)}
`;
  }

  contextBlock += FOLLOWUP_IMAGE_JSON_SCHEMA;

  content.push({
    type: 'text',
    text: FOLLOWUP_IMAGE_PROMPT + contextBlock
  });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 5000,
    messages: [{ role: 'user', content }]
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error('לא התקבלה תשובה מהמודל');
  }

  return parseClaudeJson(textBlock.text, 'follow-up image response');
}

module.exports = { analyzeWithClaude, enrichWithClaude, mergeStage2IntoResult, refineWithClaude, analyzeFollowUpImage };
