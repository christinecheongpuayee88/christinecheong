const CORS = {
  "Access-Control-Allow-Origin": "https://christinecheong.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const SHEETS = {
  1: { id: "15owxaxymBo6DLAAhQsaQkaCsnX-P-Szvfg45H9egB3o", label: "Beginning" },
  2: { id: "1-RH_Zt7N0YLOHRL0DIxW3aLrX9m6YnlUgZC2kEdZ138", label: "Checkpoint 1" },
  3: { id: "1za_z495GBwSYSEEBW81bRWMTNUoXso1cqhRYvaaLP_g", label: "Checkpoint 2" },
  4: { id: "1eB2oPxMscUdh2uAN1ZKPYT-dI5k0_nJgdEWwneCIZZY", label: "Final" },
};
const COHORT_LOG_SHEET_ID = "1aZSydPtYknXlh7l_Q_hjrpiW4jT37Ei02PNFzrtSW8I";
const FORM_RANGE = "'Form Responses 1'!A1:Z1000";
const LOG_RANGE = "Sheet1!A1:C1000";

function b64url(bytes) {
  const str = typeof bytes === "string" ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getGoogleAccessToken(serviceAccountKeyJson) {
  const key = JSON.parse(serviceAccountKeyJson);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claimSet))}`;

  const pemContents = key.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const jwt = `${unsigned}.${b64url(signature)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(tokenData.error_description || "Failed to get Google access token");
  }
  return tokenData.access_token;
}

async function readSheetValues(accessToken, spreadsheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Failed to read sheet ${spreadsheetId}`);
  return data.values || [];
}

async function appendCohortLog(accessToken, stageLabel, reportText) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${COHORT_LOG_SHEET_ID}/values/${encodeURIComponent(
    "Sheet1!A:C"
  )}:append?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [[stageLabel, new Date().toISOString(), reportText]] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to append to Cohort Log");
}

function findLatestReport(logValues, label) {
  const rows = logValues.slice(1); // drop header
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][0] === label) return rows[i][2] || "";
  }
  return null;
}

function formatResponses(values) {
  if (!values.length) return "[No responses recorded yet]";
  const [header, ...rows] = values;
  if (!rows.length) return "[No responses recorded yet]";
  return rows
    .map((row, i) => `Respondent ${i + 1}:\n` + header.map((h, j) => `- ${h}: ${row[j] ?? ""}`).join("\n"))
    .join("\n\n");
}

// Shared across all four stage reports so "AI-Generated Teaching Recommendations"
// means the same thing everywhere, instead of each stage prompt drifting its own
// slightly-different category list. The 6th category ({{Learning Path}}) activates
// the 4th of the 4 adaptation levels (Content/Pedagogy/Facilitation/Learning Path) —
// the first 5 categories' level-tags are unchanged from before, this only adds to them.
//
// buildTeachingRecsBlock(stage) is a function (not a static string) so each
// recommendation can end with a real clickable link: stages 2/3/4 get the
// checkpoint-topic reference table (same links used by Clarify/Apply/
// Challenge), stage 1 only gets the three general resources since there's no
// topic-level evidence yet. linkifyReport() below is the deterministic
// backend safety net that catches cases where the model names the link text
// but drops the markdown brackets.
function buildTeachingRecsBlock(stage) {
  const topics = mergedTopicLinks(stage);
  const topicRefs = topics
    ? Object.entries(topics)
        .map(([topic, l]) => `- "${topic}" → ${THEORY_URL}#slide-${l.clarifySlide} (link text must be exactly "${l.clarifyLabel}")`)
        .join("\n")
    : null;

  return `Consider all six possible teaching-decision categories below, then select ONLY the 3 most important and actionable for this specific cohort's actual data right now. Omit the other three entirely — never list all six. Favor a spread across different categories rather than clustering all 3 picks under one.

Categories and the exact tag to use if you select that category:
- What to emphasise → {{Content}}
- How to teach it → {{Pedagogy}}
- When to adapt → {{Facilitation}}
- Who needs support → {{Facilitation}}
- How to challenge → {{Pedagogy}}
- What to improve next time → {{Learning Path}}

> [One sentence of cohort evidence citing exact counts/percentages from the data above that justifies the 3 recommendations below]

* **[chosen category]:** [specific, concrete recommendation] {{tag}}. [link text](url)
* **[chosen category]:** [specific, concrete recommendation] {{tag}}. [link text](url)
* **[chosen category]:** [specific, concrete recommendation] {{tag}}. [link text](url)

Every one of the 3 recommendations must end with one clickable resource link, chosen from the reference list below — never invent a URL or link text, and never leave a recommendation without a link.
${topicRefs ? `If the recommendation is about one of these specific topics, use its link:\n${topicRefs}\n\nOtherwise use` : "Use"} whichever general resource below fits best:
${buildGeneralLinksBlock()}

The evidence line above must literally start with "> " (a Markdown blockquote) so it renders as a highlighted summary box before the bullets — never write it as a plain sentence without the "> " prefix.`;
}

// All four stages get a Clarify/Apply/Challenge section alongside (not
// replacing) the 6-category TEACHING_RECS_BLOCK above. Beginning has no quiz
// performance yet, so its version is forward-looking — anchored on the
// upcoming SARIMA topic set (TOPIC_LINKS[2]) and classified from stated
// confidence/concerns/goals instead of accuracy — see the isForwardLooking
// branch in clarifyApplyChallengeBlock() below. Links are resolved from this
// fixed table (never left for the model to invent) so recommendations are
// immediately clickable instead of generic advice.
//
// clarifySlide values were verified against the actual slide content (not
// just titles) in ts-theory-slides/ — e.g. "AR/MA identification" points to
// slide 22 ("Summary of the Behaviors of ACF and PACF", the exact
// decay-vs-cutoff table the checkpoint question tests), not just the
// nearest-sounding title.
const THEORY_URL = "https://christinecheong.com/time-series-theory";
const CANVAS_WORKSHOP_URL = "https://canvas.nus.edu.sg/courses/98514/files/folder/Day%204%20Time%20Series%20Forecasting/Workshop";

const TOPIC_LINKS = {
  2: {
    "Differencing (d)": { clarifySlide: 10, clarifyLabel: "Achieving Stationarity — Differencing (slide 10)", exercise: "Workshop 1A — Airline passengers" },
    "AR/MA identification": { clarifySlide: 22, clarifyLabel: "ACF/PACF Decay vs Cutoff Summary (slide 22)", exercise: "Workshop 1A — Airline passengers" },
    "Seasonal period (s)": { clarifySlide: 23, clarifyLabel: "Seasonality and ARIMA Models (slide 23)", exercise: "Workshop 1B — Hotel occupancy" },
    "Seasonal differencing": { clarifySlide: 24, clarifyLabel: "Seasonal Differencing Example (slide 24)", exercise: "Workshop 1B — Hotel occupancy" },
    "Model selection (AIC/BIC)": { clarifySlide: 31, clarifyLabel: "Model Selection Criteria (slide 31)", exercise: "Workshop 1A — Airline passengers" },
    "Residual diagnostics": { clarifySlide: 30, clarifyLabel: "Residuals — Portmanteau Test (slide 30)", exercise: "Workshop 1B — Hotel occupancy" },
  },
  3: {
    "ARIMA vs ARIMAX": { clarifySlide: 33, clarifyLabel: "Introduction to ARIMAX (slide 33)", exercise: "Workshop 2 — Sales and advertising" },
    "Identifying X and Y": { clarifySlide: 34, clarifyLabel: "Advertising → Sales X/Y Example (slide 34)", exercise: "Workshop 3 — Platform sales" },
    "Lagged exogenous effects": { clarifySlide: 37, clarifyLabel: "Lagged Relationship Examples (slide 37)", exercise: "Workshop 3 — Platform sales" },
    "Model evaluation (MAPE)": { clarifySlide: 42, clarifyLabel: "ARIMAX Estimation & MAPE (slide 42)", exercise: "Workshop 2 — Sales and advertising" },
    "Overfitting / lag selection": { clarifySlide: 42, clarifyLabel: "ARIMAX Lag Coefficients (slide 42)", exercise: "Workshop 3 — Platform sales" },
  },
};

// Real, live tools — not placeholders. "What-if scenario" has none; it's a
// live discussion prompt with no resource to point to.
const CHALLENGE_LINKS = {
  "Multiple perspectives": { url: "https://christinecheong.com/agents-hub/perspectives-agent.html", label: "Multiple Perspectives Agent" },
  "Challenge assumptions": { url: "https://christinecheong.com/agents-hub/ai-council-agent.html", label: "AI Advisory Council" },
};

// The 3×3 MVP micro-intervention library: each level's 3 fixed move types,
// each deep-linking to its own placeholder card on micro-interventions.html
// (public/micro-interventions.html) so an instructor who clicks the move
// name sees exactly how to run it, in under a minute, without changing the
// lesson plan. These are distinct from CHALLENGE_LINKS above, which are the
// live interactive tools for two of the Challenge-level moves.
const MICRO_INTERVENTIONS_URL = "https://christinecheong.com/micro-interventions";
const CLARIFY_MOVES = {
  "Quick quiz": `${MICRO_INTERVENTIONS_URL}#clarify-quick-quiz`,
  "Misconception check": `${MICRO_INTERVENTIONS_URL}#clarify-misconception-check`,
  "Worked example": `${MICRO_INTERVENTIONS_URL}#clarify-worked-example`,
};
const APPLY_MOVES = {
  "Mini case": `${MICRO_INTERVENTIONS_URL}#apply-mini-case`,
  "Think–Pair–Share": `${MICRO_INTERVENTIONS_URL}#apply-think-pair-share`,
  "Different context": `${MICRO_INTERVENTIONS_URL}#apply-different-context`,
};
const CHALLENGE_MOVES = {
  "What-if scenario": `${MICRO_INTERVENTIONS_URL}#challenge-what-if`,
  "Multiple perspectives": `${MICRO_INTERVENTIONS_URL}#challenge-multiple-perspectives`,
  "Challenge assumptions": `${MICRO_INTERVENTIONS_URL}#challenge-assumptions`,
};

function buildMoveLinksBlock(moves) {
  return Object.entries(moves)
    .map(([move, url]) => `- "${move}" → ${url} (link text must be exactly "${move}")`)
    .join("\n");
}

// Fallback resources for the 6-category teaching recommendations, used when
// a recommendation isn't about one specific checkpoint topic (e.g. a
// facilitation or pacing tip) — and the only links available at all for
// Stage 1, which has no topic-level evidence yet.
const GENERAL_RESOURCE_LINKS = {
  Theory: { url: THEORY_URL, label: "Time Series Theory Companion" },
  Workshop: { url: CANVAS_WORKSHOP_URL, label: "Canvas Workshop Folder" },
  AgentsHub: { url: "https://christinecheong.com/agents-hub/", label: "AI Agents Hub" },
};

function buildGeneralLinksBlock() {
  return Object.values(GENERAL_RESOURCE_LINKS)
    .map((l) => `- ${l.url} (link text must be exactly "${l.label}")`)
    .join("\n");
}

// Stages 2 and 3 each have their own topic set. Stage 4 has no topics of its
// own — it reasons over the Checkpoint 1 + Checkpoint 2 reports already
// embedded earlier in its prompt — so it gets the union of both, letting it
// reference any of the 11 checkpoint topics the cumulative evidence covers.
// Stage 1 has no quiz data at all yet, so it anchors on the SARIMA topic set
// (TOPIC_LINKS[2]) — the material about to be taught first — for its
// forward-looking Clarify/Apply/Challenge picks.
function mergedTopicLinks(stage) {
  if (stage === 1) return TOPIC_LINKS[2];
  if (stage === 2 || stage === 3) return TOPIC_LINKS[stage];
  if (stage === 4) return { ...TOPIC_LINKS[2], ...TOPIC_LINKS[3] };
  return null;
}

function buildTopicLinksBlock(topics) {
  return Object.entries(topics)
    .map(([topic, l]) => `- "${topic}" — CLARIFY link: ${THEORY_URL}#slide-${l.clarifySlide} (link text must be exactly "${l.clarifyLabel}") | APPLY link: ${CANVAS_WORKSHOP_URL} (link text must name "${l.exercise}")`)
    .join("\n");
}

function buildChallengeLinksBlock() {
  return Object.entries(CHALLENGE_LINKS)
    .map(([move, l]) => `- If you pick "${move}" → link: ${l.url} (link text must be "${l.label}")`)
    .join("\n");
}

function clarifyApplyChallengeBlock(stage, evidenceSource) {
  const topics = mergedTopicLinks(stage);
  const isForwardLooking = stage === 1;
  const basis = isForwardLooking
    ? "this cohort's stated confidence, experience level, and named concerns/goals in the intake survey above (there is no quiz performance yet to base this on — no one has been taught or tested)"
    : "this cohort's demonstrated performance on each";
  const evidenceNote = isForwardLooking
    ? "citing the specific stated confidence, concern, or goal that justifies it"
    : "citing the % evidence";

  return `Classify up to 3 topics from ${evidenceSource} into CLARIFY / APPLY / CHALLENGE based on ${basis}. Favor a spread across the three levels when the evidence supports it (one topic needing clarification, one solid topic ready to apply, one strong topic ready to be challenged) rather than clustering all 3 picks in one level. Only include a level if a topic's evidence genuinely fits it — omit a level rather than forcing a weak fit. Only choose topics from the reference list below — never a topic that isn't in it.

Reference links — use ONLY these exact URLs, copied verbatim, never invented or modified:
${buildTopicLinksBlock(topics)}

MICRO-INTERVENTION MOVE reference links — for each bullet, pick exactly one move from the matching level below and link its name to this exact URL (these are separate from, and additional to, the topic reference links above):
CLARIFY moves:
${buildMoveLinksBlock(CLARIFY_MOVES)}
APPLY moves:
${buildMoveLinksBlock(APPLY_MOVES)}
CHALLENGE moves:
${buildMoveLinksBlock(CHALLENGE_MOVES)}

CHALLENGE live-tool links (only "Multiple perspectives" and "Challenge assumptions" have one; "What-if scenario" has none — its move-name link above is enough, do not add a second link for it):
${buildChallengeLinksBlock()}

For each chosen topic, use exactly this format:

* 🔴 **CLARIFY — [topic]:** [chosen CLARIFY move's exact link text, verbatim](that move's URL from the MICRO-INTERVENTION reference above) — describe the specific action for that move in one sentence, ${evidenceNote}. [that topic's exact CLARIFY link text from the reference above, verbatim](that topic's CLARIFY link)
* 🟢 **APPLY — [topic]:** [chosen APPLY move's exact link text, verbatim](that move's URL from the MICRO-INTERVENTION reference above) — describe the specific action tied to the named workshop exercise, ${evidenceNote}. [Try: that topic's exact exercise name from the reference above](that topic's APPLY link)
* 🔵 **CHALLENGE — [topic]:** [chosen CHALLENGE move's exact link text, verbatim](that move's URL from the MICRO-INTERVENTION reference above) — write the actual prompt to pose to the cohort, ${evidenceNote}. If you picked "Multiple perspectives" or "Challenge assumptions", also append [its live-tool link text](its exact CHALLENGE live-tool link) — if you picked "What-if scenario", append nothing further.

Every bullet must have exactly two links: the move-name link, and the topic/live-tool link (except "What-if scenario", which only gets the move-name link) — never zero, never more.`;
}

// Safety net: the model doesn't reliably wrap the reference label in
// [text](url) markdown even when the text itself is otherwise correct — it
// sometimes drops the brackets and prints the label as plain trailing text.
// Since every possible label+URL pair is already a fixed, known set (never
// AI-invented), just check for each label appearing unlinked and wrap it
// deterministically, rather than trusting the model's markdown compliance.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function linkifyReport(text, stage) {
  const topics = mergedTopicLinks(stage) || {};

  // A label counts as "already linked" if it appears anywhere inside a
  // [...](...) span — not just as the exact bracket content — since the
  // model sometimes correctly links it with an extra prefix, e.g.
  // "[Try: Workshop 1B — Hotel occupancy](url)" rather than bare "[Workshop
  // 1B — Hotel occupancy](url)". A naive exact-bracket check misses that
  // and double-wraps it into broken nested links.
  const alreadyLinked = (label) =>
    new RegExp(`\\[[^\\]]*${escapeRegex(label)}[^\\]]*\\]\\([^)]*\\)`).test(text);

  for (const l of Object.values(topics)) {
    const clarifyUrl = `${THEORY_URL}#slide-${l.clarifySlide}`;
    if (text.includes(l.clarifyLabel) && !alreadyLinked(l.clarifyLabel)) {
      text = text.replace(l.clarifyLabel, `[${l.clarifyLabel}](${clarifyUrl})`);
    }
    if (text.includes(l.exercise) && !alreadyLinked(l.exercise)) {
      text = text.replace(l.exercise, `[${l.exercise}](${CANVAS_WORKSHOP_URL})`);
    }
  }
  for (const l of Object.values(CHALLENGE_LINKS)) {
    if (text.includes(l.label) && !alreadyLinked(l.label)) {
      text = text.replace(l.label, `[${l.label}](${l.url})`);
    }
  }
  // General resource links back the 6-category teaching recommendations on
  // every stage, including Stage 1 which has no checkpoint topics at all.
  for (const l of Object.values(GENERAL_RESOURCE_LINKS)) {
    if (text.includes(l.label) && !alreadyLinked(l.label)) {
      text = text.replace(l.label, `[${l.label}](${l.url})`);
    }
  }
  // Micro-intervention move names (Quick quiz, Mini case, etc.) back the
  // Clarify/Apply/Challenge section on every stage.
  for (const moves of [CLARIFY_MOVES, APPLY_MOVES, CHALLENGE_MOVES]) {
    for (const [label, url] of Object.entries(moves)) {
      if (text.includes(label) && !alreadyLinked(label)) {
        text = text.replace(label, `[${label}](${url})`);
      }
    }
  }
  return text;
}

function buildPrompt(stage, rawData, priorReports) {
  const styleNote = `Write like a sharp internal analytics report to the instructor: numbered sections, each with hard bulleted facts. When there are multiple respondents, compute and state real aggregate statistics — averages, counts, and percentages of total responses — never just a vague "some" or "most." When there is only one respondent, state their specific answers directly instead of talking about "the cohort." No padding, no filler, no restating the obvious.`;

  if (stage === 1) {
    return `You are an expert learning-analytics assistant embedded in a live workshop. Your task is to analyze the start-of-class intake responses and produce a baseline report for the instructor before any teaching happens today.

${styleNote}

### RAW BEGINNING-OF-CLASS DATA (Pre-Class Survey — name (optional), industry, job role, time series experience, confidence 1-5, their main concern or challenge in applying time series forecasting, the business problem they're facing, and learning goals) ###
${rawData}

#################

Structure your response exactly as follows:

## 📋 Beginning of Class Report

### 1. Cohort Insights (from Live Sensing)
* [2-4 bullets of genuine interpretive insight synthesizing the profile mix, confidence distribution, and stated concerns/goals into what it means for today. Bold a short topic header at the start of each bullet, then elaborate after a colon — e.g. "**Confidence Level:** the cohort is skewed low, so expect to spend extra time building comfort before moving fast." Cover different angles (confidence, experience/industry mix, stated concerns) across the bullets — don't repeat the same angle twice. Insight, not a restated breakdown — do not list every industry, role, experience level, or confidence-level count; that's already charted live on the instructor dashboard.]

### 2. AI-Generated Teaching Recommendations

${buildTeachingRecsBlock(1)}

### 3. Top Teaching Moves Today

${clarifyApplyChallengeBlock(1, "the intake survey data above")}

Output plain text using exactly that Markdown structure (## and ### headings, * bullets, **bold**). Do not wrap the output in a code fence, HTML tags, a <style> block, or a full HTML document — start directly with the ## heading and end after the final bullet, with no other text before or after.`;
  }

  if (stage === 2) {
    return `You are an expert learning-analytics assistant embedded in a live workshop. Your task is to analyze one mid-class checkpoint quiz and produce a progress report for the instructor — comparing today's cohort against how they described themselves at the start of class.

${styleNote}

### RAW CHECKPOINT 1 DATA (SARIMA, 6 graded questions plus an optional ungraded reflection question — "Do you have any further questions?" — includes each respondent's selected answer and points scored) ###
${rawData}

### ANSWER KEY (for interpreting which wrong answers reveal which misconception) ###
1. In ARIMA(p,d,q), what does d represent? → Order of differencing needed for stationarity
2. Which ACF/PACF pattern points to an AR(p) process rather than MA(q)? → ACF decays gradually, PACF cuts off after lag p
3. In SARIMA(p,d,q)(P,D,Q)s, what does s represent? → Number of periods per season
4. Why do we need seasonal differencing in addition to regular differencing? → Regular differencing removes trend; seasonal differencing removes the repeating s-period pattern
5. Between two candidate SARIMA models with white-noise residuals, which do you prefer? → The one with the lower AIC/BIC
6. True/False — a well-fitted SARIMA model should leave residuals that look like white noise → True

### BEGINNING-OF-CLASS REPORT (for comparison) ###
${priorReports.Beginning || "[Not available]"}

#################

Structure your response exactly as follows:

## 📊 Checkpoint 1 Report — SARIMA

### 1. Cohort Insights (from Live Sensing)
Exactly 3-4 bullets synthesizing this checkpoint's full picture in one place — performance vs stated confidence, the strongest concept, and the biggest gap — rather than a per-question breakdown. The bold text at the start of each bullet must itself state the trend/finding in a few words, not a generic label — a reader should get the takeaway from the bold text alone.

* **[state the confidence-vs-performance trend, e.g. "Performance outpaces stated confidence" / "Performance matches stated confidence"]:** [one clause citing the overall correct-rate and how it compares to the confidence level/concerns stated in the Beginning-of-Class Report.]
* **[name the single concept the cohort has mastered most solidly, e.g. "Model selection (AIC/BIC) fully mastered"]:** [one clause citing the exact % correct.]
* **[name the single biggest remaining misconception, e.g. "ACF/PACF identification still shaky"]:** [one clause naming the specific misconception and the % who picked it.]
* **[optional 4th bullet, only if the evidence genuinely supports a distinct 4th insight — e.g. a recurring theme in the optional "Do you have any further questions?" responses, or whether the errors are conceptual vs. just notation/labeling confusion]:** [one clause.]

Never list more than one bullet per concept, and never produce a bullet for every question — that level of per-question detail is already visible live on the instructor dashboard.

### 2. AI-Generated Teaching Recommendations

${buildTeachingRecsBlock(2)}

### 3. Top Teaching Moves Now

${clarifyApplyChallengeBlock(2, "the topics above")}

Do not add a section restating total responses or the raw score distribution — both are already shown live on the instructor dashboard.

Output plain text using exactly that Markdown structure (## and ### headings, * bullets, **bold**). Do not wrap the output in a code fence, HTML tags, a <style> block, or a full HTML document — start directly with the ## heading and end after the final bullet, with no other text before or after.`;
  }

  if (stage === 3) {
    return `You are an expert learning-analytics assistant embedded in a live workshop. Your task is to analyze the second mid-class checkpoint quiz and produce a progress report for the instructor — tracking whether the cohort's understanding is improving, plateauing, or declining across the day.

${styleNote}

### RAW CHECKPOINT 2 DATA (ARIMAX, 5 graded questions plus an optional ungraded reflection question — "Do you have any further questions?" — includes each respondent's selected answer and points scored) ###
${rawData}

### ANSWER KEY (for interpreting which wrong answers reveal which misconception) ###
1. What's the key difference between ARIMA and ARIMAX? → ARIMAX adds an exogenous predictor (a leading indicator) on top of Y's own past
2. In the Advertising → Sales example, which is X and which is Y? → X = Advertising spend, Y = Sales
3. Why include lagged versions of the exogenous variable instead of just its current value? → The effect of X on Y is often delayed/distributed over time — a dynamic transfer-function relationship
4. True/False — models were compared using MAPE on a held-out test set → True
5. If adding more advertising lags worsens out-of-sample MAPE, what should you do? → Drop the less useful lags — more lags isn't automatically better; watch for overfitting

### BEGINNING-OF-CLASS REPORT ###
${priorReports.Beginning || "[Not available]"}

### CHECKPOINT 1 REPORT (SARIMA) ###
${priorReports["Checkpoint 1"] || "[Not available]"}

#################

Structure your response exactly as follows:

## 📊 Checkpoint 2 Report — ARIMAX

### 1. Cohort Insights (from Live Sensing, Across Checkpoints 1 & 2)
Exactly 3-4 bullets synthesizing the cohort's full picture across BOTH checkpoints in one place — performance vs stated confidence/trajectory, the strongest concept, and the biggest remaining or persisting gap — rather than a per-question breakdown. The bold text at the start of each bullet must itself state the trend/finding in a few words, not a generic label — a reader should get the takeaway from the bold text alone.

* **[state the confidence/trajectory trend across both checkpoints, e.g. "Performance holding steady since Checkpoint 1" / "Performance dipped from Checkpoint 1"]:** [one clause citing overall correct-rates at both checkpoints and how they compare to the confidence/concerns stated in the Beginning-of-Class Report.]
* **[name the single concept the cohort has mastered most solidly across either checkpoint, naming which one]:** [one clause citing the exact % correct and which checkpoint it's from.]
* **[name the single biggest remaining misconception, naming which checkpoint(s) it appeared in — and explicitly say so if it persisted from Checkpoint 1 to Checkpoint 2, since that signals the earlier recommendation may not have landed]:** [one clause naming the specific misconception and the % who picked it.]
* **[optional 4th bullet, only if the evidence genuinely supports a distinct 4th insight — e.g. a recurring theme in the optional "Do you have any further questions?" responses]:** [one clause.]

Never list more than one bullet per concept, and never produce a bullet for every question — that level of per-question detail is already visible live on the instructor dashboard.

### 2. AI-Generated Teaching Recommendations

${buildTeachingRecsBlock(3)}

### 3. Top Teaching Moves Now

${clarifyApplyChallengeBlock(3, "the topics above")}

Do not add a section restating total responses or the raw score distribution — both are already shown live on the instructor dashboard.

Output plain text using exactly that Markdown structure (## and ### headings, * bullets, **bold**). Do not wrap the output in a code fence, HTML tags, a <style> block, or a full HTML document — start directly with the ## heading and end after the final bullet, with no other text before or after.`;
  }

  // stage 4
  return `You are an expert learning-analytics assistant embedded in a live workshop. Your task is to synthesize the end-of-class reflection alongside the cohort's entire day — from stated expectations, through two comprehension checkpoints, to their own final reflection — into a post-class cohort intelligence report for the instructor. This report should turn the day into evidence-based course improvement, not just a summary of what happened.

${styleNote}

### RAW REFLECTION DATA (End-of-Class Reflection — self-rated confidence 1-5, where they'll apply time series forecasting, and remaining questions) ###
${rawData}

### BEGINNING-OF-CLASS REPORT ###
${priorReports.Beginning || "[Not available]"}

### CHECKPOINT 1 REPORT (SARIMA) ###
${priorReports["Checkpoint 1"] || "[Not available]"}

### CHECKPOINT 2 REPORT (ARIMAX) ###
${priorReports["Checkpoint 2"] || "[Not available]"}

#################

Structure your response exactly as follows:

## 📋 Post-Class Cohort Intelligence Report

### 1. Cohort Insights (from Live Sensing)
Exactly 3 bullets, one per reflection question below — never more, never fewer, never split into sub-bullets. The bold text at the start of each bullet must itself be the trend/finding in a few words (not a generic category label) — a reader should get the takeaway from the bold text alone, before reading the rest of the sentence. Then a short elaboration after the colon, naming the dominant theme(s) but without reciting exact counts or percentages — that's already charted live on the instructor dashboard.

* **Confidence [state the actual trend vs the Beginning-of-Class Report above, e.g. "improved vs Beginning" / "held steady vs Beginning" / "dipped vs Beginning"]:** [one clause naming the direction and, if it adds real signal, roughly how much — e.g. "rising from a low starting point to solidly confident by the end."]
* **[state the dominant theme(s) in "where they'll apply this," e.g. "Applications mostly tied to current work projects" / "Applications split between work and personal use"]:** [one clause naming what that theme actually is.]
* **[state the dominant theme(s) in "remaining questions," e.g. "Remaining questions mainly about applications and examples" / "Remaining questions mainly about advanced models"]:** [2 clauses, more detailed than the other two bullets since this is the most actionable signal for next steps — first name specifically what's still unclear (which model(s), formula, or step recurs), then a second clause naming what kind of follow-up would close the gap, e.g. "several respondents are still asking how to apply the models to new datasets and want worked examples with real numbers rather than more theory, suggesting the next session should open with a hands-on case."]

### 2. AI-Generated Teaching Recommendations

${buildTeachingRecsBlock(4)}

Do not add a section restating total response counts, a concept-by-concept breakdown of what went well or the remaining gaps, or a bulleted list of where respondents said they'll apply this — all of that is already shown live on the instructor dashboard (including a Beginning-vs-Final confidence comparison). Base the recommendations on that evidence without restating it as its own section — go straight from the raw data above to the recommendations.

### 3. Top Teaching Moves for Next Cohort

${clarifyApplyChallengeBlock(4, "the Checkpoint 1 and Checkpoint 2 reports above (both list per-topic accuracy) and this reflection's remaining-questions data")}

Output plain text using exactly that Markdown structure (## and ### headings, * bullets, **bold**). Do not wrap the output in a code fence, HTML tags, a <style> block, or a full HTML document — start directly with the ## heading and end after the final bullet, with no other text before or after.`;
}

// If the instructor already graded assignments (Assignments tab) before
// generating the Final Report, its cohort synthesis — evidence from actual
// graded work, already in Clarify/Apply/Challenge format — gets appended as
// a new section 4, verbatim, rather than run through another OpenAI call.
// This never touches sections 1-3 above, which stay exactly as generated.
function appendRubricSection(report, rubricSynthesis) {
  if (!rubricSynthesis || !rubricSynthesis.trim()) return report;
  return `${report}\n\n### 4. Rubric-Informed Teaching Recommendations (Assignment Evidence)\n\n${rubricSynthesis.trim()}`;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  try {
    const serviceAccountKey = context.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const apiKey = context.env.OPENAI_API_KEY;
    if (!serviceAccountKey) {
      return new Response(JSON.stringify({ error: "Google service account key not configured" }), {
        status: 500,
        headers: CORS,
      });
    }
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API key not configured" }), { status: 500, headers: CORS });
    }

    const body = await context.request.json();
    const stage = Number(body.stage);
    if (![1, 2, 3, 4].includes(stage)) {
      return new Response(JSON.stringify({ error: "stage must be 1, 2, 3, or 4" }), { status: 400, headers: CORS });
    }
    // Only meaningful for stage 4 — the frontend sends whatever the
    // Assignments tab last produced, if the instructor ran it this session.
    const rubricSynthesis = stage === 4 && typeof body.rubricSynthesis === "string" ? body.rubricSynthesis : null;

    const accessToken = await getGoogleAccessToken(serviceAccountKey);

    const { id: sheetId, label: stageLabel } = SHEETS[stage];
    const rawValues = await readSheetValues(accessToken, sheetId, FORM_RANGE);
    const rawData = formatResponses(rawValues);

    let priorReports = {};
    if (stage > 1) {
      const logValues = await readSheetValues(accessToken, COHORT_LOG_SHEET_ID, LOG_RANGE);
      priorReports = {
        Beginning: findLatestReport(logValues, "Beginning"),
        "Checkpoint 1": findLatestReport(logValues, "Checkpoint 1"),
        "Checkpoint 2": findLatestReport(logValues, "Checkpoint 2"),
      };
    }

    const prompt = buildPrompt(stage, rawData, priorReports);

    const llmRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const llmData = await llmRes.json();
    if (!llmRes.ok) {
      return new Response(JSON.stringify({ error: llmData.error?.message || "OpenAI API error" }), {
        status: llmRes.status,
        headers: CORS,
      });
    }

    const linked = linkifyReport(llmData.choices[0].message.content, stage);
    const report = appendRubricSection(linked, rubricSynthesis);

    await appendCohortLog(accessToken, stageLabel, report);

    return new Response(
      JSON.stringify({
        stage,
        stageLabel,
        subject: `Time Series Workshop — ${stageLabel} Report`,
        report,
      }),
      { status: 200, headers: CORS }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
