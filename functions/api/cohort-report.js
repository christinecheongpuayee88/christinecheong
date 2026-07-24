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

function buildPrompt(stage, rawData, priorReports) {
  const styleNote = `Write like a sharp internal analytics report to the instructor: numbered sections, each with hard bulleted facts. When there are multiple respondents, compute and state real aggregate statistics — averages, counts, and percentages of total responses — never just a vague "some" or "most." When there is only one respondent, state their specific answers directly instead of talking about "the cohort." No padding, no filler, no restating the obvious.`;

  if (stage === 1) {
    return `You are an expert learning-analytics assistant embedded in a live workshop. Your task is to analyze the start-of-class intake responses and produce a baseline report for the instructor before any teaching happens today.

${styleNote}

### RAW BEGINNING-OF-CLASS DATA (Pre-Class Survey — name (optional), industry, job role, time series experience, programming experience, learning goals, self-rated confidence 1-5, and the business problem they're facing) ###
${rawData}

#################

Structure your response exactly as follows:

## 📋 Beginning of Class Report

### 1. Participant Profile & Demographics
* **Total Responses:** [n]
* **Industries Represented:** [bulleted list of the distinct industries mentioned, grouping duplicates, with counts where more than one respondent shares an industry]

| Name | Job Title | Industry |
|---|---|---|
[one row per respondent, in the order they appear in the raw data; if a respondent left name blank, use "Anonymous"]

### 2. Confidence Level (Scale 1-5)
* **Average / Range:** [average score] / [lowest]–[highest]
* **Level 1:** [n] response(s)
* **Level 2:** [n] response(s)
* **Level 3:** [n] response(s)
* **Level 4:** [n] response(s)
* **Level 5:** [n] response(s)
* [One interpretive sentence on where the cohort's confidence sits and what that implies for how today should be paced]

### 3. Core Learning Objectives & Goals
* **[Short theme name]** — Mentioned by [X] of [n] responses. [1-2 sentences synthesizing what's behind this theme, referencing the actual variety of wording/contexts used]
* **[Short theme name]** — Mentioned by [X] of [n] responses. [synthesis]
[Group the stated learning goals into 2-4 themes that cover the full spread — do not list every individual response verbatim]

### 4. Business Problems They Want to Solve
* **[Short theme name]** — Mentioned by [X] of [n] responses. [synthesis]
* **[Short theme name]** — Mentioned by [X] of [n] responses. [synthesis]
[Group the stated business problems into 2-3 themes]

### 5. AI-Generated Teaching Recommendations

> [One sentence of cohort evidence citing exact counts/percentages that justify the recommendations below, e.g. "X of Y respondents rated confidence at 3 or below despite Z having intermediate+ time series experience."]

* **What to emphasise:** [the concept, given this mix of experience/confidence, that needs the most grounding before diving into SARIMA/ARIMAX] {{Content}}
* **How to teach it:** [a concrete delivery choice for the opening — e.g. lead with a business example vs. the equation, given who's in the room] {{Pedagogy}}
* **How to challenge:** [what to ask of the more experienced or confident respondents so they stay engaged from the start] {{Pedagogy}}

Output plain text using exactly that Markdown structure (## and ### headings, * bullets, **bold**, and a Markdown pipe table with a header row and a --- separator row for the participant list). Do not wrap the output in a code fence, HTML tags, a <style> block, or a full HTML document — start directly with the ## heading and end after the final bullet, with no other text before or after.`;
  }

  if (stage === 2) {
    return `You are an expert learning-analytics assistant embedded in a live workshop. Your task is to analyze one mid-class checkpoint quiz and produce a progress report for the instructor — comparing today's cohort against how they described themselves at the start of class.

${styleNote}

### RAW CHECKPOINT 1 DATA (SARIMA, 6 questions, includes each respondent's selected answer and points scored) ###
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

### 1. Checkpoint Snapshot
* **Total Responses:** [n]
* **Score Distribution:** [average out of 6, plus a distribution across score bands, e.g. "0-2 correct: X (Y%), 3-4 correct: ..., 5-6 correct: ..."]

### 2. Where the Cohort is Struggling
* For each question with meaningful wrong-answer clustering, one line: [question topic] — [X respondents / Y%] picked "[wrong answer]" → [the specific misconception this reveals]. Mark questions almost everyone got right as "✅ mostly correct" instead of a bullet.

### 3. Progressive Cohort Assessment (vs. Beginning)
* [Compare actual SARIMA performance against the confidence level and stated goals from the Beginning Report — is the cohort over-confident, under-confident, or on track relative to what they said coming in? Note whether the errors are conceptual or just notation/labeling confusion.]

### 4. AI-Generated Teaching Recommendations

Consider all five possible teaching-decision categories below, then select ONLY the 3 most important and actionable for this specific cohort's actual data right now. Omit the other two entirely — never list all five.

Categories and the exact tag to use if you select that category:
- What to emphasise → {{Content}}
- How to teach it → {{Pedagogy}}
- When to adapt → {{Facilitation}}
- Who needs support → {{Facilitation}}
- How to challenge → {{Pedagogy}}

> [One sentence of cohort evidence citing exact counts/percentages that justifies the 3 recommendations below, e.g. "X of Y respondents picked the wrong answer for what d represents, confusing it with autoregressive terms."]

* **[chosen category]:** [specific, concrete recommendation] {{tag}}
* **[chosen category]:** [specific, concrete recommendation] {{tag}}
* **[chosen category]:** [specific, concrete recommendation] {{tag}}

Output plain text using exactly that Markdown structure (## and ### headings, * bullets, **bold**). Do not wrap the output in a code fence, HTML tags, a <style> block, or a full HTML document — start directly with the ## heading and end after the final bullet, with no other text before or after.`;
  }

  if (stage === 3) {
    return `You are an expert learning-analytics assistant embedded in a live workshop. Your task is to analyze the second mid-class checkpoint quiz and produce a progress report for the instructor — tracking whether the cohort's understanding is improving, plateauing, or declining across the day.

${styleNote}

### RAW CHECKPOINT 2 DATA (ARIMAX, 5 questions, includes each respondent's selected answer and points scored) ###
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

### 1. Checkpoint Snapshot
* **Total Responses:** [n]
* **Score Distribution:** [average out of 5, plus a distribution across score bands]

### 2. Where the Cohort is Struggling
* For each question with meaningful wrong-answer clustering, one line: [question topic] — [X respondents / Y%] picked "[wrong answer]" → [the specific misconception this reveals]. Mark questions almost everyone got right as "✅ mostly correct" instead of a bullet.

### 3. Progressive Cohort Assessment (vs. Beginning & Checkpoint 1)
* [State explicitly whether performance/confidence is improving, flat, or declining versus the SARIMA checkpoint, and against the confidence/goals from the Beginning Report — call out whether the Checkpoint 1 recommendation appears to have landed, and whether the same error pattern recurs]

### 4. AI-Generated Teaching Recommendations

Consider all five possible teaching-decision categories below, then select ONLY the 3 most important and actionable for this specific cohort's actual data right now. Omit the other two entirely — never list all five.

Categories and the exact tag to use if you select that category:
- What to emphasise → {{Content}}
- How to teach it → {{Pedagogy}}
- When to adapt → {{Facilitation}}
- Who needs support → {{Facilitation}}
- How to challenge → {{Pedagogy}}

> [One sentence of cohort evidence citing exact counts/percentages that justifies the 3 recommendations below]

* **[chosen category]:** [specific, concrete recommendation] {{tag}}
* **[chosen category]:** [specific, concrete recommendation] {{tag}}
* **[chosen category]:** [specific, concrete recommendation] {{tag}}

Output plain text using exactly that Markdown structure (## and ### headings, * bullets, **bold**). Do not wrap the output in a code fence, HTML tags, a <style> block, or a full HTML document — start directly with the ## heading and end after the final bullet, with no other text before or after.`;
  }

  // stage 4
  return `You are an expert learning-analytics assistant embedded in a live workshop. Your task is to synthesize the end-of-class reflection alongside the cohort's entire day — from stated expectations, through two comprehension checkpoints, to their own final reflection — into a post-class cohort intelligence report for the instructor. This report should turn the day into evidence-based course improvement, not just a summary of what happened.

${styleNote}

### RAW REFLECTION DATA (End-of-Class Reflection — biggest takeaway, self-rated confidence 1-5, where they'll apply time series forecasting, remaining questions, and optional suggestions) ###
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

### 1. Cohort Snapshot
* **Total Responses:** [n]
* **Opening vs. Closing Confidence:** [exact average from the Beginning Report] → [exact average from this Reflection data], out of 5
* **Where They'll Apply This:** [bulleted synthesis of where respondents said they'll use this]

### 2. Improvement Observed
* **Confidence:** [state whether the confidence shift above tracked, outran, or lagged actual comprehension shown in the two checkpoints — quote the specific delta]
* **Concept-level gains:** [name the specific concept(s) that show the clearest improvement between the Checkpoint 1 and Checkpoint 2 reports' "Where the Cohort is Struggling" findings — e.g. a wrong-answer rate that dropped, or a misconception flagged at Checkpoint 1 that Checkpoint 2 no longer shows]

### 3. Remaining Gaps
* **Persistent misconceptions:** [any specific wrong-answer pattern that appears in both the Checkpoint 1 and Checkpoint 2 reports, or that resurfaces in this reflection's remaining-questions data — name the exact concept, not just "some confusion"]
* **Unresolved questions:** [aggregate the recurring themes in "remaining questions"]

### 4. Next-Run Recommendation
* [1-2 concrete changes to content sequencing, timing, or emphasis for the next delivery — grounded in the specific persistent misconception above, not generic advice. Prefer a specific action like reordering a topic, adding a specific example, or reallocating minutes.]
* **Follow-up microlearning:** [a specific short resource or activity to close the remaining gap for struggling respondents, and who should get it] {{Learning Path}}

Output plain text using exactly that Markdown structure (## and ### headings, * bullets, **bold**). Do not wrap the output in a code fence, HTML tags, a <style> block, or a full HTML document — start directly with the ## heading and end after the final bullet, with no other text before or after.`;
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

    const report = llmData.choices[0].message.content;

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
