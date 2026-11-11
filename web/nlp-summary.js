import { taglishHiligaynonLexicon } from "../ml/taglish-hiligaynon/index.js";

const MODEL_ID = "Xenova/bert-base-multilingual-uncased-sentiment";
const MODEL_REVISION = "fad9b372f770c208d2efaf00d02f2cb3b61ec450";
const MODEL_SIZE_LABEL = "about 168 MB";
const SENTIMENTS = ["positive", "neutral", "negative"];
const SENTIMENT_COLORS = {
  positive: "var(--success)",
  neutral: "var(--text-muted)",
  negative: "var(--danger)",
};
const SARCASM_CUES = /\b(?:yeah\s+right|sure\s+thing|as\s+if|what\s+a\s+joke|thanks\s+for\s+nothing|love\s+that\s+for\s+me|just\s+what\s+i\s+needed)\b|\/s\b|🙄|😒|🙃/iu;
const CONTRAST_CUES = /\b(?:but|however|though|although|pero|kaso|apang)\b/iu;

let currentReviews = [];
let analysisRequested = false;
let analysisRun = 0;
let classifierPromise = null;
let classifier = null;
let modelError = "";
let modelProgress = "";
let analysisCache = new Map();

const getNode = (id) => document.getElementById(id);
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

function reviewText(review) {
  return String(review?.review || review?.text || review?.feedback || "").trim();
}

function reviewKey(review, index) {
  return `${review?.id || index}|${Number(review?.rating || 0)}|${reviewText(review)}`;
}

function ratingPolarity(review) {
  const rating = Number(review?.rating);
  return Number.isFinite(rating) && rating >= 1 && rating <= 5 ? (rating - 3) / 2 : null;
}

function sentimentFor(score) {
  if (score > 0.16) return "positive";
  if (score < -0.16) return "negative";
  return "neutral";
}

function unpackBertOutput(output) {
  const rows = Array.isArray(output?.[0]) ? output[0] : output;
  if (!Array.isArray(rows)) return null;

  let totalProbability = 0;
  let weightedPolarity = 0;
  let topProbability = 0;
  rows.forEach((row) => {
    const stars = Number(String(row?.label || "").match(/[1-5]/)?.[0]);
    const probability = Number(row?.score);
    if (!Number.isFinite(stars) || !Number.isFinite(probability)) return;
    totalProbability += probability;
    weightedPolarity += ((stars - 3) / 2) * probability;
    topProbability = Math.max(topProbability, probability);
  });

  return totalProbability > 0
    ? { score: Math.max(-1, Math.min(1, weightedPolarity / totalProbability)), confidence: topProbability }
    : null;
}

function detectSarcasm(text, lexiconMatches, bertScore, ratingScore, textOnlyScore) {
  const positiveCue = lexiconMatches.some((match) => Number(match.contribution) > 0.12);
  const negativeCue = lexiconMatches.some((match) => Number(match.contribution) < -0.12);
  const explicitCue = SARCASM_CUES.test(text);
  const contrastivePolarity = positiveCue && negativeCue && CONTRAST_CUES.test(text);
  const modelLexiconConflict = Number.isFinite(bertScore)
    && lexiconMatches.length > 0
    && Math.abs(bertScore - Number(lexiconMatches.reduce((sum, match) => sum + Number(match.contribution || 0), 0)
      / Math.max(1, lexiconMatches.reduce((sum, match) => sum + Number(match.intensity || 0), 0)))) > 0.72;
  const hasTextSignal = Number.isFinite(bertScore) || lexiconMatches.some((match) => Number(match.contribution) !== 0);
  const ratingConflict = hasTextSignal
    && Number.isFinite(ratingScore)
    && Math.abs(ratingScore - textOnlyScore) >= 0.8
    && Math.sign(ratingScore) !== Math.sign(textOnlyScore);
  const likelySarcasm = explicitCue || contrastivePolarity || (modelLexiconConflict && (positiveCue || negativeCue));
  const reasons = [];
  if (likelySarcasm) reasons.push("Possible sarcasm or ironic wording");
  if (ratingConflict) reasons.push("Star rating conflicts with review text");
  if (modelLexiconConflict && !likelySarcasm) reasons.push("BERT and lexicon signals disagree");
  if (positiveCue && negativeCue && !contrastivePolarity) reasons.push("Mixed positive and negative wording");
  return { likelySarcasm, ratingConflict, modelLexiconConflict, reasons };
}

function combineAnalysis(review, bertResult) {
  const text = reviewText(review);
  const lexicon = taglishHiligaynonLexicon.score(text);
  const matches = Array.isArray(lexicon.matches) ? lexicon.matches : [];
  const hasLexiconSignal = matches.some((match) => Number(match.contribution) !== 0);
  const ratingScore = ratingPolarity(review);
  const hasBert = Boolean(bertResult && text);

  const textParts = [];
  if (hasBert) textParts.push({ score: bertResult.score, weight: 0.58 });
  if (hasLexiconSignal) textParts.push({ score: Number(lexicon.score || 0), weight: hasBert ? 0.42 : 0.78 });
  const textOnlyScore = textParts.length
    ? textParts.reduce((sum, part) => sum + part.score * part.weight, 0)
      / textParts.reduce((sum, part) => sum + part.weight, 0)
    : 0;

  const scoreParts = textParts.slice();
  if (ratingScore !== null) scoreParts.push({ score: ratingScore, weight: textParts.length ? 0.18 : 1 });
  const score = scoreParts.length
    ? scoreParts.reduce((sum, part) => sum + part.score * part.weight, 0)
      / scoreParts.reduce((sum, part) => sum + part.weight, 0)
    : 0;
  const sarcasm = detectSarcasm(text, matches, hasBert ? bertResult.score : Number.NaN, ratingScore, textOnlyScore);
  const confidence = hasBert
    ? Math.max(0, Math.min(1, 0.52 * bertResult.confidence + 0.48 * Math.min(1, Math.abs(textOnlyScore))))
    : hasLexiconSignal
      ? Math.min(0.78, 0.35 + Math.abs(Number(lexicon.score || 0)) * 0.43)
      : ratingScore !== null ? 0.35 : 0.1;
  const lowConfidence = confidence < 0.4;
  const needsHumanReview = sarcasm.reasons.length > 0 || lowConfidence;
  const method = hasBert
    ? hasLexiconSignal ? "BERT + lexicon" : ratingScore !== null ? "BERT + rating" : "BERT"
    : hasLexiconSignal ? ratingScore !== null ? "Lexicon + rating" : "Lexicon"
      : ratingScore !== null ? "Rating fallback" : "No text/rating signal";

  return {
    id: String(review?.id || ""),
    customer: String(review?.user || review?.userEmail || "Customer"),
    product: String(review?.product || review?.productName || "Shop experience"),
    text,
    rating: Number(review?.rating || 0),
    sentiment: sentimentFor(score),
    score,
    confidence,
    method,
    matches,
    needsHumanReview,
    likelySarcasm: sarcasm.likelySarcasm,
    attentionReasons: sarcasm.reasons.length ? sarcasm.reasons : lowConfidence ? ["Low-confidence result; verify manually"] : [],
  };
}

function statusMessage(message, tone = "info", retry = false) {
  const node = getNode("nlp-model-status");
  if (!node) return;
  node.className = `nlp-model-status ${tone}`;
  node.innerHTML = `<span>${escapeHTML(message)}</span>${retry ? ' <button type="button" class="btn btn-outline btn-sm" data-nlp-retry>Retry BERT analysis</button>' : ""}`;
}

async function loadClassifier(runId) {
  if (classifier) return classifier;
  if (!classifierPromise) {
    modelError = "";
    modelProgress = `Loading the BERT model (${MODEL_SIZE_LABEL})...`;
    statusMessage(modelProgress, "loading");
    classifierPromise = (async () => {
      const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm");
      env.useBrowserCache = true;
      env.cacheKey = "techknow-review-nlp-bert-v1";
      return pipeline("text-classification", MODEL_ID, {
        dtype: "int8",
        revision: MODEL_REVISION,
        progress_callback: (event) => {
          if (runId !== analysisRun) return;
          const loaded = Number(event?.loaded);
          const total = Number(event?.total);
          if (Number.isFinite(loaded) && Number.isFinite(total) && total > 0) {
            modelProgress = `Downloading BERT model: ${Math.min(100, Math.round((loaded / total) * 100))}% (${MODEL_SIZE_LABEL}, first run only)...`;
            statusMessage(modelProgress, "loading");
          }
        },
      });
    })();
  }

  try {
    classifier = await classifierPromise;
    modelError = "";
    modelProgress = "";
    return classifier;
  } catch (error) {
    classifierPromise = null;
    modelError = error?.message || "BERT could not be loaded.";
    throw error;
  }
}

async function runAnalysis() {
  if (!analysisRequested) return;
  const runId = ++analysisRun;
  const snapshot = currentReviews.slice();
  modelError = "";
  if (!snapshot.length) {
    renderSummary([]);
    statusMessage("No customer feedback is available for this store yet.", "info");
    return;
  }

  let activeClassifier = null;
  const hasWrittenReviews = snapshot.some((review) => reviewText(review));
  if (hasWrittenReviews) {
    try {
      activeClassifier = await loadClassifier(runId);
    } catch (error) {
      console.warn("BERT unavailable; processing reviews with lexicon/rating fallback.", error);
    }
  }
  if (runId !== analysisRun) return;

  const analyses = [];
  let inferenceFallbacks = 0;
  for (let index = 0; index < snapshot.length; index += 1) {
    if (runId !== analysisRun) return;
    const review = snapshot[index];
    const key = reviewKey(review, index);
    const cached = analysisCache.get(key);
    if (cached && (!activeClassifier || cached.method.startsWith("BERT"))) {
      analyses.push(cached);
      continue;
    }

    let bertResult = null;
    const text = reviewText(review);
    if (activeClassifier && text) {
      try {
        const output = await activeClassifier(text.slice(0, 2500), { top_k: null, truncation: true });
        bertResult = unpackBertOutput(output);
        if (!bertResult) throw new Error("BERT returned an unsupported output format.");
      } catch (error) {
        inferenceFallbacks += 1;
        modelError = error?.message || "BERT inference failed for one or more reviews.";
        console.warn("A review could not be processed by BERT; using local fallback.", error);
      }
    }

    const analysis = combineAnalysis(review, bertResult);
    analysisCache.set(key, analysis);
    analyses.push(analysis);
    modelProgress = `Analyzing review ${index + 1} of ${snapshot.length}...`;
    statusMessage(modelProgress, "loading");
  }

  if (runId !== analysisRun) return;
  const currentKeys = new Set(snapshot.map(reviewKey));
  analysisCache = new Map(Array.from(analysisCache.entries()).filter(([key]) => currentKeys.has(key)));
  renderSummary(analyses);

  const needsHumanReview = analyses.filter((analysis) => analysis.needsHumanReview).length;
  const analyzedWithBert = analyses.filter((analysis) => analysis.method.startsWith("BERT")).length;
  if (hasWrittenReviews && !activeClassifier) {
    statusMessage(`Analysis complete: ${analyses.length}/${snapshot.length} reviews processed. ${needsHumanReview} need human review. BERT could not be loaded, so lexicon/rating fallback was used. ${modelError ? `(${modelError})` : ""}`, "warning", true);
  } else if (inferenceFallbacks > 0) {
    statusMessage(`Analysis complete: ${analyses.length}/${snapshot.length} reviews processed. BERT inference failed for ${inferenceFallbacks}; those reviews used lexicon/rating fallback. ${needsHumanReview} need human review. ${modelError ? `(${modelError})` : ""}`, "warning", true);
  } else if (!hasWrittenReviews) {
    statusMessage(`Analysis complete: ${analyses.length}/${snapshot.length} reviews processed from star ratings; no written feedback was available for BERT or lexicon analysis. ${needsHumanReview} need human review.`, needsHumanReview ? "warning" : "success");
  } else {
    statusMessage(`Analysis complete: ${analyses.length}/${snapshot.length} reviews processed with BERT available; ${analyzedWithBert} used BERT and ${needsHumanReview} are flagged for human review. The model runs locally; first use downloads ${MODEL_SIZE_LABEL} and caches it in this browser.`, needsHumanReview ? "warning" : "success");
  }
}

function renderKeywords(analyses, sign, targetId, className) {
  const counts = new Map();
  analyses.forEach((analysis) => analysis.matches.forEach((match) => {
    const contribution = Number(match.contribution || 0);
    if ((sign > 0 && contribution <= 0) || (sign < 0 && contribution >= 0)) return;
    const term = String(match.term || "").trim();
    if (term) counts.set(term, (counts.get(term) || 0) + 1);
  }));
  const entries = Array.from(counts.entries()).sort((left, right) => right[1] - left[1]).slice(0, 12);
  getNode(targetId).innerHTML = entries.length
    ? entries.map(([term, count]) => `<span class="keyword-chip ${className}">${escapeHTML(term)} <small>×${count}</small></span>`).join("")
    : '<span class="nlp-muted">No matching lexicon terms in the current reviews.</span>';
}

function renderSummary(analyses) {
  const counts = Object.fromEntries(SENTIMENTS.map((sentiment) => [
    sentiment,
    analyses.filter((analysis) => analysis.sentiment === sentiment).length,
  ]));
  const attention = analyses.filter((analysis) => analysis.needsHumanReview).length;
  const sarcasm = analyses.filter((analysis) => analysis.likelySarcasm).length;
  const completed = analyses.length;
  const safePercent = (count) => completed ? Math.round((count / completed) * 100) : 0;

  getNode("nlp-stats").innerHTML = [
    ["fa-list-check", "Feedback processed", `${completed}/${currentReviews.length}`, "Every loaded review has an analysis result"],
    ["fa-triangle-exclamation", "Human follow-up", attention, "Uncertain or conflicting feedback"],
    ["fa-comment-dots", "Possible sarcasm", sarcasm, "Flagged for a person to verify"],
  ].map(([icon, label, value, detail]) => `<div class="stat-card"><div class="stat-icon"><i class="fa ${icon}"></i></div><div class="stat-label">${label}</div><div class="stat-value">${value}</div><small>${detail}</small></div>`).join("");

  getNode("nlp-sentiment-breakdown").innerHTML = completed
    ? SENTIMENTS.map((sentiment) => `<div class="sentiment-row"><div class="sentiment-label">${sentiment[0].toUpperCase()}${sentiment.slice(1)}</div><div class="sentiment-bar-wrap"><div class="sentiment-fill" style="width:${safePercent(counts[sentiment])}%;background:${SENTIMENT_COLORS[sentiment]}"></div></div><div class="sentiment-pct">${counts[sentiment]} · ${safePercent(counts[sentiment])}%</div></div>`).join("")
    : '<div class="nlp-muted">Sentiment totals will appear when reviews are analyzed.</div>';

  getNode("nlp-attention-summary").innerHTML = completed
    ? `<p><strong>${attention} of ${completed}</strong> feedback items need human follow-up.</p><p>${sarcasm} possible sarcasm cue${sarcasm === 1 ? "" : "s"} detected. These are review flags, not definitive sarcasm judgments.</p>`
    : '<div class="nlp-muted">No feedback to review yet.</div>';

  renderKeywords(analyses, 1, "nlp-positive-keywords", "pos");
  renderKeywords(analyses, -1, "nlp-negative-keywords", "neg");

  const tbody = getNode("nlp-review-rows");
  tbody.innerHTML = analyses.length ? analyses.map((analysis) => {
    const attentionLabel = analysis.likelySarcasm
      ? "Possible sarcasm"
      : analysis.attentionReasons[0] || "No flag";
    const sentimentClass = `nlp-sentiment-${analysis.sentiment}`;
    const attentionClass = analysis.needsHumanReview ? "nlp-attention-flag" : "nlp-clear-flag";
    const rating = Number.isFinite(analysis.rating) && analysis.rating > 0 ? `${Math.min(5, analysis.rating)} / 5` : "Not rated";
    return `<tr>
      <td><strong>${escapeHTML(analysis.customer)}</strong><small>${escapeHTML(analysis.product)}</small></td>
      <td class="nlp-feedback">${escapeHTML(analysis.text || "No written feedback")}</td>
      <td>${escapeHTML(rating)}</td>
      <td><span class="nlp-pill ${sentimentClass}">${escapeHTML(analysis.sentiment)}</span><small>${Math.round(analysis.confidence * 100)}% signal strength</small></td>
      <td><span class="nlp-pill ${attentionClass}">${escapeHTML(attentionLabel)}</span>${analysis.attentionReasons.length > 1 ? `<small>${escapeHTML(analysis.attentionReasons.slice(1).join("; "))}</small>` : ""}</td>
      <td><span class="nlp-analysis-method">${escapeHTML(analysis.method)}</span><small>${analysis.needsHumanReview ? "Human follow-up needed" : "Analyzed"}</small></td>
    </tr>`;
  }).join("") : '<tr><td colspan="6" class="empty-table">No reviews are available.</td></tr>';

  const coverage = getNode("nlp-coverage-badge");
  coverage.textContent = completed ? `${completed}/${currentReviews.length} processed` : "No reviews";
  coverage.className = `nlp-coverage-badge ${completed && attention === 0 ? "complete" : attention ? "follow-up" : ""}`;

  if (typeof window.updateStoreSentimentChart === "function") {
    window.updateStoreSentimentChart(SENTIMENTS.map((sentiment) => counts[sentiment] || 0));
  }
}

function requestAnalysis() {
  analysisRequested = true;
  runAnalysis();
}

window.refreshNlpSummary = (nextReviews) => {
  currentReviews = Array.isArray(nextReviews) ? nextReviews.slice() : [];
  if (analysisRequested) runAnalysis();
  else if (!currentReviews.length) statusMessage("No customer feedback is available for this store yet.", "info");
};
window.runNlpReviewAnalysis = requestAnalysis;

getNode("nlp-model-status")?.addEventListener("click", (event) => {
  if (event.target.closest("[data-nlp-retry]")) requestAnalysis();
});
document.querySelector('[data-page="nlp"]')?.addEventListener("click", requestAnalysis);

window.refreshNlpSummary(window.storeReviews || []);
