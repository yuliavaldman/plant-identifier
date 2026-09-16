document.addEventListener('DOMContentLoaded', () => {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
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
  const benefitsSection = document.getElementById('benefitsSection');
  const howSection = document.getElementById('howSection');
  const historySection = document.getElementById('historySection');

  let selectedFile = null;
  let currentJobId = null;
  let currentAnalysisData = null;

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

  const cameraInput = document.getElementById('cameraInput');
  if (cameraInput) {
    cameraInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
      }
    });
  }

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
      uploadSection.hidden = false;
    };
    reader.readAsDataURL(file);
  }

  function resetUpload() {
    selectedFile = null;
    fileInput.value = '';
    previewImage.src = '';
    uploadArea.hidden = true;
    previewArea.hidden = true;
    uploadSection.hidden = true;
  }

  function resetToUpload() {
    resetUpload();
    currentJobId = null;
    currentAnalysisData = null;
    followUpSelectedFile = null;
    const refCard = document.getElementById('refinementCard');
    if (refCard) refCard.hidden = true;
    const refResult = document.getElementById('refinementResultCard');
    if (refResult) refResult.hidden = true;
    const fuImgCard = document.getElementById('followUpImageCard');
    if (fuImgCard) fuImgCard.hidden = true;
    const fuImgResult = document.getElementById('followUpImageResultCard');
    if (fuImgResult) fuImgResult.hidden = true;
    showSection('upload');
  }

  function showSection(section) {
    uploadSection.hidden = !(section === 'upload' && selectedFile);
    loadingSection.hidden = section !== 'loading';
    resultsSection.hidden = section !== 'results';
    errorSection.hidden = section !== 'error';

    const isHome = section === 'upload';
    if (benefitsSection) benefitsSection.hidden = !isHome;
    if (howSection) howSection.hidden = !isHome;
    if (historySection) historySection.hidden = !isHome;

    if (section === 'results' || section === 'error') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function showError(title, message) {
    document.getElementById('errorTitle').textContent = title;
    document.getElementById('errorMessage').textContent = message;
    const suggestionsEl = document.getElementById('errorSuggestions');
    if (suggestionsEl) suggestionsEl.hidden = true;
    showSection('error');
  }

  // Friendly display for insufficient_image with photo suggestions
  function showInsufficientImage(analysis) {
    const reason = analysis.reason || analysis.message || 'לא ניתן לזהות את הצמח מהתמונה הנוכחית.';
    document.getElementById('errorTitle').textContent = 'דרושה תמונה טובה יותר';
    document.getElementById('errorMessage').textContent = reason;

    const suggestionsEl = document.getElementById('errorSuggestions');
    if (suggestionsEl) {
      const photos = analysis.suggestedPhotos || [];
      if (photos.length > 0) {
        let html = '<div class="suggested-photos"><h4>💡 מה יעזור לזיהוי:</h4><ul>';
        for (const photo of photos) {
          html += `<li>📷 ${esc(photo)}</li>`;
        }
        html += '</ul></div>';
        suggestionsEl.innerHTML = html;
        suggestionsEl.hidden = false;
      } else {
        suggestionsEl.hidden = true;
      }
    }

    const errorIcon = document.querySelector('.error-icon');
    if (errorIcon) errorIcon.textContent = '📸';

    showSection('error');
  }

  function resetLoadingState() {
    const steps = ['step1', 'step2', 'step3', 'step4'];
    const icons = ['🔍', '🔬', '🌡️', '📋'];
    steps.forEach((id, i) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('active', 'done');
      const iconEl = document.getElementById(id + 'Icon');
      if (iconEl) iconEl.textContent = icons[i];
    });
    const progressFill = document.getElementById('loadingProgressFill');
    if (progressFill) progressFill.style.width = '0%';
    const loadingText = document.getElementById('loadingText');
    if (loadingText) loadingText.textContent = 'מעלה תמונה...';
    const loadingSub = document.getElementById('loadingSub');
    if (loadingSub) loadingSub.textContent = 'זיהוי מינים, בדיקת בריאות וניתוח מחלות';
  }

  async function analyzeImage() {
    if (!selectedFile) return;

    analyzeBtn.disabled = true;
    analyzeBtn.classList.add('btn-loading');
    resetLoadingState();
    showSection('loading');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const steps = ['step1', 'step2', 'step3', 'step4'];
    const stepLabels = ['מזהה את הצמח', 'בודק מחלות ומזיקים', 'מנתח תנאי גידול', 'מכין המלצות טיפול'];
    const loadingMessages = [
      'מעלה תמונה...',
      'מזהה את הצמח...',
      'בודק מחלות ומזיקים...',
      'מנתח תנאי גידול...',
      'מכין המלצות...',
      'מעמיק בניתוח...',
      'כמעט שם...'
    ];
    let currentStep = 0;
    let msgIdx = 0;
    let elapsedSeconds = 0;

    const progressFill = document.getElementById('loadingProgressFill');
    const timerEl = document.getElementById('loadingTimer');
    if (timerEl) timerEl.textContent = '';

    const timerInterval = setInterval(() => {
      elapsedSeconds++;
      if (timerEl && elapsedSeconds >= 3) timerEl.textContent = elapsedSeconds + ' שניות';
      if (progressFill) {
        const pct = Math.min(92, 8 + elapsedSeconds * 1.4);
        progressFill.style.width = pct + '%';
      }
    }, 1000);

    const stepInterval = setInterval(() => {
      if (currentStep > 0 && currentStep <= steps.length) {
        const prev = document.getElementById(steps[currentStep - 1]);
        if (prev) {
          prev.classList.remove('active');
          prev.classList.add('done');
          const prevIcon = document.getElementById(steps[currentStep - 1] + 'Icon');
          if (prevIcon) prevIcon.textContent = '✅';
        }
      }
      if (currentStep < steps.length) {
        const cur = document.getElementById(steps[currentStep]);
        if (cur) cur.classList.add('active');
        currentStep++;
      }
      msgIdx++;
      const loadingText = document.getElementById('loadingText');
      if (loadingText) loadingText.textContent = loadingMessages[Math.min(msgIdx, loadingMessages.length - 1)];
    }, 2500);

    try {
      const formData = new FormData();
      formData.append('image', selectedFile);

      const uploadRes = await fetch(PlantDocConfig.API_BASE_URL + '/api/analyze', {
        method: 'POST',
        body: formData
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(err.error || 'שגיאה בהעלאת התמונה');
      }

      const { jobId, error: uploadError } = await uploadRes.json();
      if (uploadError) throw new Error(uploadError);
      if (!jobId) throw new Error('שגיאה בתחילת הניתוח');

      let stage1Rendered = false;
      const data = await new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 120;

        const poll = setInterval(async () => {
          attempts++;
          try {
            const pollRes = await fetch(PlantDocConfig.API_BASE_URL + '/api/result/' + jobId);
            const result = await pollRes.json();

            if (result.status === 'partial' && !stage1Rendered) {
              stage1Rendered = true;
              clearInterval(stepInterval);
              clearInterval(timerInterval);
              if (progressFill) progressFill.style.width = '90%';

              const s = result.analysis?.status;
              if (s === 'not_a_plant' || s === 'insufficient_image' || (result.analysis && result.analysis.isPlant === false)) {
                clearInterval(poll);
                resolve(result);
                return;
              }

              currentJobId = result.jobId || null;
              currentAnalysisData = result;
              renderResults(result);
              showSection('results');

              const enrichEl = document.getElementById('enrichmentLoading');
              if (enrichEl) enrichEl.hidden = false;
            } else if (result.status === 'done') {
              clearInterval(poll);
              resolve(result);
            } else if (result.status === 'error') {
              clearInterval(poll);
              reject(new Error(result.error || 'שגיאה בניתוח'));
            } else if (result.status === 'not_found') {
              clearInterval(poll);
              reject(new Error('הניתוח לא נמצא'));
            } else if (attempts >= maxAttempts) {
              clearInterval(poll);
              if (stage1Rendered) {
                resolve(currentAnalysisData);
              } else {
                reject(new Error('הניתוח לקח יותר מדי זמן. נסו שוב.'));
              }
            }
          } catch(e) {
            if (attempts >= maxAttempts) {
              clearInterval(poll);
              if (stage1Rendered) {
                resolve(currentAnalysisData);
              } else {
                reject(e);
              }
            }
          }
        }, 1500);
      });

      clearInterval(stepInterval);
      clearInterval(timerInterval);
      if (progressFill) progressFill.style.width = '100%';

      const enrichEl = document.getElementById('enrichmentLoading');
      if (enrichEl) enrichEl.hidden = true;

      const status = data.analysis?.status;

      if (status === 'not_a_plant') {
        const errorIcon = document.querySelector('.error-icon');
        if (errorIcon) errorIcon.textContent = '❌';
        showError('לא זוהה צמח', data.analysis.message || 'התמונה אינה מכילה צמח. נסו לצלם תמונה של צמח.');
        analyzeBtn.disabled = false;
        return;
      }
      if (status === 'insufficient_image') {
        showInsufficientImage(data.analysis);
        analyzeBtn.disabled = false;
        return;
      }
      // Legacy fallback for older cached responses
      if (data.analysis && data.analysis.isPlant === false) {
        const errorIcon = document.querySelector('.error-icon');
        if (errorIcon) errorIcon.textContent = '❌';
        showError('לא זוהה צמח', data.analysis.notPlantMessage || 'התמונה אינה מכילה צמח.');
        analyzeBtn.disabled = false;
        return;
      }

      currentJobId = data.jobId || null;
      currentAnalysisData = data;
      renderResults(data);
      saveToHistory(data);
      showSection('results');
    } catch (error) {
      clearInterval(stepInterval);
      clearInterval(timerInterval);
      const errorIcon = document.querySelector('.error-icon');
      if (errorIcon) errorIcon.textContent = '❌';
      showError('שגיאה', error.message);
    }

    analyzeBtn.disabled = false;
    analyzeBtn.classList.remove('btn-loading');
  }

  function renderResults(data) {
    const analysis = data.analysis;
    if (!analysis) return;

    const refCard = document.getElementById('refinementResultCard');
    if (refCard) refCard.hidden = true;
    const fuImgCard = document.getElementById('followUpImageCard');
    if (fuImgCard) fuImgCard.hidden = true;
    const fuImgResult = document.getElementById('followUpImageResultCard');
    if (fuImgResult) fuImgResult.hidden = true;

    renderImageQuality(analysis);
    renderIdentification(analysis);
    renderObservations(analysis);
    renderCrossReference(data.crossReference);
    renderHealth(analysis);
    renderIssues(analysis);
    renderFollowUpQuestions(analysis, !!data.canRefine);
    renderFollowUpImageUpload(analysis, !!data.canFollowUpImage);
    renderCare(analysis);
    renderToxicity(analysis);
    renderSeasonal(analysis);
    renderExtras(analysis);
  }

  function confidenceLevelText(conf) {
    const c = conf || 0;
    if (c >= 0.85) return 'רמת אמינות גבוהה מאוד';
    if (c >= 0.65) return 'רמת אמינות גבוהה';
    if (c >= 0.4) return 'רמת אמינות בינונית';
    return 'רמת אמינות נמוכה';
  }

  function confidenceLevelClass(conf) {
    const c = conf || 0;
    return c >= 0.65 ? 'confidence-high' : c >= 0.4 ? 'confidence-medium' : 'confidence-low';
  }

  function renderImageQuality(a) {
    const card = document.getElementById('imageQualityCard');
    if (!card) return;

    const iq = a.imageQuality;
    if (!iq || iq.overall === 'good') {
      card.hidden = true;
      return;
    }

    card.hidden = false;
    const labels = { acceptable: 'סבירה', poor: 'נמוכה' };
    const icons = { acceptable: '🟡', poor: '🔴' };
    const issueLabels = {
      blur: 'תמונה מטושטשת',
      too_dark: 'תמונה כהה מדי',
      too_bright: 'תמונה בהירה מדי',
      plant_too_small: 'הצמח קטן מדי בתמונה',
      damaged_area_not_visible: 'אזור הנזק לא נראה בבירור',
      multiple_plants: 'מספר צמחים בתמונה',
      insufficient_detail: 'חסרים פרטים לזיהוי'
    };

    let html = `<div class="image-quality-notice">
      <span>${icons[iq.overall] || '🟡'} איכות תמונה: ${esc(labels[iq.overall] || iq.overall)}</span>`;
    if (iq.issues && iq.issues.length > 0) {
      html += '<ul>';
      for (const issue of iq.issues) {
        html += `<li>${esc(issueLabels[issue] || issue)}</li>`;
      }
      html += '</ul>';
    }
    html += '<div class="image-quality-tip">תמונה ברורה וקרובה יותר תשפר את דיוק הזיהוי.</div></div>';
    document.getElementById('imageQualityBody').innerHTML = html;
  }

  function renderIdentification(a) {
    const id = a.identification;
    if (!id) return;

    const conf = id.confidence || 0;
    const badge = document.getElementById('confidenceBadge');
    badge.textContent = id.confidenceLevel || confidenceLevelText(conf);
    badge.className = 'confidence-badge ' + confidenceLevelClass(conf);

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

    if (id.uncertaintyNote) {
      html += `<div style="background:rgba(245,124,0,0.08);border-right:3px solid var(--warning);padding:10px 14px;border-radius:var(--radius-sm);margin-bottom:12px;font-size:0.9rem;color:var(--text)">⚠️ ${esc(id.uncertaintyNote)}</div>`;
    }

    if (id.alternativeMatches && id.alternativeMatches.length > 0) {
      html += `<div class="alt-matches"><h4>זיהויים חלופיים אפשריים:</h4>`;
      for (const alt of id.alternativeMatches) {
        html += `
          <div class="alt-match-item">
            <div>
              <span class="alt-match-name">${esc(alt.commonNameHe || alt.commonNameEn || '')}</span>
              <span style="color:var(--text-muted);font-style:italic;margin-right:8px">${esc(alt.scientificName || '')}</span>
            </div>
            <span class="alt-match-conf">${esc(confidenceLevelText(alt.confidence))}</span>
          </div>`;
        if (alt.differentiatingFeature) {
          html += `<div style="font-size:0.8rem;color:var(--text-light);padding:0 12px 6px">↳ ${esc(alt.differentiatingFeature)}</div>`;
        }
      }
      html += `</div>`;
    }

    document.getElementById('identificationBody').innerHTML = html;
  }

  function renderObservations(a) {
    const card = document.getElementById('observationsCard');
    if (!card) return;

    const obs = a.observations;
    if (!obs || obs.length === 0) {
      card.hidden = true;
      return;
    }

    card.hidden = false;
    let html = '<ul class="observations-list">';
    for (const ob of obs) {
      html += `<li>${esc(ob)}</li>`;
    }
    html += '</ul>';
    document.getElementById('observationsBody').innerHTML = html;
  }

  function renderCrossReference(cr) {
    const card = document.getElementById('crossRefCard');
    const body = document.getElementById('crossRefBody');

    if (!cr || !cr.available) {
      // Show unavailable message if we have sources with notes
      if (cr && cr.sources && cr.sources.length > 0) {
        card.hidden = false;
        let html = '';
        for (const src of cr.sources) {
          if (src.note) {
            html += `<div class="cross-ref-match"><div class="match-icon">ℹ️</div><div class="match-info"><div class="match-status">${esc(src.note)}</div></div></div>`;
          }
        }
        if (html) {
          body.innerHTML = html;
          return;
        }
      }
      card.hidden = true;
      return;
    }

    card.hidden = false;
    const agreeingSources = (cr.sources || []).filter(s => s.agrees).length;
    const totalSources = (cr.sources || []).filter(s => s.matchLevel !== 'unavailable').length;
    const overallIcon = agreeingSources === totalSources && totalSources > 0 ? '✅' : agreeingSources > 0 ? '🔶' : '⚠️';

    let html = `
      <div class="cross-ref-match">
        <div class="match-icon">${overallIcon}</div>
        <div class="match-info">
          <div class="match-status">${esc(cr.agreementMessage)}</div>
          <div class="match-detail">${esc(cr.confidenceLevel || confidenceLevelText(cr.combinedConfidence))}</div>
        </div>
      </div>`;

    if (cr.disagreementWarning) {
      html += `
        <div class="cross-ref-match" style="background:rgba(211,47,47,0.06);border:1px solid rgba(211,47,47,0.15)">
          <div class="match-icon">🔎</div>
          <div class="match-info">
            <div class="match-status" style="color:var(--danger)">${esc(cr.disagreementWarning)}</div>
          </div>
        </div>`;
    }

    for (const src of (cr.sources || [])) {
      const isUnavailable = src.matchLevel === 'unavailable';
      const srcIcon = isUnavailable ? 'ℹ️' : src.agrees ? '✅' : src.matchLevel === 'genus' ? '🔶' : '❌';
      const isPlantNet = src.name === 'PlantNet';
      html += `
        <div class="cross-ref-match">
          <div class="match-icon">${srcIcon}</div>
          <div class="match-info">
            <div class="match-status">${esc(src.name)}: ${esc(src.topResult || (isUnavailable ? 'לא זמין' : 'לא נמצא'))}</div>
            <div class="match-detail">
              ${src.hebrewName ? 'בעברית: ' + esc(src.hebrewName) + ' — ' : ''}
              ${!isUnavailable && src.score > 0 ? (isPlantNet ? 'ציון התאמה של PlantNet: ' : 'ציון: ') + Math.round(src.score * 100) + '%' : ''}
              ${src.note ? '<br>' + esc(src.note) : ''}
            </div>
          </div>
        </div>`;
    }

    if ((cr.sources || []).some(s => s.name === 'PlantNet' && s.matchLevel !== 'unavailable')) {
      html += `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">
        ציון ההתאמה של PlantNet משקף דמיון חזותי למאגר התמונות שלהם — הוא אינו הסתברות מדעית שהזיהוי נכון.
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

    const severityLabels = { low: 'נמוך', medium: 'בינוני', high: 'גבוה', urgent: 'דחוף', critical: 'קריטי' };
    const severityClass = { low: 'severity-low', medium: 'severity-medium', high: 'severity-high', urgent: 'severity-critical', critical: 'severity-critical' };
    const likelihoodLabels = { high: 'סבירות גבוהה', medium: 'סבירות בינונית', low: 'סבירות נמוכה' };
    const categoryLabels = {
      pest: 'מזיקים', fungal: 'פטרייתי', bacterial: 'חיידקי', viral: 'נגיפי',
      nutritional: 'תזונתי', watering: 'השקיה', light: 'תאורה',
      temperature: 'טמפרטורה', mechanical: 'מכני', unknown: 'לא ידוע'
    };

    card.hidden = false;
    let html = '';
    for (const issue of a.issues) {
      const sev = issue.severity || 'medium';
      html += `
        <div class="issue-item">
          <div class="issue-header">
            <span class="issue-name">⚠️ ${esc(issue.name || '')}</span>
            <span class="severity-badge ${severityClass[sev] || 'severity-medium'}">${esc(severityLabels[sev] || sev)}</span>
          </div>`;

      // Category and likelihood badges
      const cat = issue.category;
      const lh = issue.likelihood;
      if (cat || lh) {
        html += '<div style="margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap">';
        if (cat && categoryLabels[cat]) {
          html += `<span class="severity-badge severity-low" style="font-size:0.75rem">${esc(categoryLabels[cat])}</span>`;
        }
        if (lh) {
          html += `<span class="severity-badge severity-low" style="font-size:0.75rem">${esc(likelihoodLabels[lh] || lh)}</span>`;
        }
        html += '</div>';
      }

      // Legacy urgency field (backward compat)
      if (issue.urgency && !issue.likelihood) {
        const urgencyLabels = { routine: 'לא דחוף', soon: 'בקרוב', urgent: 'דחוף' };
        const urgencyClass = { routine: 'severity-low', soon: 'severity-medium', urgent: 'severity-critical' };
        html += `<div style="margin-bottom:8px"><span class="severity-badge ${urgencyClass[issue.urgency] || 'severity-medium'}">דחיפות: ${esc(urgencyLabels[issue.urgency] || issue.urgency)}</span></div>`;
      }

      // mostLikelyDiagnosis (legacy) or description
      if (issue.mostLikelyDiagnosis) {
        html += `<div class="issue-subsection"><h5>האבחנה הסבירה ביותר:</h5><p>${esc(issue.mostLikelyDiagnosis)}</p></div>`;
      } else if (issue.description) {
        html += `<p class="issue-description">${esc(issue.description)}</p>`;
      }

      // visibleEvidence (new) or evidenceVisible (legacy)
      const visEvidence = issue.visibleEvidence || issue.evidenceVisible;
      if (visEvidence && visEvidence.length > 0) {
        html += `<div class="issue-subsection"><h5>מה רואים בתמונה:</h5><ul>`;
        for (const ev of visEvidence) html += `<li>${esc(ev)}</li>`;
        html += `</ul></div>`;
      }

      // missingEvidence (new) or evidenceMissing (legacy)
      const missEvidence = issue.missingEvidence || issue.evidenceMissing;
      if (missEvidence && missEvidence.length > 0) {
        html += `<div class="issue-subsection"><h5>מידע שחסר לאבחנה ודאית:</h5><ul>`;
        for (const ev of missEvidence) html += `<li>${esc(ev)}</li>`;
        html += `</ul></div>`;
      }

      // alternativeExplanations (new) or alternativePossibilities (legacy)
      const altExpl = issue.alternativeExplanations || issue.alternativePossibilities;
      if (altExpl && altExpl.length > 0) {
        html += `<div class="issue-subsection"><h5>אפשרויות נוספות שלא נשללו:</h5><ul>`;
        for (const alt of altExpl) html += `<li>${esc(alt)}</li>`;
        html += `</ul></div>`;
      }

      // questionsToConfirm (new) or differentiatingQuestions (legacy)
      const questions = issue.questionsToConfirm || issue.differentiatingQuestions;
      if (questions && questions.length > 0) {
        html += `<div class="issue-subsection"><h5>שאלות שיעזרו לצמצם את האבחנה:</h5><ul>`;
        for (const q of questions) html += `<li>${esc(q)}</li>`;
        html += `</ul></div>`;
      }

      if (issue.recommendedNextStep) {
        html += `<div class="issue-subsection"><h5>הצעד הבא המומלץ:</h5><p>${esc(issue.recommendedNextStep)}</p></div>`;
      }

      if (issue.treatment) {
        const t = issue.treatment;
        if (typeof t === 'string') {
          html += `<div class="issue-subsection"><h5>טיפול:</h5><p>${esc(t)}</p></div>`;
        } else {
          html += `<div class="issue-subsection"><h5>טיפול:</h5>`;
          if (t.immediate) html += `<p><strong>מיידי:</strong> ${esc(t.immediate)}</p>`;
          if (t.ongoing) html += `<p><strong>מתמשך:</strong> ${esc(t.ongoing)}</p>`;
          html += `</div>`;
        }
      }

      html += `</div>`;
    }

    body.innerHTML = html;
  }

  function renderFollowUpQuestions(a, canRefine) {
    const card = document.getElementById('followUpCard');
    if (!card) return;

    const questions = a.followUpQuestions;
    if (!questions || questions.length === 0) {
      card.hidden = true;
      return;
    }

    card.hidden = false;
    const structured = normalizeFollowUpQuestions(questions);

    let html = '<div class="follow-up-intro">ענו על השאלות הבאות כדי לשפר את דיוק האבחון:</div>';
    html += '<div class="follow-up-form" id="followUpForm">';

    for (const q of structured) {
      html += `<div class="follow-up-question" data-qid="${esc(q.id)}">`;
      html += `<label class="follow-up-label">${esc(q.question)}</label>`;

      if (q.type === 'yes_no') {
        html += `<div class="follow-up-options">
          <label class="radio-option"><input type="radio" name="${esc(q.id)}" value="כן"><span>כן</span></label>
          <label class="radio-option"><input type="radio" name="${esc(q.id)}" value="לא"><span>לא</span></label>
          <label class="radio-option"><input type="radio" name="${esc(q.id)}" value="לא יודע/ת"><span>לא יודע/ת</span></label>
        </div>`;
      } else if (q.type === 'single_choice' && q.options && q.options.length > 0) {
        html += '<div class="follow-up-options">';
        for (const opt of q.options) {
          html += `<label class="radio-option"><input type="radio" name="${esc(q.id)}" value="${esc(opt)}"><span>${esc(opt)}</span></label>`;
        }
        html += '</div>';
      } else {
        html += `<input type="text" class="follow-up-text-input" name="${esc(q.id)}" placeholder="הקלידו תשובה..." />`;
      }

      html += '</div>';
    }

    html += '</div>';

    if (canRefine && currentJobId) {
      html += `<button class="btn btn-primary refine-btn" id="refineBtn">🔬 עדכן אבחנה</button>`;
      html += `<div class="refine-loading" id="refineLoading" hidden><span class="refine-spinner"></span> מעדכן את האבחנה...</div>`;
    }

    document.getElementById('followUpBody').innerHTML = html;

    const refineBtn = document.getElementById('refineBtn');
    if (refineBtn) {
      refineBtn.addEventListener('click', submitRefinement);
    }
  }

  function normalizeFollowUpQuestions(questions) {
    return questions.map((q, i) => {
      if (typeof q === 'string') {
        return { id: 'q' + (i + 1), question: q, type: 'short_text', options: [] };
      }
      return {
        id: q.id || 'q' + (i + 1),
        question: q.question || '',
        type: q.type || 'short_text',
        options: q.options || []
      };
    });
  }

  async function submitRefinement() {
    const form = document.getElementById('followUpForm');
    const btn = document.getElementById('refineBtn');
    const loading = document.getElementById('refineLoading');
    if (!form || !currentJobId) return;

    const questions = normalizeFollowUpQuestions(currentAnalysisData?.analysis?.followUpQuestions || []);
    const answers = [];

    for (const q of questions) {
      let answer = null;
      if (q.type === 'yes_no' || q.type === 'single_choice') {
        const checked = form.querySelector(`input[name="${q.id}"]:checked`);
        if (checked) answer = checked.value;
      } else {
        const input = form.querySelector(`input[name="${q.id}"]`);
        if (input && input.value.trim()) answer = input.value.trim();
      }

      if (answer) {
        answers.push({ questionId: q.id, question: q.question, answer });
      }
    }

    if (answers.length === 0) {
      alert('יש לענות על לפחות שאלה אחת');
      return;
    }

    if (btn) {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.hidden = true;
    }
    if (loading) loading.hidden = false;

    try {
      const res = await fetch(PlantDocConfig.API_BASE_URL + '/api/refine-diagnosis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: currentJobId, answers })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'שגיאה בעדכון האבחנה');
      }

      if (data.refinement) {
        renderRefinementResult(data.refinement);
        if (btn) btn.remove();
        if (data.refinement.needsMorePhotos && data.refinement.suggestedPhotos?.length > 0) {
          showFollowUpImageUpload(data.refinement.suggestedPhotos);
        }
      }
    } catch (error) {
      alert(error.message);
      if (btn) {
        btn.hidden = false;
        btn.disabled = false;
      }
    } finally {
      if (loading) loading.hidden = true;
    }
  }

  function renderRefinementResult(ref) {
    const card = document.getElementById('refinementResultCard');
    if (!card) return;

    card.hidden = false;

    let html = '';

    if (ref.refinementSummary) {
      html += `<div class="refinement-summary">${esc(ref.refinementSummary)}</div>`;
    }

    const changeLabels = { increased: 'עלתה', unchanged: 'ללא שינוי', decreased: 'ירדה' };
    const changeIcons = { increased: '📈', unchanged: '➡️', decreased: '📉' };
    if (ref.confidenceChange) {
      html += `<div class="refinement-confidence">${changeIcons[ref.confidenceChange] || '➡️'} רמת הוודאות ${esc(changeLabels[ref.confidenceChange] || ref.confidenceChange)}</div>`;
    }

    if (ref.updatedIssues && ref.updatedIssues.length > 0) {
      html += '<div class="refinement-section"><h4>בעיות מעודכנות:</h4>';
      const statusLabels = { confirmed: 'אושר — סביר יותר', unchanged: 'ללא שינוי', less_likely: 'פחות סביר', ruled_out: 'נשלל' };
      const statusIcons = { confirmed: '✅', unchanged: '➡️', less_likely: '🔻', ruled_out: '❌' };
      for (const issue of ref.updatedIssues) {
        const st = issue.status || 'unchanged';
        html += `<div class="refinement-issue refinement-issue-${esc(st)}">
          <div class="refinement-issue-header">${statusIcons[st] || '➡️'} <strong>${esc(issue.name || '')}</strong> — ${esc(statusLabels[st] || st)}</div>`;
        if (issue.explanation) {
          html += `<div class="refinement-issue-detail">${esc(issue.explanation)}</div>`;
        }
        if (issue.treatment) {
          html += `<div class="refinement-issue-detail"><strong>טיפול:</strong> ${esc(issue.treatment)}</div>`;
        }
        html += '</div>';
      }
      html += '</div>';
    }

    if (ref.ruledOut && ref.ruledOut.length > 0) {
      html += '<div class="refinement-section"><h4>נשללו:</h4>';
      for (const item of ref.ruledOut) {
        html += `<div class="refinement-ruled-out">❌ <strong>${esc(item.name || '')}</strong> — ${esc(item.reason || '')}</div>`;
      }
      html += '</div>';
    }

    if (ref.stillUncertain && ref.stillUncertain.length > 0) {
      html += '<div class="refinement-section"><h4>עדיין לא ברור:</h4>';
      for (const item of ref.stillUncertain) {
        html += `<div class="refinement-uncertain">❓ <strong>${esc(item.name || '')}</strong> — ${esc(item.reason || '')}</div>`;
      }
      html += '</div>';
    }

    if (ref.recommendedNextStep) {
      html += `<div class="refinement-next-step"><h4>הצעד הבא המומלץ:</h4><p>${esc(ref.recommendedNextStep)}</p></div>`;
    }

    if (ref.needsMorePhotos && ref.suggestedPhotos && ref.suggestedPhotos.length > 0) {
      html += '<div class="refinement-photos"><h4>📷 כדי לשפר עוד את האבחון, מומלץ להעלות צילום נוסף:</h4><ul>';
      for (const photo of ref.suggestedPhotos) {
        html += `<li>${esc(photo)}</li>`;
      }
      html += '</ul></div>';
    }

    document.getElementById('refinementResultBody').innerHTML = html;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderFollowUpImageUpload(analysis, canFollowUpImage) {
    const card = document.getElementById('followUpImageCard');
    if (!card) return;

    const needsPhotos = analysis.needsMorePhotos || (analysis.suggestedPhotos && analysis.suggestedPhotos.length > 0);
    if (!needsPhotos || !canFollowUpImage || !currentJobId) {
      card.hidden = true;
      return;
    }

    showFollowUpImageUpload(analysis.suggestedPhotos || []);
  }

  function showFollowUpImageUpload(suggestedPhotos) {
    const card = document.getElementById('followUpImageCard');
    if (!card || !currentJobId) return;

    card.hidden = false;

    let html = '<div class="followup-image-intro">העלו צילום נוסף כדי לשפר את דיוק האבחנה:</div>';

    if (suggestedPhotos && suggestedPhotos.length > 0) {
      html += '<ul class="followup-suggested-list">';
      for (const photo of suggestedPhotos) {
        html += `<li>📷 ${esc(photo)}</li>`;
      }
      html += '</ul>';
    }

    html += `<div class="followup-image-upload-area" id="followUpImageDropZone">
      <div class="followup-upload-icon">📷</div>
      <div class="followup-upload-text">גררו תמונה לכאן או לחצו לבחירה</div>
      <input type="file" id="followUpFileInput" accept="image/*" hidden>
    </div>`;
    html += '<div id="followUpPreviewArea" hidden></div>';
    html += '<div class="followup-image-loading" id="followUpImageLoading" hidden><span class="refine-spinner"></span> מנתח את הצילום הנוסף...</div>';

    document.getElementById('followUpImageBody').innerHTML = html;

    const dropZone = document.getElementById('followUpImageDropZone');
    const fileInput = document.getElementById('followUpFileInput');

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0 && e.dataTransfer.files[0].type.startsWith('image/')) {
        handleFollowUpFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFollowUpFile(e.target.files[0]);
      }
    });
  }

  let followUpSelectedFile = null;

  function handleFollowUpFile(file) {
    if (!file.type.startsWith('image/')) {
      alert('סוג קובץ לא נתמך. יש להעלות תמונה.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      alert('קובץ גדול מדי. גודל מרבי 15MB.');
      return;
    }

    followUpSelectedFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      const previewArea = document.getElementById('followUpPreviewArea');
      const dropZone = document.getElementById('followUpImageDropZone');
      if (dropZone) dropZone.hidden = true;

      previewArea.hidden = false;
      previewArea.innerHTML = `
        <div class="followup-preview"><img src="${e.target.result}" alt="צילום נוסף"></div>
        <div class="followup-preview-actions">
          <button class="btn btn-primary followup-submit-btn" id="followUpSubmitBtn">🔎 נתח צילום נוסף</button>
          <button class="btn btn-text followup-clear-btn" id="followUpClearBtn">נקה</button>
        </div>`;

      document.getElementById('followUpSubmitBtn').addEventListener('click', submitFollowUpImage);
      document.getElementById('followUpClearBtn').addEventListener('click', clearFollowUpImage);
    };
    reader.readAsDataURL(file);
  }

  function clearFollowUpImage() {
    followUpSelectedFile = null;
    const previewArea = document.getElementById('followUpPreviewArea');
    if (previewArea) {
      previewArea.hidden = true;
      previewArea.innerHTML = '';
    }
    const dropZone = document.getElementById('followUpImageDropZone');
    if (dropZone) dropZone.hidden = false;
    const fileInput = document.getElementById('followUpFileInput');
    if (fileInput) fileInput.value = '';
  }

  async function submitFollowUpImage() {
    if (!followUpSelectedFile || !currentJobId) return;

    const submitBtn = document.getElementById('followUpSubmitBtn');
    const clearBtn = document.getElementById('followUpClearBtn');
    const loading = document.getElementById('followUpImageLoading');

    if (submitBtn) {
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      submitBtn.hidden = true;
    }
    if (clearBtn) clearBtn.hidden = true;
    if (loading) loading.hidden = false;

    try {
      const formData = new FormData();
      formData.append('image', followUpSelectedFile);
      formData.append('jobId', currentJobId);

      const res = await fetch(PlantDocConfig.API_BASE_URL + '/api/analyze-followup-image', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'שגיאה בניתוח הצילום הנוסף');
      }

      if (data.followUpResult) {
        renderFollowUpImageResult(data.followUpResult);
        const card = document.getElementById('followUpImageCard');
        if (card) card.hidden = true;
      }
    } catch (error) {
      alert(error.message);
      if (submitBtn) {
        submitBtn.hidden = false;
        submitBtn.disabled = false;
      }
      if (clearBtn) clearBtn.hidden = false;
    } finally {
      if (loading) loading.hidden = true;
    }
  }

  function renderFollowUpImageResult(result) {
    const card = document.getElementById('followUpImageResultCard');
    if (!card) return;

    card.hidden = false;
    let html = '';

    if (result.followUpSummary) {
      html += `<div class="followup-result-summary">${esc(result.followUpSummary)}</div>`;
    }

    if (result.newObservations && result.newObservations.length > 0) {
      html += '<div class="followup-new-observations"><h4>תצפיות חדשות מהצילום:</h4><ul>';
      for (const obs of result.newObservations) {
        html += `<li>${esc(obs)}</li>`;
      }
      html += '</ul></div>';
    }

    const changeLabels = { increased: 'עלתה', unchanged: 'ללא שינוי', decreased: 'ירדה' };
    const changeIcons = { increased: '📈', unchanged: '➡️', decreased: '📉' };
    if (result.confidenceChange) {
      html += `<div class="followup-result-confidence">${changeIcons[result.confidenceChange] || '➡️'} רמת הוודאות ${esc(changeLabels[result.confidenceChange] || result.confidenceChange)}</div>`;
    }

    if (result.updatedReliability) {
      html += `<div style="font-size:0.9rem;color:var(--text-light);margin-bottom:14px">${esc(result.updatedReliability)}</div>`;
    }

    if (result.plantIdentificationChanged && result.updatedPlantIdentification) {
      const upId = result.updatedPlantIdentification;
      html += `<div class="followup-updated-id">
        <h4>🔄 זיהוי הצמח עודכן:</h4>
        <div style="font-size:1.1rem;font-weight:700;color:var(--primary-dark)">${esc(upId.commonNameHe || upId.commonNameEn || '')}</div>
        <div style="font-style:italic;color:var(--text-light)">${esc(upId.scientificName || '')}</div>`;
      if (upId.changeReason) {
        html += `<div style="font-size:0.85rem;color:var(--text);margin-top:6px">${esc(upId.changeReason)}</div>`;
      }
      html += '</div>';
    }

    if (result.supportedIssues && result.supportedIssues.length > 0) {
      html += '<div class="followup-issue-section"><h4>✅ בעיות שהתחזקו:</h4>';
      for (const issue of result.supportedIssues) {
        html += `<div class="followup-issue-item followup-issue-supported"><strong>${esc(issue.name || '')}</strong>`;
        if (issue.explanation) html += `<div class="followup-issue-detail">${esc(issue.explanation)}</div>`;
        html += '</div>';
      }
      html += '</div>';
    }

    if (result.weakenedIssues && result.weakenedIssues.length > 0) {
      html += '<div class="followup-issue-section"><h4>🔻 בעיות שנחלשו:</h4>';
      for (const issue of result.weakenedIssues) {
        html += `<div class="followup-issue-item followup-issue-weakened"><strong>${esc(issue.name || '')}</strong>`;
        if (issue.explanation) html += `<div class="followup-issue-detail">${esc(issue.explanation)}</div>`;
        html += '</div>';
      }
      html += '</div>';
    }

    if (result.ruledOut && result.ruledOut.length > 0) {
      html += '<div class="followup-issue-section"><h4>❌ נשללו:</h4>';
      for (const issue of result.ruledOut) {
        html += `<div class="followup-issue-item followup-issue-ruled-out"><strong>${esc(issue.name || '')}</strong>`;
        if (issue.reason) html += `<div class="followup-issue-detail">${esc(issue.reason)}</div>`;
        html += '</div>';
      }
      html += '</div>';
    }

    if (result.newIssues && result.newIssues.length > 0) {
      html += '<div class="followup-issue-section"><h4>🆕 בעיות חדשות שזוהו:</h4>';
      for (const issue of result.newIssues) {
        html += `<div class="followup-issue-item followup-issue-new"><strong>${esc(issue.name || '')}</strong>`;
        if (issue.description) html += `<div class="followup-issue-detail">${esc(issue.description)}</div>`;
        if (issue.treatment) html += `<div class="followup-issue-detail"><strong>טיפול:</strong> ${esc(issue.treatment)}</div>`;
        html += '</div>';
      }
      html += '</div>';
    }

    if (result.recommendedNextStep) {
      html += `<div class="refinement-next-step"><h4>הצעד הבא המומלץ:</h4><p>${esc(result.recommendedNextStep)}</p></div>`;
    }

    if (result.needsMorePhotos && result.suggestedPhotos && result.suggestedPhotos.length > 0) {
      html += '<div class="refinement-photos"><h4>📷 עדיין מומלץ להוסיף צילומים:</h4><ul>';
      for (const photo of result.suggestedPhotos) {
        html += `<li>${esc(photo)}</li>`;
      }
      html += '</ul></div>';
    }

    document.getElementById('followUpImageResultBody').innerHTML = html;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderCare(a) {
    const care = a.careRecommendations;
    if (!care) return;

    const items = [
      { key: 'water', icon: '💧', title: 'השקיה' },
      { key: 'light', icon: '☀️', title: 'תאורה' },
      { key: 'soil', icon: '🪴', title: 'אדמה' },
      { key: 'temperature', icon: '🌡️', title: 'טמפרטורה' },
      { key: 'fertilizer', icon: '🧪', title: 'דישון' },
      { key: 'pruning', icon: '✂️', title: 'גיזום' }
    ];

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

      if (typeof data === 'string') {
        html += `<div class="care-detail">${esc(data)}</div>`;
      } else if (typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) {
          if (v) html += `<div class="care-detail">${esc(String(v))}</div>`;
        }
      }

      html += `</div>`;
    }
    html += '</div>';

    document.getElementById('careBody').innerHTML = html;
  }

  function renderToxicity(a) {
    const tox = a.toxicity;
    if (!tox) return;

    const verification = tox.verification || 'unknown';
    const pets = tox.forPets || {};
    const humans = tox.forHumans || {};

    let html = '';

    // Verification warning
    if (verification === 'uncertain' || verification === 'unknown') {
      const warningMsg = verification === 'unknown'
        ? 'מידע הרעילות לא אומת מול מקור חיצוני. אין להסתמך על הזיהוי בלבד במקרה של בליעה.'
        : 'מידע הרעילות אינו ודאי — הזיהוי עצמו אינו מאומת במלואו. אין להסתמך על מידע זה בלבד.';
      html += `<div class="toxicity-warning">⚠️ ${esc(warningMsg)}</div>`;
    }

    html += '<div class="toxicity-grid">';

    const petsClass = verification === 'verified'
      ? (pets.toxic ? 'toxicity-danger' : 'toxicity-safe')
      : 'toxicity-uncertain';
    const humansClass = verification === 'verified'
      ? (humans.toxic ? 'toxicity-danger' : 'toxicity-safe')
      : 'toxicity-uncertain';

    const petsIcon = verification !== 'verified' ? '🐾❓' : (pets.toxic ? '🐾⚠️' : '🐾✅');
    const humansIcon = verification !== 'verified' ? '👤❓' : (humans.toxic ? '👤⚠️' : '👤✅');

    function toxLabel(entry, verified) {
      if (entry.details) return entry.details;
      if (verified) return entry.toxic ? 'רעיל' : 'לא רעיל';
      return 'לא אומת';
    }
    const isVerified = verification === 'verified';

    html += `
      <div class="toxicity-item ${petsClass}">
        <div class="toxicity-icon">${petsIcon}</div>
        <div class="toxicity-label">חיות מחמד</div>
        <div class="toxicity-details">${esc(toxLabel(pets, isVerified))}</div>
        ${pets.symptoms ? `<div class="toxicity-details" style="margin-top:4px;font-size:0.8rem">${esc(pets.symptoms)}</div>` : ''}
      </div>`;

    html += `
      <div class="toxicity-item ${humansClass}">
        <div class="toxicity-icon">${humansIcon}</div>
        <div class="toxicity-label">בני אדם</div>
        <div class="toxicity-details">${esc(toxLabel(humans, isVerified))}</div>
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
      const res = await fetch(PlantDocConfig.API_BASE_URL + '/api/health');
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

  renderHistory();
  setTimeout(checkApiStatus, 2000);
});
