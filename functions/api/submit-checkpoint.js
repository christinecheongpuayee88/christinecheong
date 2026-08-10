const CORS = {
  "Access-Control-Allow-Origin": "https://christinecheong.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const TAB_NAME = "Form Responses 1";

const SHEETS = {
  2: { id: "1-RH_Zt7N0YLOHRL0DIxW3aLrX9m6YnlUgZC2kEdZ138", label: "Checkpoint 1" },
  3: { id: "1za_z495GBwSYSEEBW81bRWMTNUoXso1cqhRYvaaLP_g", label: "Checkpoint 2" },
};

// headerPrefix must match the same prefixes cohort-stats.js's CHECKPOINT_QUESTIONS
// uses to find each question's column in the live Google Sheet — keep these in sync.
// options/feedback are only used by this file (results rendering) — cohort-stats.js
// doesn't need them, so they're not duplicated there.
const QUESTIONS = {
  2: [
    {
      headerPrefix: "In ARIMA(p,d,q), what does d represent",
      question: "In ARIMA(p,d,q), what does d represent?",
      options: [
        "Number of autoregressive terms",
        "Order of differencing needed for stationarity",
        "Number of moving-average terms",
        "Number of periods per season",
      ],
      correct: "Order of differencing needed for stationarity",
      feedback: "d is the order of integration — how many times the series must be differenced to remove trend and become stationary.",
    },
    {
      headerPrefix: "Which ACF/PACF pattern points to an AR(p)",
      question: "Which ACF/PACF pattern points to an AR(p) process rather than MA(q)?",
      options: [
        "ACF cuts off sharply, PACF decays gradually",
        "ACF decays gradually, PACF cuts off after lag p",
        "Both cut off immediately",
        "Both decay gradually forever",
      ],
      correct: "ACF decays gradually, PACF cuts off after lag p",
      feedback: "Gradual ACF decay with a sharp PACF cutoff at lag p is the signature of an AR(p) process — the reverse pattern (sharp ACF cutoff, gradual PACF decay) points to MA(q) instead.",
    },
    {
      headerPrefix: "In SARIMA(p,d,q)(P,D,Q)",
      question: "In SARIMA(p,d,q)(P,D,Q)ₛ, what does s represent?",
      options: [
        "Number of seasonal AR terms",
        "Significance level of the model",
        "Number of periods per season (e.g. 12 for monthly)",
        "Number of standard deviations",
      ],
      correct: "Number of periods per season (e.g. 12 for monthly)",
      feedback: "s is the seasonal period length — how many time steps make up one full seasonal cycle (e.g. 12 for monthly data with yearly seasonality).",
    },
    {
      headerPrefix: "Why do we need seasonal differencing",
      question: "Why do we need seasonal differencing in addition to regular differencing?",
      options: [
        "We don't — regular differencing removes seasonality too",
        "Regular differencing removes trend; seasonal differencing removes the repeating s-period pattern",
        "Seasonal differencing replaces the need for an AR term",
        "It only matters for daily data",
      ],
      correct: "Regular differencing removes trend; seasonal differencing removes the repeating s-period pattern",
      feedback: "Regular differencing removes trend; seasonal differencing (at lag s) removes the repeating seasonal pattern — series with both trend and seasonality typically need both.",
    },
    {
      headerPrefix: "Between two candidate SARIMA models",
      question: "Between two candidate SARIMA models with white-noise residuals, which do you prefer?",
      options: [
        "The one with more parameters",
        "The one with the lower AIC/BIC",
        "The one with the higher log-likelihood only",
        "It doesn't matter, pick either",
      ],
      correct: "The one with the lower AIC/BIC",
      feedback: "Once residuals are white noise for multiple candidates, AIC/BIC breaks the tie by penalizing unnecessary complexity — lower is better.",
    },
    {
      headerPrefix: "True or False: a well-fitted SARIMA model",
      question: "True or False: a well-fitted SARIMA model should leave residuals that look like white noise.",
      options: ["True", "False"],
      correct: "True",
      feedback: "If the model captured all the structure in the series, what's left over should be unpredictable — i.e. white noise. Leftover pattern means the model missed something.",
    },
    {
      headerPrefix: "Model A performs better on the training",
      question: "Model A performs better on the training data for air passenger data while Model B forecasts the test data more accurately. Which would you choose for forecasting future hotel occupancy and why?",
      options: [
        "Model A, because it fits the training data best",
        "Model B, because it generalizes better to unseen data",
        "Either model — training and test performance don't matter for forecasting",
        "Neither — you should always use a simpler baseline instead",
      ],
      correct: "Model B, because it generalizes better to unseen data",
      feedback: "Forecasting is about performance on data the model hasn't seen yet — test-set accuracy predicts real future performance, while a model that only looks good on training data (like Model A) is often just overfitting and won't carry that advantage into actual future occupancy.",
    },
    {
      headerPrefix: "SARIMA forecasts hotel occupancy to peak",
      question: "SARIMA forecasts hotel occupancy to peak next month. What should hotel management consider doing more and why?",
      options: [
        "Increase staffing and room availability to meet the anticipated peak demand",
        "Reduce staffing since forecasts are often wrong",
        "Ignore the forecast since occupancy is inherently unpredictable",
        "Cancel bookings near the peak to avoid overcrowding",
      ],
      correct: "Increase staffing and room availability to meet the anticipated peak demand",
      feedback: "A forecasted demand peak is only useful if it changes a decision — management should scale up staffing and room availability ahead of the peak so the business is actually prepared for it, rather than treating the forecast as just an interesting number.",
    },
    // Q9/Q10 are the same two application scenarios as Q7/Q8, but
    // open-ended — AI-graded rather than exact-match, so type: "open"
    // routes them to gradeOpenEndedAnswers() instead of the deterministic
    // normalize()-comparison path the other questions use.
    {
      headerPrefix: "Open-ended: Model A performs better on the training",
      question: "Open-ended: Model A performs better on the training data for air passenger data while Model B forecasts the test data more accurately. Which would you choose for forecasting future hotel occupancy and why?",
      type: "open",
      gradingCriteria: "Correct if the student chooses Model B (or otherwise clearly favors test/out-of-sample performance over training fit), and reasons that generalization to unseen data matters more for forecasting than training fit — showing awareness that Model A's training advantage likely reflects overfitting rather than genuine forecasting skill.",
    },
    {
      headerPrefix: "Open-ended: SARIMA forecasts hotel occupancy to peak",
      question: "Open-ended: SARIMA forecasts hotel occupancy to peak next month. What should hotel management consider doing more and why?",
      type: "open",
      gradingCriteria: "Correct if the answer centers on preparing operationally for the demand peak — e.g. increasing staffing, room availability, supply, or otherwise scaling capacity ahead of time — showing the student understands a forecast should translate into an operational or business decision, not just be observed.",
    },
  ],
  3: [
    {
      headerPrefix: "What's the key difference between ARIMA and ARIMAX",
      question: "What's the key difference between ARIMA and ARIMAX?",
      correct: "ARIMAX adds an exogenous predictor (a leading indicator) on top of Y's own past",
    },
    {
      headerPrefix: "In the Advertising",
      question: "In the Advertising → Sales example, which is X and which is Y?",
      correct: "X = Advertising spend, Y = Sales",
    },
    {
      headerPrefix: "Why include lagged versions of the exogenous variable",
      question: "Why include lagged versions of the exogenous variable (AdvLag1, AdvLag2, …) instead of just its current value?",
      correct: "The effect of X on Y is often delayed/distributed over time — a dynamic transfer-function relationship",
    },
    {
      headerPrefix: "True or False: in the workshop notebooks",
      question: "True or False: in the workshop notebooks, models were compared using MAPE on a held-out test set.",
      correct: "True",
    },
    {
      headerPrefix: "If adding more advertising lags",
      question: "If adding more advertising lags doesn't improve (or worsens) out-of-sample MAPE, what should you do?",
      correct: "Drop the less useful lags — more lags isn't automatically better; watch for overfitting",
    },
  ],
};

const REFLECTION_HEADER = "Reflection — Do you have any further questions?";

function normalize(s) {
  return (s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

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

async function writeSheetValues(accessToken, spreadsheetId, range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    range
  )}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to write sheet header row");
}

async function appendSheetRow(accessToken, spreadsheetId, range, row) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    range
  )}:append?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to append response row");
}

// Grades every open-ended question in one OpenAI call (not one call per
// question) — cheap and fast for the small number of open questions this
// checkpoint has. Returns a map of headerPrefix -> { correct, modelAnswer,
// feedback }, keyed by headerPrefix since that's already the stable
// identifier used everywhere else in this file.
async function gradeOpenEndedAnswers(apiKey, openQuestions, openAnswers) {
  const blocks = openQuestions
    .map(
      (q, i) => `Question ${i + 1}: ${q.question}
Grading criteria: ${q.gradingCriteria}
Student's answer: ${openAnswers[i]}`
    )
    .join("\n\n");

  const prompt = `You are grading open-ended application questions on a student's SARIMA checkpoint quiz. For each question, judge whether the student's answer satisfies the grading criteria — it doesn't need to match any exact wording, just demonstrate the right reasoning. Then write one sentence of specific feedback that references what the student actually wrote, not generic praise or criticism.

${blocks}

Respond with ONLY a JSON object in exactly this shape, one entry per question in order, keys "q1", "q2", etc.:
{"q1": {"correct": true or false, "modelAnswer": "one sentence describing what a correct answer looks like", "feedback": "one sentence of specific feedback tied to the student's actual answer"}, "q2": {...}}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "OpenAI API error while grading open-ended answers");

  const parsed = JSON.parse(data.choices[0].message.content);
  const byHeaderPrefix = {};
  openQuestions.forEach((q, i) => {
    const entry = parsed["q" + (i + 1)] || { correct: false, modelAnswer: "", feedback: "Could not be graded automatically." };
    byHeaderPrefix[q.headerPrefix] = entry;
  });
  return byHeaderPrefix;
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

    const body = await context.request.json();
    const stage = Number(body.stage);
    const questions = QUESTIONS[stage];
    if (!questions) {
      return new Response(JSON.stringify({ error: "stage must be 2 or 3" }), { status: 400, headers: CORS });
    }

    const answers = body.answers;
    if (!Array.isArray(answers) || answers.length !== questions.length || answers.some((a) => !a || !a.trim())) {
      return new Response(JSON.stringify({ error: "All questions must be answered" }), {
        status: 400,
        headers: CORS,
      });
    }

    const openIndices = questions.reduce((acc, q, i) => {
      if (q.type === "open") acc.push(i);
      return acc;
    }, []);
    if (openIndices.length && !apiKey) {
      return new Response(JSON.stringify({ error: "API key not configured for grading open-ended answers" }), {
        status: 500,
        headers: CORS,
      });
    }
    let openGrades = {};
    if (openIndices.length) {
      const openQuestions = openIndices.map((i) => questions[i]);
      const openAnswers = openIndices.map((i) => answers[i]);
      openGrades = await gradeOpenEndedAnswers(apiKey, openQuestions, openAnswers);
    }

    const accessToken = await getGoogleAccessToken(serviceAccountKey);
    const { id: sheetId } = SHEETS[stage];

    let headerRows = await readSheetValues(accessToken, sheetId, `'${TAB_NAME}'!A1:Z1`);
    let headers = headerRows[0] || [];
    // Append-only: any question not yet represented as a header gets added
    // as a brand-new trailing column, never inserted before existing ones.
    // Existing columns (and every already-submitted row's data) keep the
    // exact same position — critical the first time this runs after adding
    // Q7/Q8 to a sheet that already has real student responses under the
    // old 6-question header row.
    const missingQuestions = questions.filter(
      (q) => !headers.some((h) => (h || "").startsWith(q.headerPrefix))
    );
    if (!headers.length) {
      headers = ["Timestamp", ...questions.map((q) => q.question), REFLECTION_HEADER];
      await writeSheetValues(accessToken, sheetId, `'${TAB_NAME}'!A1:${String.fromCharCode(64 + headers.length)}1`, [headers]);
    } else if (missingQuestions.length) {
      headers = [...headers, ...missingQuestions.map((q) => q.question)];
      await writeSheetValues(accessToken, sheetId, `'${TAB_NAME}'!A1:${String.fromCharCode(64 + headers.length)}1`, [headers]);
    }

    const row = headers.map((h) => {
      if (/^timestamp$/i.test(h || "")) return new Date().toISOString();
      if (/further question/i.test(h || "")) return body.reflection || "";
      const qIdx = questions.findIndex((q) => (h || "").startsWith(q.headerPrefix));
      return qIdx !== -1 ? answers[qIdx] : "";
    });

    await appendSheetRow(accessToken, sheetId, `'${TAB_NAME}'!A:Z`, row);

    const results = questions.map((q, i) => {
      if (q.type === "open") {
        const grade = openGrades[q.headerPrefix] || { correct: false, modelAnswer: "", feedback: "Could not be graded automatically." };
        return {
          question: q.question,
          options: null,
          yourAnswer: answers[i],
          correctAnswer: grade.modelAnswer,
          correct: !!grade.correct,
          feedback: grade.feedback,
        };
      }
      return {
        question: q.question,
        options: q.options || null,
        yourAnswer: answers[i],
        correctAnswer: q.correct,
        correct: normalize(answers[i]) === normalize(q.correct),
        feedback: q.feedback || null,
      };
    });
    const score = results.filter((r) => r.correct).length;

    return new Response(JSON.stringify({ success: true, score, total: questions.length, results }), {
      status: 200,
      headers: CORS,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
