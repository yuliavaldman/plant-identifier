const axios = require('axios');

async function verifyWithWikipedia(scientificName) {
  if (!scientificName) return null;

  try {
    // Search Wikidata for the scientific name
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(scientificName)}&language=en&format=json&limit=3&type=item`;
    const searchRes = await axios.get(searchUrl, { timeout: 8000 });

    if (!searchRes.data.search || searchRes.data.search.length === 0) {
      return { verified: false, reason: 'not_found' };
    }

    // Check each result to find a taxon (plant)
    for (const item of searchRes.data.search) {
      const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${item.id}&props=claims|labels|descriptions&languages=en|he&format=json`;
      const entityRes = await axios.get(entityUrl, { timeout: 8000 });
      const entity = entityRes.data.entities?.[item.id];
      if (!entity) continue;

      const claims = entity.claims || {};

      // P31 = "instance of", Q16521 = "taxon"
      const instanceOf = claims.P31 || [];
      const isTaxon = instanceOf.some(c =>
        c.mainsnak?.datavalue?.value?.id === 'Q16521'
      );
      if (!isTaxon) continue;

      // P225 = taxon name
      const taxonNameClaim = claims.P225?.[0];
      const taxonName = taxonNameClaim?.mainsnak?.datavalue?.value || '';

      // P171 = parent taxon (to get family)
      // P105 = taxon rank
      const rankClaim = claims.P105?.[0];
      const rankId = rankClaim?.mainsnak?.datavalue?.value?.id || '';

      // P18 = image on Wikimedia Commons
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
