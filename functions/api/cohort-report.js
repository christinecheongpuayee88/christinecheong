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
* **Industries / Roles Represented:** [bulleted list of the distinct industries and job roles mentioned, grouping duplicates]
* **Experience Levels:** [distribution of time series experience and programming experience across respondents, e.g. "Time series: 2 None, 3 Beginner, 1 Intermediate"]

### 2. Confidence Level (Scale 1-5)
* **Average / Spread:** [average score, plus the full distribution: "1 = X respondents (Y%), 2 = ..., 3 = ..., 4 = ..., 5 = ...". One sentence characterizing where the cluster sits.]

### 3. Learning Goals & Business Problems
* [bulleted synthesis of the recurring learning goals and business problems the cohort described]

### 4. AI-Generated Teaching Recommendations

> [One sentence of cohort evidence citing exact counts/percentages that justify the recommendations below, e.g. "X of Y respondents rated confidence at 3 or below despite Z having intermediate+ time series experience."]

* **What to emphasise:** [the concept, given this mix of experience/confidence, that needs the most grounding before diving into SARIMA/ARIMAX] {{Content}}
* **How to teach it:** [a concrete delivery choice for the opening — e.g. lead with a business example vs. the equation, given who's in the room] {{Pedagogy}}
* **How to challenge:** [what to ask of the more experienced or confident respondents so they stay engaged from the start] {{Pedagogy}}

Output plain text using exactly that Markdown structure (## and ### headings, * bullets, **bold**). Do not wrap the output in a code fence, HTML tags, a <style> block, or a full HTML document — start directly with the ## heading and end after the final bullet, with no other text before or after.`;
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

> [One sentence of cohort evidence citing exact counts/percentages that justify the recommendations below, e.g. "X of Y respondents picked the wrong answer for what d represents, confusing it with autoregressive terms."]

* **What to emphasise:** [the specific concept the wrong-answer pattern reveals needs re-explaining right now] {{Content}}
* **How to teach it:** [a concrete delivery choice — e.g. compare two visual examples before returning to the equation] {{Pedagogy}}
* **When to adapt:** [a specific timing decision — e.g. add N minutes before starting ARIMAX, or move on now] {{Facilitation}}
* **Who needs support:** [which respondents/segment scored lowest and should get a refresher activity] {{Facilitation}}
* **How to challenge:** [what to ask the respondents who scored well, so they're not idle during the re-explanation] {{Pedagogy}}

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

> [One sentence of cohort evidence citing exact counts/percentages that justify the recommendations below]

* **What to emphasise:** [the specific concept the wrong-answer pattern reveals still needs reinforcing before class ends] {{Content}}
* **How to teach it:** [a concrete delivery choice for the closing stretch] {{Pedagogy}}
* **When to adapt:** [a specific timing decision — how many minutes to spend now vs. leave for the reflection discussion] {{Facilitation}}
* **Who needs support:** [which respondents/segment is still struggling and should get direct follow-up] {{Facilitation}}
* **How to challenge:** [what to ask the respondents who are on track, so the closing stretch isn't wasted for them] {{Pedagogy}}

Output plain text using exactly that Markdown structure (## and ### headings, * bullets, **bold**). Do not wrap the output in a code fence, HTML tags, a <style> block, or a full HTML document — start directly with the ## heading and end after the final bullet, with no other text before or after.`;
  }

  // stage 4
  return `You are an expert learning-analytics assistant embedded in a live workshop. Your task is to synthesize the end-of-class reflection alongside the cohort's entire day — from stated expectations, through two comprehension checkpoints, to their own final reflection — into one closing report for the instructor.

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

## 📋 Final Learning Journey Report

### 1. Reflection Snapshot
* **Total Responses:** [n]
* **Confidence Now (Scale 1-5):** [average, plus distribution, plus how it compares to the average confidence reported in the Beginning Report — up, down, or unchanged]
* **Where They'll Apply This:** [bulleted synthesis of where respondents said they'll use this]

### 2. Progressive Cohort Assessment — The Full Journey
* [2-3 sentences tracing the arc from the Beginning Report's stated goals and business problems, through both checkpoints' comprehension trend, to where the cohort landed by reflection — did the day deliver on what they came in hoping for? Be explicit about whether confidence and performance moved together or diverged.]

### 3. What's Still Unclear
* [Aggregate the recurring themes in "remaining questions" — call out anything that echoes a misconception flagged at either checkpoint and was never fully resolved]

### 4. AI-Generated Teaching Recommendations for Next Cohort

> [One sentence of cohort evidence citing exact counts/percentages that justify the recommendations below, drawn from across the day's checkpoints and this reflection]

* **What to improve next time:** [the recurring misconception or gap to spend more time on, and the concrete change to content, delivery, or pacing that would address it] {{Learning Path}}
* **What follow-up learners need:** [what kind of participant profile — by experience, confidence, or recurring misconception — should get a pre-built follow-up resource or scaffold, and what it should cover] {{Learning Path}}

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
