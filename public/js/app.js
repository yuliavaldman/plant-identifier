document.addEventListener('DOMContentLoaded', () => {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
  const cameraInput = document.getElementById('cameraInput');
  const cameraBtn = document.getElementById('cameraBtn');
  const previewArea = document.getElementById('previewArea');
  const previewImage = document.getElementById('previewImage');
  const clearBtn = document.getElementById('clearBtn');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const uploadSection = document.getElementById('uploadSection');
  const loadingSection = document.getElementById('loadingSection');
  const resultsSection = document.getElementById('resultsSection');
  const errorSection = document.getElementById('errorSection');
  const newScanBtn = document.getElementById('newScanBtn');
  const retryBtn = document.getElementById('retryBtn');

  let selectedFile = null;

  // Drag and drop
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      handleFile(files[0]);
    }
  });

  uploadArea.addEventListener('click', (e) => {
    if (e.target.closest('.btn')) return;
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  cameraBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // On mobile, create a fresh input each time to ensure camera opens
    const tempInput = document.createElement('input');
    tempInput.type = 'file';
    tempInput.accept = 'image/*';
    tempInput.capture = 'environment';
    tempInput.addEventListener('change', (ev) => {
      if (ev.target.files.length > 0) {
        handleFile(ev.target.files[0]);
      }
    });
    tempInput.click();
  });

  cameraInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  clearBtn.addEventListener('click', resetUpload);
  analyzeBtn.addEventListener('click', analyzeImage);
  newScanBtn.addEventListener('click', resetToUpload);
  retryBtn.addEventListener('click', resetToUpload);

  function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      showError('סוג קובץ לא נתמך', 'יש להעלות תמונה בפורמט JPEG, PNG או WebP');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showError('קובץ גדול מדי', 'גודל הקובץ המרבי הוא 15MB');
      return;
    }

    selectedFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImage.src = e.target.result;
      uploadArea.hidden = true;
      previewArea.hidden = false;
    };
    reader.readAsDataURL(file);
  }

  function resetUpload() {
    selectedFile = null;
    fileInput.value = '';
    cameraInput.value = '';
    previewImage.src = '';
    uploadArea.hidden = false;
    previewArea.hidden = true;
  }

  function resetToUpload() {
    resetUpload();
    showSection('upload');
  }

  function showSection(section) {
    uploadSection.hidden = section !== 'upload';
    loadingSection.hidden = section !== 'loading';
    resultsSection.hidden = section !== 'results';
    errorSection.hidden = section !== 'error';

    if (section === 'results' || section === 'error') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function showError(title, message) {
    document.getElementById('errorTitle').textContent = title;
    document.getElementById('errorMessage').textContent = message;
    showSection('error');
  }

  async function analyzeImage() {
    if (!selectedFile) return;

    analyzeBtn.disabled = true;
    showSection('loading');

    const steps = ['step1', 'step2', 'step3', 'step4'];
    const stepLabels = ['מזהה את הצמח', 'בודק מחלות ומזיקים', 'מנתח תנאי גידול', 'מכין המלצות טיפול'];
    let currentStep = 0;

    const stepInterval = setInterval(() => {
      if (currentStep > 0 && currentStep <= steps.length) {
        const prev = document.getElementById(steps[currentStep - 1]);
        prev.classList.remove('active');
        prev.classList.add('done');
        prev.textContent = '✅ ' + stepLabels[currentStep - 1];
      }
      if (currentStep < steps.length) {
        document.getElementById(steps[currentStep]).classList.add('active');
        currentStep++;
      } else {
        document.getElementById('loadingText').textContent = 'עדיין מעבד... זה יכול לקחת עד 30 שניות';
      }
    }, 5000);

    try {
      const formData = new FormData();
      formData.append('image', selectedFile);

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData
      });

      clearInterval(stepInterval);

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'שגיאה בניתוח התמונה');
      }

      const data = await response.json();

      if (data.analysis && !data.analysis.isPlant) {
        showError(
          'לא זוהה צמח',
          data.analysis.notPlantMessage || 'התמונה אינה מכילה צמח. נסו לצלם תמונה של צמח.'
        );
        analyzeBtn.disabled = false;
        return;
      }

      renderResults(data);
      saveToHistory(data);
      showSection('results');
    } catch (error) {
      clearInterval(stepInterval);
      showError('שגיאה', error.message);
    }

    analyzeBtn.disabled = false;
  }

  function renderResults(data) {
    const analysis = data.analysis;
    if (!analysis) return;

    renderIdentification(analysis);
    renderCrossReference(data.crossReference);
    renderHealth(analysis);
    renderIssues(analysis);
    renderCare(analysis);
    renderToxicity(analysis);
    renderSeasonal(analysis);
    renderExtras(analysis);
  }

  function renderIdentification(a) {
    const id = a.identification;
    if (!id) return;

    const conf = id.confidence || 0;
    const badge = document.getElementById('confidenceBadge');
    const confPct = Math.round(conf * 100);
    badge.textContent = `${confPct}% ודאות`;
    badge.className = 'confidence-badge ' +
      (conf >= 0.7 ? 'confidence-high' : conf >= 0.4 ? 'confidence-medium' : 'confidence-low');

    let html = `
      <div class="plant-name">${esc(id.commonNameHe || id.commonNameEn || 'לא ידוע')}</div>
      <div class="scientific-name">${esc(id.scientificName || '')}</div>
      <div class="plant-family">${esc(id.familyHe || '')} (${esc(id.family || '')})</div>
      <div class="plant-description">${esc(id.description || '')}</div>
    `;

    if (id.commonNameEn && id.commonNameHe) {
      html += `<div style="color:var(--text-muted);font-size:0.9rem;margin-bottom:8px">English: ${esc(id.commonNameEn)}</div>`;
    }

    if (id.origin) {
      html += `<div style="color:var(--text-muted);font-size:0.9rem;margin-bottom:8px">מוצא: ${esc(id.origin)}</div>`;
    }

    if (id.alternativeMatches && id.alternativeMatches.length > 0) {
      html += `<div class="alt-matches"><h4>זיהויים חלופיים אפשריים:</h4>`;
      for (const alt of id.alternativeMatches) {
        const altConf = Math.round((alt.confidence || 0) * 100);
        html += `
          <div class="alt-match-item">
            <div>
              <span class="alt-match-name">${esc(alt.commonNameHe || alt.commonNameEn || '')}</span>
              <span style="color:var(--text-muted);font-style:italic;margin-right:8px">${esc(alt.scientificName || '')}</span>
            </div>
            <span class="alt-match-conf">${altConf}%</span>
          </div>`;
        if (alt.differentiatingFeature) {
          html += `<div style="font-size:0.8rem;color:var(--text-light);padding:0 12px 6px">↳ ${esc(alt.differentiatingFeature)}</div>`;
        }
      }
      html += `</div>`;
    }

    document.getElementById('identificationBody').innerHTML = html;
  }

  function renderCrossReference(cr) {
    const card = document.getElementById('crossRefCard');
    const body = document.getElementById('crossRefBody');

    if (!cr || !cr.available) {
      card.hidden = true;
      return;
    }

    card.hidden = false;
    const matchIcons = { species: '✅', genus: '🔶', none: '❌' };
    const icon = matchIcons[cr.matchLevel] || '❓';

    let html = `
      <div class="cross-ref-match">
        <div class="match-icon">${icon}</div>
        <div class="match-info">
          <div class="match-status">${esc(cr.agreementMessage)}</div>
          <div class="match-detail">רמת ודאות משולבת: ${Math.round((cr.combinedConfidence || 0) * 100)}%</div>
        </div>
      </div>`;

    if (cr.plantNetTopResult) {
      const pn = cr.plantNetTopResult;
      html += `
        <div class="cross-ref-match">
          <div class="match-icon">🌿</div>
          <div class="match-info">
            <div class="match-status">PlantNet: ${esc(pn.name || '')}</div>
            <div class="match-detail">
              ציון: ${Math.round((pn.score || 0) * 100)}%
              ${pn.commonNames.length > 0 ? ' — ' + esc(pn.commonNames.join(', ')) : ''}
            </div>
          </div>
        </div>`;
    }

    body.innerHTML = html;
  }

  function renderHealth(a) {
    const h = a.healthAssessment;
    if (!h) return;

    const badge = document.getElementById('healthBadge');
    const labels = {
      excellent: 'מצוין', good: 'טוב', fair: 'סביר', poor: 'גרוע', critical: 'קריטי'
    };
    badge.textContent = labels[h.overallHealth] || h.overallHealth;
    badge.className = 'health-badge health-' + (h.overallHealth || 'fair');

    const score = h.healthScore || 50;
    const scoreClass = score >= 70 ? 'score-high' : score >= 40 ? 'score-medium' : 'score-low';

    let html = `
      <div style="font-weight:600;margin-bottom:4px">ציון בריאות: ${score}/100</div>
      <div class="health-score-bar">
        <div class="health-score-fill ${scoreClass}" style="width:${score}%"></div>
      </div>
      <p>${esc(h.summary || '')}</p>
    `;

    if (h.positivesigns && h.positivesigns.length > 0) {
      html += `<div class="health-details-list" style="margin-top:12px">`;
      for (const s of h.positivesigns) {
        html += `<div class="health-detail-item">✅ ${esc(s)}</div>`;
      }
      html += `</div>`;
    }

    if (h.concerns && h.concerns.length > 0) {
      html += `<div class="health-details-list" style="margin-top:8px">`;
      for (const c of h.concerns) {
        html += `<div class="health-detail-item">⚠️ ${esc(c)}</div>`;
      }
      html += `</div>`;
    }

    document.getElementById('healthBody').innerHTML = html;
  }

  function renderIssues(a) {
    const card = document.getElementById('issuesCard');
    const body = document.getElementById('issuesBody');

    if (!a.issues || a.issues.length === 0) {
      card.hidden = true;
      return;
    }

    card.hidden = false;
    const typeIcons = {
      disease: '🦠', pest: '🐛', nutrient: '🧪', environmental: '🌡️', watering: '💧'
    };

    let html = '';
    for (const issue of a.issues) {
      const icon = typeIcons[issue.type] || '⚠️';
      html += `
        <div class="issue-item">
          <div class="issue-header">
            <span class="issue-name">${icon} ${esc(issue.name || '')}</span>
            <span class="severity-badge severity-${issue.severity || 'medium'}">${
              {low: 'נמוך', medium: 'בינוני', high: 'גבוה', critical: 'קריטי'}[issue.severity] || issue.severity
            }</span>
          </div>
          <p class="issue-description">${esc(issue.description || '')}</p>`;

      if (issue.visibleSymptoms && issue.visibleSymptoms.length > 0) {
        html += `<div class="issue-subsection"><h5>סימפטומים נראים:</h5><ul>`;
        for (const s of issue.visibleSymptoms) html += `<li>${esc(s)}</li>`;
        html += `</ul></div>`;
      }

      if (issue.treatment) {
        const t = issue.treatment;
        html += `<div class="issue-subsection"><h5>טיפול:</h5>`;
        if (t.immediate) html += `<p><strong>מיידי:</strong> ${esc(t.immediate)}</p>`;
        if (t.ongoing) html += `<p><strong>מתמשך:</strong> ${esc(t.ongoing)}</p>`;
        if (t.products) html += `<p><strong>מוצרים מומלצים:</strong> ${esc(t.products)}</p>`;
        html += `</div>`;
      }

      if (issue.prevention) {
        html += `<div class="issue-subsection"><h5>מניעה:</h5><p>${esc(issue.prevention)}</p></div>`;
      }

      if (issue.urgency) {
        html += `<div class="issue-subsection"><h5>דחיפות:</h5><p>${esc(issue.urgency)}</p></div>`;
      }

      html += `</div>`;
    }

    body.innerHTML = html;
  }

  function renderCare(a) {
    const care = a.careRecommendations;
    if (!care) return;

    const items = [
      { key: 'water', icon: '💧', title: 'השקיה', fields: ['frequency', 'amount', 'method', 'tips'] },
      { key: 'light', icon: '☀️', title: 'תאורה', fields: ['description', 'hours', 'placement', 'tips'] },
      { key: 'soil', icon: '🪴', title: 'אדמה', fields: ['type', 'drainage', 'ph', 'tips'] },
      { key: 'temperature', icon: '🌡️', title: 'טמפרטורה', fields: ['description', 'frostTolerance', 'tips'] },
      { key: 'humidity', icon: '💨', title: 'לחות', fields: ['percentage', 'tips'] },
      { key: 'fertilizer', icon: '🧪', title: 'דישון', fields: ['type', 'frequency', 'season', 'tips'] },
      { key: 'pruning', icon: '✂️', title: 'גיזום', fields: ['when', 'how', 'tips'] },
      { key: 'repotting', icon: '🏺', title: 'החלפת עציץ', fields: ['frequency', 'signs', 'bestSeason', 'tips'] }
    ];

    const fieldLabels = {
      frequency: 'תדירות', amount: 'כמות', method: 'שיטה', tips: 'טיפ',
      description: 'תיאור', hours: 'שעות', placement: 'מיקום',
      type: 'סוג', drainage: 'ניקוז', ph: 'pH', amendments: 'תוספות',
      frostTolerance: 'עמידות בכפור',
      percentage: 'אחוז',
      npk: 'NPK', season: 'עונה',
      when: 'מתי', how: 'איך',
      signs: 'סימנים', bestSeason: 'עונה מומלצת'
    };

    let html = '<div class="care-grid">';
    for (const item of items) {
      const data = care[item.key];
      if (!data) continue;

      html += `
        <div class="care-item">
          <div class="care-item-header">
            <span class="care-item-icon">${item.icon}</span>
            ${item.title}
          </div>`;

      for (const field of item.fields) {
        const val = data[field];
        if (!val) continue;
        if (field === 'tips') {
          html += `<div class="care-tip">${esc(val)}</div>`;
        } else {
          html += `<div class="care-detail"><strong>${fieldLabels[field] || field}:</strong> ${esc(String(val))}</div>`;
        }
      }

      if (item.key === 'temperature' && data.idealMin != null && data.idealMax != null) {
        html += `<div class="care-detail"><strong>טווח אידאלי:</strong> ${data.idealMin}°C — ${data.idealMax}°C</div>`;
      }

      html += `</div>`;
    }
    html += '</div>';

    document.getElementById('careBody').innerHTML = html;
  }

  function renderToxicity(a) {
    const tox = a.toxicity;
    if (!tox) return;

    const pets = tox.forPets || {};
    const humans = tox.forHumans || {};

    let html = '<div class="toxicity-grid">';

    html += `
      <div class="toxicity-item ${pets.toxic ? 'toxicity-danger' : 'toxicity-safe'}">
        <div class="toxicity-icon">${pets.toxic ? '🐾⚠️' : '🐾✅'}</div>
        <div class="toxicity-label">חיות מחמד</div>
        <div class="toxicity-details">${esc(pets.details || (pets.toxic ? 'רעיל' : 'לא רעיל'))}</div>
        ${pets.symptoms ? `<div class="toxicity-details" style="margin-top:4px;font-size:0.8rem">${esc(pets.symptoms)}</div>` : ''}
      </div>`;

    html += `
      <div class="toxicity-item ${humans.toxic ? 'toxicity-danger' : 'toxicity-safe'}">
        <div class="toxicity-icon">${humans.toxic ? '👤⚠️' : '👤✅'}</div>
        <div class="toxicity-label">בני אדם</div>
        <div class="toxicity-details">${esc(humans.details || (humans.toxic ? 'רעיל' : 'לא רעיל'))}</div>
        ${humans.symptoms ? `<div class="toxicity-details" style="margin-top:4px;font-size:0.8rem">${esc(humans.symptoms)}</div>` : ''}
      </div>`;

    html += '</div>';
    document.getElementById('toxicityBody').innerHTML = html;
  }

  function renderSeasonal(a) {
    const s = a.seasonalCare;
    if (!s) return;

    const seasons = [
      { key: 'spring', icon: '🌸', name: 'אביב' },
      { key: 'summer', icon: '☀️', name: 'קיץ' },
      { key: 'autumn', icon: '🍂', name: 'סתיו' },
      { key: 'winter', icon: '❄️', name: 'חורף' }
    ];

    let html = '<div class="seasonal-grid">';
    for (const season of seasons) {
      if (!s[season.key]) continue;
      html += `
        <div class="season-item">
          <div class="season-name">${season.icon} ${season.name}</div>
          <div class="season-info">${esc(s[season.key])}</div>
        </div>`;
    }
    html += '</div>';

    if (s.israelSpecific) {
      html += `
        <div class="israel-specific">
          <h4>🇮🇱 טיפים לאקלים הישראלי</h4>
          <p>${esc(s.israelSpecific)}</p>
        </div>`;
    }

    document.getElementById('seasonalBody').innerHTML = html;
  }

  function renderExtras(a) {
    let html = '';

    if (a.funFacts && a.funFacts.length > 0) {
      html += '<div class="fun-facts">';
      for (const fact of a.funFacts) {
        html += `
          <div class="fun-fact">
            <span class="fun-fact-icon">🌟</span>
            <span>${esc(fact)}</span>
          </div>`;
      }
      html += '</div>';
    }

    if (a.companionPlants && a.companionPlants.length > 0) {
      html += `
        <div class="companion-plants">
          <h4>🌱 צמחים משלימים</h4>
          <div class="companion-tags">`;
      for (const p of a.companionPlants) {
        html += `<span class="companion-tag">${esc(p)}</span>`;
      }
      html += `</div></div>`;
    }

    if (a.propagation) {
      const prop = a.propagation;
      html += `
        <div class="propagation-section">
          <h4>🌱 ריבוי</h4>`;
      if (prop.bestMethod) html += `<p><strong>שיטה מומלצת:</strong> ${esc(prop.bestMethod)}</p>`;
      if (prop.difficulty) {
        const diff = { easy: 'קל', medium: 'בינוני', hard: 'מתקדם' };
        html += `<p><strong>רמת קושי:</strong> ${esc(diff[prop.difficulty] || prop.difficulty)}</p>`;
      }
      if (prop.instructions) html += `<p>${esc(prop.instructions)}</p>`;
      html += `</div>`;
    }

    document.getElementById('extrasBody').innerHTML = html || '<p style="color:var(--text-muted)">אין מידע נוסף זמין</p>';
  }

  // History management
  function saveToHistory(data) {
    const a = data.analysis;
    if (!a || !a.identification) return;

    try {
      const history = JSON.parse(localStorage.getItem('plantHistory') || '[]');

      let thumbnail = '';
      if (selectedFile) {
        const canvas = document.createElement('canvas');
        const img = document.getElementById('previewImage');
        canvas.width = 80;
        canvas.height = 80;
        const ctx = canvas.getContext('2d');
        const size = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - size) / 2;
        const sy = (img.naturalHeight - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 80, 80);
        thumbnail = canvas.toDataURL('image/jpeg', 0.6);
      }

      history.unshift({
        id: Date.now(),
        name: a.identification.commonNameHe || a.identification.commonNameEn || 'לא ידוע',
        scientific: a.identification.scientificName || '',
        health: a.healthAssessment?.overallHealth || '',
        confidence: a.identification.confidence || 0,
        thumbnail,
        date: new Date().toLocaleDateString('he-IL'),
        data
      });

      if (history.length > 20) history.length = 20;
      localStorage.setItem('plantHistory', JSON.stringify(history));
      renderHistory();
    } catch (e) {
      // localStorage unavailable or full
    }
  }

  function renderHistory() {
    const list = document.getElementById('historyList');
    let history;
    try {
      history = JSON.parse(localStorage.getItem('plantHistory') || '[]');
    } catch (e) {
      history = [];
    }

    if (history.length === 0) {
      list.innerHTML = '<p class="history-empty">טרם בוצעו סריקות</p>';
      return;
    }

    let html = '';
    for (const item of history) {
      html += `
        <div class="history-item" data-id="${item.id}">
          ${item.thumbnail ? `<img class="history-thumb" src="${item.thumbnail}" alt="${esc(item.name)}">` : ''}
          <div class="history-info">
            <div class="history-name">${esc(item.name)}</div>
            <div class="history-date">${esc(item.scientific)} — ${esc(item.date)}</div>
          </div>
          <div class="history-actions">
            <button class="history-delete" data-id="${item.id}" title="מחק">✕</button>
          </div>
        </div>`;
    }

    list.innerHTML = html;

    list.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.history-delete')) return;
        const id = parseInt(el.dataset.id);
        const entry = history.find(h => h.id === id);
        if (entry && entry.data) {
          renderResults(entry.data);
          showSection('results');
        }
      });
    });

    list.querySelectorAll('.history-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        try {
          const h = JSON.parse(localStorage.getItem('plantHistory') || '[]');
          const filtered = h.filter(item => item.id !== id);
          localStorage.setItem('plantHistory', JSON.stringify(filtered));
          renderHistory();
        } catch (err) {
          // ignore
        }
      });
    });
  }

  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // Card toggle (collapse/expand)
  document.querySelectorAll('.card-header').forEach(header => {
    header.addEventListener('click', () => {
      const body = header.nextElementSibling;
      if (!body || !body.classList.contains('card-body')) return;
      const isCollapsed = body.style.display === 'none';
      body.style.display = isCollapsed ? '' : 'none';
      header.classList.toggle('collapsed', !isCollapsed);
    });
  });

  // Check API status on load
  async function checkApiStatus() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (!data.anthropicKey) {
        const note = document.querySelector('.upload-note');
        note.textContent = '⚠️ מפתח API לא הוגדר — יש להגדיר ANTHROPIC_API_KEY בקובץ .env';
        note.style.color = '#d32f2f';
        note.style.fontWeight = '600';
      }
    } catch (e) {
      // server not ready yet
    }
  }

  checkApiStatus();
  renderHistory();
});
