const axios = require('axios');
const FormData = require('form-data');

async function identifyWithPlantNet(imageBuffer) {
  const apiKey = process.env.PLANTNET_API_KEY;
  if (!apiKey || apiKey === 'your_plantnet_api_key_here') {
    return null;
  }

  const form = new FormData();
  form.append('images', imageBuffer, { filename: 'plant.jpg', contentType: 'image/jpeg' });
  form.append('organs', 'auto');

  const url = `https://my-api.plantnet.org/v2/identify/all?include-related-images=false&no-reject=false&nb-results=5&lang=he&type=kt&api-key=${apiKey}`;

  const response = await axios.post(url, form, {
    headers: form.getHeaders(),
    timeout: 30000
  });

  if (!response.data || !response.data.results) {
    return null;
  }

  return {
    results: response.data.results.map(r => ({
      score: Math.round(r.score * 100) / 100,
      species: {
        scientificNameWithoutAuthor: r.species?.scientificNameWithoutAuthor || '',
        scientificNameAuthorship: r.species?.scientificNameAuthorship || '',
        scientificName: r.species?.scientificName || '',
        commonNames: r.species?.commonNames || [],
        genus: r.species?.genus?.scientificNameWithoutAuthor || '',
        family: r.species?.family?.scientificNameWithoutAuthor || ''
      }
    })),
    bestMatch: response.data.bestMatch || null,
    remainingIdentificationRequests: response.data.remainingIdentificationRequests
  };
}

module.exports = { identifyWithPlantNet };
