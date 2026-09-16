const axios = require('axios');

async function verifyWithWikipedia(scientificName) {
  if (!scientificName) return null;

  try {
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(scientificName)}&language=en&format=json&limit=3&type=item`;
    const searchRes = await axios.get(searchUrl, { timeout: 5000 });

    if (!searchRes.data.search || searchRes.data.search.length === 0) {
      return { verified: false, reason: 'not_found' };
    }

    const ids = searchRes.data.search.map(item => item.id).join('|');
    const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=claims|labels|descriptions&languages=en|he&format=json`;
    const entityRes = await axios.get(entityUrl, { timeout: 5000 });

    const entities = entityRes.data.entities || {};

    for (const item of searchRes.data.search) {
      const entity = entities[item.id];
      if (!entity) continue;

      const claims = entity.claims || {};

      const instanceOf = claims.P31 || [];
      const isTaxon = instanceOf.some(c =>
        c.mainsnak?.datavalue?.value?.id === 'Q16521'
      );
      if (!isTaxon) continue;

      const taxonNameClaim = claims.P225?.[0];
      const taxonName = taxonNameClaim?.mainsnak?.datavalue?.value || '';

      const imageClaim = claims.P18?.[0];
      const imageFile = imageClaim?.mainsnak?.datavalue?.value || null;

      const heLabel = entity.labels?.he?.value || null;
      const enLabel = entity.labels?.en?.value || null;
      const heDesc = entity.descriptions?.he?.value || null;

      return {
        verified: true,
        wikidataId: item.id,
        taxonName,
        hebrewName: heLabel,
        englishName: enLabel,
        hebrewDescription: heDesc,
        hasImage: !!imageFile
      };
    }

    return { verified: false, reason: 'no_taxon_match' };
  } catch (error) {
    console.error('Wikipedia verification error:', error.message);
    return null;
  }
}

module.exports = { verifyWithWikipedia };
