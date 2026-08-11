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

// MVP philosophy: at each checkpoint the instructor gets exactly 3 things —
// a cohort signal, ONE recommended move, and a concrete action — not all
// 3 levels competing for attention at once. The model rates the cohort on
// the same 3 levels used elsewhere in this system (Understanding of
// Concepts / Interpretation & Application / Critical Judgment) and drafts
// a ready-to-use action for all 3, but which ONE is "Recommended" is
// decided deterministically in code (pickRecommendedLevel below), not left
// to the model — so the choice is explainable: clarify a real gap first,
// then work on application, and only recommend challenging once both are
// solid.
function buildQuickSignalPrompt(stage, rawData, priorReports) {
  const isStart = stage === 1;

  const dataSection = isStart
    ? `### RAW INTAKE DATA (Pre-Class Survey — experience, confidence, concerns, goals) ###\n${rawData}`
    : stage === 2
    ? `### RAW CHECKPOINT 1 DATA (SARIMA quiz — selected answers and points scored) ###\n${rawData}\n\n### BEGINNING-OF-CLASS REPORT (for comparison) ###\n${priorReports.Beginning || "[Not available]"}`
    : stage === 3
    ? `### RAW CHECKPOINT 2 DATA (ARIMAX quiz — selected answers and points scored) ###\n${rawData}\n\n### CHECKPOINT 1 REPORT (for comparison — the cohort signal below must note what changed since Checkpoint 1) ###\n${priorReports["Checkpoint 1"] || "[Not available]"}`
    : `### RAW REFLECTION DATA (End-of-class — confidence, application context, remaining questions) ###\n${rawData}\n\n### CHECKPOINT 1 REPORT ###\n${priorReports["Checkpoint 1"] || "[Not available]"}\n\n### CHECKPOINT 2 REPORT ###\n${priorReports["Checkpoint 2"] || "[Not available]"}`;

  const understandingBasis = isStart
    ? "stated prior experience with time series forecasting (not quiz accuracy — there is none yet)"
    : "quiz accuracy on concept-identification questions";
  const applicationBasis = isStart
    ? "stated confidence applying it to their own business problem"
    : "quiz accuracy on interpretation/business-implication questions, and how well they connect findings to decisions";
  const signalNote = stage === 3 ? " Explicitly name what changed since Checkpoint 1 (improved, held steady, or a new gap)." : stage === 4 ? " Synthesize across the whole day, not just the reflection alone." : "";

  return `You are rating one cohort for a live instructor dashboard, using this exact 3-level framework:
1. Understanding of Concepts (Clarify) — is anything still unclear or misunderstood? Misconceptions, low accuracy, low confidence.
2. Interpretation & Application (Apply) — can they interpret a finding and connect it to a real decision or context, not just repeat the concept back?
3. Critical Judgment (Challenge) — can they question an assumption, weigh a trade-off, or reason about a limitation, rather than just accepting the "correct" answer?

${dataSection}

#################

Rate the cohort on the first two levels as exactly one of "Strong", "Competent", or "Developing":
- Understanding of Concepts: based on ${understandingBasis}.
- Interpretation & Application: based on ${applicationBasis}.

Then write a ready-to-run classroom action for EACH of the 3 levels (not just one — the instructor sees only one by default but can reveal the other two). Each action is a single discussion question or prompt short enough to read aloud, plus a realistic duration (e.g. "5-minute discussion").

Return ONLY strict JSON, no markdown, no commentary, in exactly this shape:
{
  "understanding": "Strong" | "Competent" | "Developing",
  "application": "Strong" | "Competent" | "Developing",
  "signal": "1-2 sentences citing real evidence (counts/percentages if available) that justifies both ratings above.${signalNote}",
  "moves": {
    "clarify": { "topic": "short topic name", "duration": "e.g. 5-minute discussion", "prompt": "the actual question/action to pose to the cohort" },
    "apply": { "topic": "...", "duration": "...", "prompt": "..." },
    "challenge": { "topic": "...", "duration": "...", "prompt": "..." }
  }
}`;
}

// Deterministic, explainable priority: clarify a real gap before asking the
// cohort to apply it, and only recommend challenging once both are solid —
// mirrors the same Clarify-before-Apply-before-Challenge progression used
// throughout the rest of this system, just resolved to a single pick here.
function pickRecommendedLevel(understanding, application) {
  if (understanding === "Developing") return "clarify";
  if (application === "Developing") return "apply";
  return "challenge";
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

    const prompt = buildQuickSignalPrompt(stage, rawData, priorReports);

    const llmRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You output only a single JSON object, nothing else — no markdown, no code fences." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const llmData = await llmRes.json();
    if (!llmRes.ok) {
      return new Response(JSON.stringify({ error: llmData.error?.message || "OpenAI API error" }), {
        status: llmRes.status,
        headers: CORS,
      });
    }

    const parsed = JSON.parse(llmData.choices[0].message.content);
    if (!parsed.moves || !parsed.understanding || !parsed.application) {
      throw new Error("Malformed quick-signal response");
    }

    const recommended = pickRecommendedLevel(parsed.understanding, parsed.application);

    return new Response(
      JSON.stringify({
        stage,
        stageLabel,
        understanding: parsed.understanding,
        application: parsed.application,
        signal: parsed.signal || "",
        recommended,
        moves: parsed.moves,
      }),
      { status: 200, headers: CORS }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
