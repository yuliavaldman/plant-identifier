const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

const ANALYSIS_PROMPT = `You are an expert botanist and taxonomist with decades of field experience in plant identification.
Your task: identify the plant in this image with maximum accuracy. Return ONLY a valid JSON object (no markdown, no code fences, just raw JSON).

IDENTIFICATION METHOD — follow these steps mentally before answering:
1. LEAF ANALYSIS: Shape (ovate, lanceolate, palmate, pinnate?), margin (smooth, serrated, lobed?), arrangement (alternate, opposite, whorled?), texture, venation pattern
2. STEM/BARK: Woody or herbaceous? Color, texture, branching pattern
3. FLOWERS/FRUITS: If visible — petal count, symmetry, color, arrangement, fruit type
4. GROWTH HABIT: Tree, shrub, vine, herb, succulent, grass?
5. OVERALL MORPHOLOGY: Size estimation, distinctive features, habitat clues in background
6. NARROW DOWN: Use the features above to identify family → genus → species. Consider the most common species in Israel/Mediterranean if location is ambiguous.

ACCURACY RULES:
- If you cannot identify to species level with confidence, identify to genus and say so
- Do NOT guess a specific species if the image lacks distinguishing features — stay at genus level
- Confidence must reflect real certainty: 0.9+ only when diagnostic features are clearly visible; 0.5-0.7 for genus-level ID; below 0.5 if truly uncertain
- Always provide at least 2 alternative matches ranked by likelihood
- If the plant could be one of several similar species, list all candidates with what would differentiate them
- Common houseplants and garden plants in Israel should be identified with higher accuracy
- If the image does NOT contain a plant, set "isPlant" to false and explain in "notPlantMessage"
- Provide Hebrew AND English common names
- Scientific names must follow binomial nomenclature
- For care recommendations, consider Israeli/Mediterranean climate as default

Return this exact JSON structure:
{
  "isPlant": true,
  "imageQuality": "good|fair|poor",
  "imageQualityNote": "הערה על איכות התמונה אם רלוונטי",
  "notPlantMessage": "הודעה אם זה לא צמח",
  "identification": {
    "commonNameHe": "שם נפוץ בעברית",
    "commonNameEn": "Common English name",
    "scientificName": "Genus species",
    "family": "Family name",
    "familyHe": "שם המשפחה בעברית",
    "confidence": 0.85,
    "description": "תיאור קצר של הצמח בעברית — 2-3 משפטים",
    "origin": "מוצא הצמח",
    "alternativeMatches": [
      {
        "commonNameHe": "שם חלופי",
        "commonNameEn": "Alternative name",
        "scientificName": "Genus species",
        "confidence": 0.5,
        "differentiatingFeature": "מה מבדיל בין הצמחים"
      }
    ]
  },
  "healthAssessment": {
    "overallHealth": "excellent|good|fair|poor|critical",
    "healthScore": 80,
    "summary": "סיכום מצב בריאותי בעברית",
    "positivesigns": ["סימן חיובי 1", "סימן חיובי 2"],
    "concerns": ["דאגה 1"]
  },
  "issues": [
    {
      "type": "disease|pest|nutrient|environmental|watering",
      "name": "שם הבעיה בעברית",
      "nameEn": "Issue name in English",
      "description": "תיאור מפורט של הבעיה",
      "severity": "low|medium|high|critical",
      "visibleSymptoms": ["סימפטום נראה 1", "סימפטום נראה 2"],
      "possibleCauses": ["סיבה אפשרית 1"],
      "treatment": {
        "immediate": "מה לעשות מיד",
        "ongoing": "טיפול מתמשך",
        "products": "מוצרים מומלצים (אם רלוונטי)"
      },
      "prevention": "כיצד למנוע בעתיד",
      "urgency": "דחיפות הטיפול"
    }
  ],
  "careRecommendations": {
    "water": {
      "frequency": "תדירות השקיה",
      "amount": "כמות",
      "method": "שיטת השקיה מומלצת",
      "signs_overwater": "סימנים להשקיית יתר",
      "signs_underwater": "סימנים לחוסר השקיה",
      "tips": "טיפים נוספים"
    },
    "light": {
      "type": "full_sun|partial_sun|indirect_bright|indirect_low|shade",
      "description": "תיאור דרישות האור",
      "hours": "שעות אור מומלצות",
      "placement": "מיקום מומלץ בבית/בגינה",
      "tips": "טיפים"
    },
    "soil": {
      "type": "סוג אדמה/מצע מומלץ",
      "drainage": "דרישות ניקוז",
      "ph": "רמת pH מומלצת",
      "amendments": "תוספות מומלצות",
      "tips": "טיפים"
    },
    "temperature": {
      "idealMin": 15,
      "idealMax": 25,
      "absoluteMin": 5,
      "absoluteMax": 35,
      "description": "תיאור דרישות טמפרטורה",
      "frostTolerance": "עמידות בכפור",
      "tips": "טיפים"
    },
    "humidity": {
      "level": "low|medium|high",
      "percentage": "30-50%",
      "tips": "איך לשמור על לחות מתאימה"
    },
    "fertilizer": {
      "type": "סוג דשן מומלץ",
      "npk": "יחס NPK מומלץ",
      "frequency": "תדירות דישון",
      "season": "עונת דישון",
      "tips": "טיפים"
    },
    "pruning": {
      "needed": true,
      "when": "מתי לגזום",
      "how": "הוראות גיזום",
      "tips": "טיפים"
    },
    "repotting": {
      "frequency": "תדירות החלפת עציץ",
      "signs": "סימנים שצריך להחליף",
      "bestSeason": "עונה מומלצת",
      "tips": "טיפים"
    }
  },
  "toxicity": {
    "forPets": {
      "toxic": false,
      "level": "none|mild|moderate|severe",
      "details": "פרטים",
      "symptoms": "סימפטומים במקרה של חשיפה"
    },
    "forHumans": {
      "toxic": false,
      "level": "none|mild|moderate|severe",
      "details": "פרטים",
      "symptoms": "סימפטומים במקרה של חשיפה"
    }
  },
  "seasonalCare": {
    "spring": "המלצות לאביב",
    "summer": "המלצות לקיץ",
    "autumn": "המלצות לסתיו",
    "winter": "המלצות לחורף",
    "israelSpecific": "טיפים ספציפיים לאקלים הישראלי"
  },
  "propagation": {
    "methods": ["שיטת ריבוי 1"],
    "bestMethod": "השיטה המומלצת",
    "difficulty": "easy|medium|hard",
    "instructions": "הוראות קצרות"
  },
  "companionPlants": ["צמח משלים 1", "צמח משלים 2"],
  "funFacts": ["עובדה מעניינת 1", "עובדה מעניינת 2"]
}`;

async function analyzeWithClaude(imageBase64, mimetype) {
  const mediaType = mimetype === 'image/png' ? 'image/png'
    : mimetype === 'image/webp' ? 'image/webp'
    : mimetype === 'image/gif' ? 'image/gif'
    : 'image/jpeg';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
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
            text: ANALYSIS_PROMPT
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

  const text = textBlock.text.trim();
  let jsonStr = text;

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  } else {
    const braceStart = text.indexOf('{');
    const braceEnd = text.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
      jsonStr = text.substring(braceStart, braceEnd + 1);
    }
  }

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('Failed to parse Claude response (first 500 chars):', text.substring(0, 500));
    console.error('Parse error:', e.message);
    throw new Error('שגיאה בפענוח תשובת הניתוח. נסו שוב.');
  }
}

module.exports = { analyzeWithClaude };
