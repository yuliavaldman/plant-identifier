const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

const ANALYSIS_PROMPT = `You are an expert botanist. Identify this plant and assess its health.
Return ONLY valid JSON (no markdown fences). All text values in Hebrew. Be concise.
If not a plant, return {"isPlant":false,"notPlantMessage":"הסבר"}.

Identify by analyzing: leaf shape/margin/arrangement, stem type, flowers/fruits if visible, growth habit.
Consider Israeli/Mediterranean climate for care tips.

CRITICAL IDENTIFICATION RULES:
- Examine diagnostic features carefully before choosing between similar species
- If two or more species are plausible, give them SIMILAR confidence scores (within 0.1 of each other) — do not artificially inflate the top pick
- If unsure of exact species, stay at genus level and set confidence below 0.7
- Always list at least 2 alternatives with honest confidence scores
- Common Israeli garden/houseplants: Bougainvillea, Plumbago, Lantana, Jasmine, Ficus, Citrus, Olive, Rosemary, Geranium — check these first

JSON structure:
{
  "isPlant": true,
  "identification": {
    "commonNameHe": "שם בעברית",
    "commonNameEn": "English name",
    "scientificName": "Genus species",
    "family": "Family",
    "confidence": 0.85,
    "description": "תיאור קצר 1-2 משפטים",
    "alternativeMatches": [{"scientificName":"..","commonNameHe":"..","confidence":0.5,"differentiatingFeature":"מה מבדיל"}]
  },
  "healthAssessment": {
    "overallHealth": "excellent|good|fair|poor|critical",
    "healthScore": 80,
    "summary": "סיכום קצר"
  },
  "issues": [{"name":"שם הבעיה","severity":"low|medium|high","description":"תיאור","treatment":"טיפול מומלץ"}],
  "careRecommendations": {
    "water": "תדירות וכמות השקיה",
    "light": "דרישות אור ומיקום",
    "soil": "סוג אדמה",
    "temperature": "טווח טמפרטורות",
    "fertilizer": "דישון",
    "pruning": "גיזום"
  },
  "toxicity": {
    "forPets": {"toxic":false,"details":"פרטים"},
    "forHumans": {"toxic":false,"details":"פרטים"}
  },
  "seasonalCare": {"spring":"..","summer":"..","autumn":"..","winter":".."},
  "funFacts": ["עובדה 1","עובדה 2"]
}`;

async function analyzeWithClaude(imageBase64, mimetype) {
  const mediaType = mimetype === 'image/png' ? 'image/png'
    : mimetype === 'image/webp' ? 'image/webp'
    : mimetype === 'image/gif' ? 'image/gif'
    : 'image/jpeg';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
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
    throw new Error('שגיאה בפענוח תשובת הניתוח. נסו שוב.');
  }
}

module.exports = { analyzeWithClaude };
