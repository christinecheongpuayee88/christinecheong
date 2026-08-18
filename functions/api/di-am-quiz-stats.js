const CORS = {
  "Access-Control-Allow-Origin": "https://christinecheong.com",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const TAB_NAME = "Form Responses 1";
const FORM_RANGE = `'${TAB_NAME}'!A1:Z1000`;

// Response sheets linked from the real Google Forms (Responses tab -> Link to
// Sheets). A native Google-Form-linked sheet always names its tab "Form
// Responses 1". Each sheet must be shared (Editor) with the service account
// before this endpoint can read it.
const SHEETS = {
  1: {
    id: "1nq8C0vL4Odk3f3vd7CfLEtsBZxZl3BPlDsrHwJKZRvE",
    label: "Basic Quiz (Sections 1–2)",
    formUrl: "https://docs.google.com/forms/d/e/1FAIpQLSfIVhcopGL4ZAkdxtI1Ktd5-cACTN3_sobSLrPWM-XHunkP7w/viewform",
  },
  2: {
    id: "1Tv3CQVM7XBMm5d1DHeMq8-hiZM5zwcmf7n3fsCqzZ4o",
    label: "Basic Quiz (Sections 3–4)",
    formUrl: "https://docs.google.com/forms/d/e/1FAIpQLSffppB2Qcaggz8rhJsL0c_1ePCMbpZ6FacaWlinUhROep3ECA/viewform",
  },
  3: {
    id: "1m6JpE3AIB_KfL1eHsOocqLTld1_6sMdw8RlF7xSRouA",
    label: "Basic Quiz (Sections 5–6)",
    formUrl: "https://docs.google.com/forms/d/e/1FAIpQLSfFgQg2XnezYIVH4k126WY8f_eojHj9Holrqfl0NSwKoR4AUw/viewform",
  },
};

// headerPrefix must match the start of each question's exact text in the
// matching live Google Form above — keep these in sync if the form
// questions change.
const QUESTIONS = {
  1: [
    { headerPrefix: "Q1. What is the main goal of Decision Intelligence", topic: "Goal of Decision Intelligence", correct: "Improve decisions and outcomes" },
    { headerPrefix: "Q2. Decision Intelligence combines data, analytics and AI with what", topic: "What DI combines", correct: "Human judgement" },
    { headerPrefix: "Q3. Which type of analytics answers", topic: "Types of analytics", correct: "Diagnostic analytics" },
    { headerPrefix: "Q4. Which AI role includes search, summarization and document review", topic: "AI roles", correct: "Information partner" },
    { headerPrefix: "Q5. What does RGC stand for in the deck's prompting framework", topic: "RGC prompting framework", correct: "Role, Goal and Context" },
  ],
  2: [
    { headerPrefix: "Q1. What does context mean when working with an LLM", topic: "Context in LLMs", correct: "Everything the LLM can access when answering" },
    { headerPrefix: "Q2. What is the fastest way to give an LLM direct context from a business report", topic: "Giving an LLM direct context", correct: "Upload the report" },
    { headerPrefix: "Q3. Which tool is most suitable for an exact numerical calculation", topic: "Choosing the right tool", correct: "Spreadsheet, calculator or code" },
    { headerPrefix: "Q4. What three elements are used to frame a problem in Section 4", topic: "Framing a problem", correct: "Problem, Decision and Gaps" },
    { headerPrefix: "Q5. What is the primary role of AI as an evidence organiser", topic: "AI as evidence organiser", correct: "Summarize and structure supplied evidence" },
  ],
  3: [
    { headerPrefix: "Q1. What is AI particularly useful for during brainstorming", topic: "AI's role in brainstorming", correct: "Generating numerous possible options" },
    { headerPrefix: "Q2. What is the brainstorming recipe presented in Section 5", topic: "Brainstorming recipe", correct: "Context, options and iteration" },
    { headerPrefix: "Q3. What should learners do before asking AI to generate explanations", topic: "Explaining before AI does", correct: "Write two or three explanations themselves" },
    { headerPrefix: "Q4. What is AI sycophancy", topic: "AI sycophancy", correct: "AI agreeing with the user's stated preference" },
    { headerPrefix: "Q5. Which statement captures the Thinking Partner takeaway", topic: "Thinking Partner takeaway", correct: "AI broadens and tests; humans judge what is supported" },
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

  const meanScore = resolved.length ? totalCorrect / n : 0;
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
    const stage = Number(url.searchParams.get("stage")) || 1;
    if (!SHEETS[stage]) {
      return new Response(JSON.stringify({ error: "stage must be 1, 2, or 3" }), { status: 400, headers: CORS });
    }

    const accessToken = await getGoogleAccessToken(serviceAccountKey);
    const { id: sheetId, label: stageLabel } = SHEETS[stage];
    const values = await readSheetValues(accessToken, sheetId, FORM_RANGE);

    const stats = computeAccuracyStats(values, QUESTIONS[stage]);

    const result = {
      stageLabel,
      responseCount: stats.responseCount,
      accuracy: stats.accuracy,
      readiness: stats.accuracy ? readinessFromPercent(stats.accuracy.meanPercent) : null,
    };

    return new Response(JSON.stringify(result), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
