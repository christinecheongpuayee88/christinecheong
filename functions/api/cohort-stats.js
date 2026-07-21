const CORS = {
  "Access-Control-Allow-Origin": "https://christinecheong.com",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const SHEETS = {
  1: { id: "15owxaxymBo6DLAAhQsaQkaCsnX-P-Szvfg45H9egB3o", label: "Beginning", type: "confidence" },
  2: { id: "1-RH_Zt7N0YLOHRL0DIxW3aLrX9m6YnlUgZC2kEdZ138", label: "Checkpoint 1", type: "accuracy" },
  3: { id: "1za_z495GBwSYSEEBW81bRWMTNUoXso1cqhRYvaaLP_g", label: "Checkpoint 2", type: "accuracy" },
  4: { id: "1eB2oPxMscUdh2uAN1ZKPYT-dI5k0_nJgdEWwneCIZZY", label: "Final", type: "confidence" },
};
const FORM_RANGE = "'Form Responses 1'!A1:Z1000";

// Question headers are matched by a short, special-character-free prefix so
// the exact Unicode punctuation in the live form (→, —, ₛ, …) can't break matching.
const CHECKPOINT_QUESTIONS = {
  2: [
    { headerPrefix: "In ARIMA(p,d,q), what does d represent", topic: "Differencing (d)", correct: "Order of differencing needed for stationarity" },
    { headerPrefix: "Which ACF/PACF pattern points to an AR(p)", topic: "AR/MA identification", correct: "ACF decays gradually, PACF cuts off after lag p" },
    { headerPrefix: "In SARIMA(p,d,q)(P,D,Q)", topic: "Seasonal period (s)", correct: "Number of periods per season (e.g. 12 for monthly)" },
    { headerPrefix: "Why do we need seasonal differencing", topic: "Seasonal differencing", correct: "Regular differencing removes trend; seasonal differencing removes the repeating s-period pattern" },
    { headerPrefix: "Between two candidate SARIMA models", topic: "Model selection (AIC/BIC)", correct: "The one with the lower AIC/BIC" },
    { headerPrefix: "True or False: a well-fitted SARIMA model", topic: "Residual diagnostics", correct: "True" },
  ],
  3: [
    { headerPrefix: "What's the key difference between ARIMA and ARIMAX", topic: "ARIMA vs ARIMAX", correct: "ARIMAX adds an exogenous predictor (a leading indicator) on top of Y's own past" },
    { headerPrefix: "In the Advertising", topic: "Identifying X and Y", correct: "X = Advertising spend, Y = Sales" },
    { headerPrefix: "Why include lagged versions of the exogenous variable", topic: "Lagged exogenous effects", correct: "The effect of X on Y is often delayed/distributed over time — a dynamic transfer-function relationship" },
    { headerPrefix: "True or False: in the workshop notebooks", topic: "Model evaluation (MAPE)", correct: "True" },
    { headerPrefix: "If adding more advertising lags", topic: "Overfitting / lag selection", correct: "Drop the less useful lags — more lags isn't automatically better; watch for overfitting" },
  ],
};

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

function normalize(s) {
  return (s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function findColumnIndex(headers, predicate) {
  return headers.findIndex(predicate);
}

function computeConfidenceStats(values) {
  const [headers, ...rows] = values.length ? values : [[]];
  if (!rows.length) return { responseCount: 0, confidence: null };

  const confIdx = findColumnIndex(headers, (h) => /confiden/i.test(h || ""));
  if (confIdx === -1) return { responseCount: rows.length, confidence: null };

  const scores = rows
    .map((r) => Number(r[confIdx]))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);

  if (!scores.length) return { responseCount: rows.length, confidence: null };

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const distribution = [1, 2, 3, 4, 5].map((v) => ({
    value: v,
    count: scores.filter((s) => s === v).length,
  }));

  return {
    responseCount: rows.length,
    confidence: { mean: Math.round(mean * 100) / 100, median, distribution },
  };
}

function computeAccuracyStats(values, questionDefs) {
  const [headers, ...rows] = values.length ? values : [[]];
  if (!rows.length) return { responseCount: 0, accuracy: null };

  const resolved = questionDefs.map((q) => ({
    ...q,
    colIdx: findColumnIndex(headers, (h) => (h || "").startsWith(q.headerPrefix)),
    correctNorm: normalize(q.correct),
  }));

  const n = rows.length;
  let totalCorrect = 0;
  let totalPossible = 0;

  const byQuestion = resolved.map((q) => {
    if (q.colIdx === -1) {
      return { topic: q.topic, correctPercent: null, topMisconception: null };
    }
    const answers = rows.map((r) => r[q.colIdx] || "");
    const correctCount = answers.filter((a) => normalize(a) === q.correctNorm).length;
    totalCorrect += correctCount;
    totalPossible += n;

    const wrongCounts = {};
    for (const a of answers) {
      const norm = normalize(a);
      if (!norm || norm === q.correctNorm) continue;
      wrongCounts[a] = (wrongCounts[a] || 0) + 1;
    }
    let topMisconception = null;
    let topCount = 0;
    for (const [answer, count] of Object.entries(wrongCounts)) {
      if (count > topCount) {
        topCount = count;
        topMisconception = { answer, percent: Math.round((count / n) * 1000) / 10 };
      }
    }

    return {
      topic: q.topic,
      correctPercent: Math.round((correctCount / n) * 1000) / 10,
      topMisconception,
    };
  });

  const meanScore = resolved.length ? (totalCorrect / n) : 0;
  const meanPercent = totalPossible ? Math.round((totalCorrect / totalPossible) * 1000) / 10 : null;

  return {
    responseCount: n,
    accuracy: {
      meanScore: Math.round(meanScore * 100) / 100,
      maxScore: resolved.length,
      meanPercent,
      byQuestion,
    },
  };
}

function readinessFromPercent(percent) {
  if (percent == null) return null;
  if (percent >= 70) return { level: "green", label: "Proceed" };
  if (percent >= 40) return { level: "amber", label: "Clarify briefly before continuing" };
  return { level: "red", label: "Revisit before progressing" };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const serviceAccountKey = context.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKey) {
      return new Response(JSON.stringify({ error: "Google service account key not configured" }), {
        status: 500,
        headers: CORS,
      });
    }

    const url = new URL(context.request.url);
    const stage = Number(url.searchParams.get("stage"));
    const expectedParam = url.searchParams.get("expected");
    const expectedCount = expectedParam ? Number(expectedParam) : null;

    if (![1, 2, 3, 4].includes(stage)) {
      return new Response(JSON.stringify({ error: "stage must be 1, 2, 3, or 4" }), { status: 400, headers: CORS });
    }

    const accessToken = await getGoogleAccessToken(serviceAccountKey);
    const { id: sheetId, label: stageLabel, type: metricType } = SHEETS[stage];
    const values = await readSheetValues(accessToken, sheetId, FORM_RANGE);

    let result = {
      stage,
      stageLabel,
      metricType,
      responseCount: 0,
      expectedCount,
      completionRate: null,
      confidence: null,
      accuracy: null,
      readiness: null,
      change: null,
    };

    if (metricType === "confidence") {
      const stats = computeConfidenceStats(values);
      result.responseCount = stats.responseCount;
      result.confidence = stats.confidence;

      // Stage 4 (Final) shows change in confidence vs Stage 1 (Beginning)
      if (stage === 4 && stats.confidence) {
        const priorValues = await readSheetValues(accessToken, SHEETS[1].id, FORM_RANGE);
        const priorStats = computeConfidenceStats(priorValues);
        if (priorStats.confidence) {
          result.change = {
            metric: "mean confidence",
            previousLabel: "Beginning",
            previousValue: priorStats.confidence.mean,
            currentValue: stats.confidence.mean,
            delta: Math.round((stats.confidence.mean - priorStats.confidence.mean) * 100) / 100,
          };
        }
      }
    } else {
      const stats = computeAccuracyStats(values, CHECKPOINT_QUESTIONS[stage]);
      result.responseCount = stats.responseCount;
      result.accuracy = stats.accuracy;
      result.readiness = stats.accuracy ? readinessFromPercent(stats.accuracy.meanPercent) : null;

      // Stage 3 (Checkpoint 2) shows change in accuracy vs Stage 2 (Checkpoint 1)
      if (stage === 3 && stats.accuracy) {
        const priorValues = await readSheetValues(accessToken, SHEETS[2].id, FORM_RANGE);
        const priorStats = computeAccuracyStats(priorValues, CHECKPOINT_QUESTIONS[2]);
        if (priorStats.accuracy && priorStats.accuracy.meanPercent != null) {
          result.change = {
            metric: "accuracy",
            previousLabel: "Checkpoint 1",
            previousValue: priorStats.accuracy.meanPercent,
            currentValue: stats.accuracy.meanPercent,
            delta: Math.round((stats.accuracy.meanPercent - priorStats.accuracy.meanPercent) * 10) / 10,
          };
        }
      }
    }

    if (expectedCount) {
      result.completionRate = Math.round((result.responseCount / expectedCount) * 1000) / 10;
    }

    return new Response(JSON.stringify(result), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
