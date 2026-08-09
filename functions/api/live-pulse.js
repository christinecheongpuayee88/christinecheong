const CORS = {
  "Access-Control-Allow-Origin": "https://christinecheong.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// One backing Google Sheet per Part, self-provisioned on first use (found by
// name via Drive, created via Sheets if missing) — the instructor never has
// to create or share anything manually. Each sheet is a flat append-only
// log of QUESTION and RESPONSE rows; "the current question" is just the
// most recent QUESTION row, and "its responses" are every RESPONSE row that
// came after it. No overwriting, no separate state table.
const PART_SHEET_TITLES = {
  1: "Live Discussion Pulse — Part 1 (SARIMA)",
  2: "Live Discussion Pulse — Part 2 (ARIMAX)",
};
const DATA_RANGE = "Sheet1!A:C";

function b64url(bytes) {
  const str = typeof bytes === "string" ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// drive.file scope (in addition to spreadsheets) so this credential can find
// and create only the files it owns itself — never broader Drive access.
async function getGoogleAccessToken(serviceAccountKeyJson) {
  const key = JSON.parse(serviceAccountKeyJson);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file",
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

async function findOrCreateSheet(accessToken, title) {
  const q = encodeURIComponent(`name='${title}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const searchData = await searchRes.json();
  if (!searchRes.ok) throw new Error(searchData.error?.message || "Failed to search Drive");
  if (searchData.files && searchData.files.length) return searchData.files[0].id;

  const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { title } }),
  });
  const createData = await createRes.json();
  if (!createRes.ok) throw new Error(createData.error?.message || "Failed to create sheet");
  return createData.spreadsheetId;
}

async function readRows(accessToken, spreadsheetId) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(DATA_RANGE)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to read sheet");
  return data.values || [];
}

async function appendRow(accessToken, spreadsheetId, type, text) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    DATA_RANGE
  )}:append?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [[type, new Date().toISOString(), text]] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to append row");
}

// The current question is the last QUESTION row; its responses are every
// RESPONSE row timestamped after it. Responses submitted before any
// question was ever published, or after a since-superseded one, are simply
// excluded — no cleanup needed when a new question is published.
function computeState(rows) {
  let questionText = null;
  let questionTimestamp = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][0] === "QUESTION") {
      questionText = rows[i][2] || "";
      questionTimestamp = rows[i][1] || "";
      break;
    }
  }
  const responses = questionTimestamp
    ? rows.filter((r) => r[0] === "RESPONSE" && r[1] > questionTimestamp).map((r) => r[2] || "")
    : [];
  return { question: questionText, responses };
}

// Same 3x3 micro-intervention move library used in cohort-report.js,
// duplicated here per this project's convention of self-contained function
// files. Kept in sync by hand if the library ever changes.
const MICRO_INTERVENTIONS_URL = "https://christinecheong.com/micro-interventions";
const ALL_MOVES = {
  CLARIFY: {
    "Quick quiz": `${MICRO_INTERVENTIONS_URL}#clarify-quick-quiz`,
    "Misconception check": `${MICRO_INTERVENTIONS_URL}#clarify-misconception-check`,
    "Worked example": `${MICRO_INTERVENTIONS_URL}#clarify-worked-example`,
  },
  APPLY: {
    "Mini case": `${MICRO_INTERVENTIONS_URL}#apply-mini-case`,
    "Think–Pair–Share": `${MICRO_INTERVENTIONS_URL}#apply-think-pair-share`,
    "Different context": `${MICRO_INTERVENTIONS_URL}#apply-different-context`,
  },
  CHALLENGE: {
    "What-if scenario": `${MICRO_INTERVENTIONS_URL}#challenge-what-if`,
    "Multiple perspectives": `${MICRO_INTERVENTIONS_URL}#challenge-multiple-perspectives`,
    "Challenge assumptions": `${MICRO_INTERVENTIONS_URL}#challenge-assumptions`,
  },
};
const CHALLENGE_LIVE_TOOLS = {
  "Multiple perspectives": { url: "https://christinecheong.com/agents-hub/perspectives-agent.html", label: "Multiple Perspectives Agent" },
  "Challenge assumptions": { url: "https://christinecheong.com/agents-hub/ai-council-agent.html", label: "AI Advisory Council" },
};

function buildMovesReferenceBlock() {
  const lines = [];
  for (const [level, moves] of Object.entries(ALL_MOVES)) {
    lines.push(`${level} moves:`);
    for (const [move, url] of Object.entries(moves)) {
      lines.push(`- "${move}" → ${url} (link text must be exactly "${move}")`);
    }
  }
  lines.push('CHALLENGE live-tool links (only "Multiple perspectives" and "Challenge assumptions" have one):');
  for (const [move, l] of Object.entries(CHALLENGE_LIVE_TOOLS)) {
    lines.push(`- If you pick "${move}" → also link: ${l.url} (link text must be "${l.label}")`);
  }
  return lines.join("\n");
}

function buildSynthesisPrompt(part, question, responses) {
  const partLabel = part === 1 ? "Part 1 — SARIMA" : "Part 2 — ARIMAX";
  const numbered = responses.map((r, i) => `${i + 1}. ${r}`).join("\n");

  return `You are helping a workshop instructor read the pulse of their live classroom during a hands-on exercise. Do not answer the students yourself — synthesize their reasoning for the instructor, who will decide what to do with it.

### QUESTION THE INSTRUCTOR JUST ASKED (${partLabel}) ###
${question}

### RAW STUDENT RESPONSES (${responses.length} total) ###
${numbered}

#################

Structure your response exactly as follows:

## 💬 Live Discussion Pulse — ${partLabel}

**Question:** "${question}"
**${responses.length} responses**

### Emerging themes
* **[count] — [short theme label]:** [one clause describing that reasoning pattern, in the students' own terms where possible]
(2-4 bullets, ordered by count descending, covering the real spread of reasoning actually present — never force a theme that isn't genuinely there, and never invent counts that don't sum sensibly to the total.)

### Recommended move
Pick exactly ONE single move — not three like a structured report, since this is one live in-the-moment decision — from whichever level best fits what the responses actually reveal right now:
${buildMovesReferenceBlock()}

[emoji: 🔴 for CLARIFY / 🟢 for APPLY / 🔵 for CHALLENGE] **[LEVEL] — [chosen move's exact link text, verbatim](that move's URL from the reference above):** [the specific facilitation instruction in one sentence, tied to what the responses actually showed]. If you picked "Multiple perspectives" or "Challenge assumptions", also append [its live-tool link text](its exact live-tool URL) — otherwise append nothing further.

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
      return new Response(JSON.stringify({ error: "Google service account key not configured" }), { status: 500, headers: CORS });
    }

    const body = await context.request.json();
    const part = Number(body.part);
    const action = body.action;
    if (![1, 2].includes(part)) {
      return new Response(JSON.stringify({ error: "part must be 1 or 2" }), { status: 400, headers: CORS });
    }
    if (!["publish-question", "get-state", "submit-response", "synthesize"].includes(action)) {
      return new Response(JSON.stringify({ error: "invalid action" }), { status: 400, headers: CORS });
    }

    const accessToken = await getGoogleAccessToken(serviceAccountKey);
    const spreadsheetId = await findOrCreateSheet(accessToken, PART_SHEET_TITLES[part]);

    if (action === "publish-question") {
      const question = typeof body.question === "string" ? body.question.trim() : "";
      if (!question) {
        return new Response(JSON.stringify({ error: "question is required" }), { status: 400, headers: CORS });
      }
      await appendRow(accessToken, spreadsheetId, "QUESTION", question);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });
    }

    if (action === "submit-response") {
      const response = typeof body.response === "string" ? body.response.trim() : "";
      if (!response) {
        return new Response(JSON.stringify({ error: "response is required" }), { status: 400, headers: CORS });
      }
      await appendRow(accessToken, spreadsheetId, "RESPONSE", response);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });
    }

    if (action === "get-state") {
      const rows = await readRows(accessToken, spreadsheetId);
      const { question, responses } = computeState(rows);
      return new Response(
        JSON.stringify({ question, responseCount: responses.length }),
        { status: 200, headers: CORS }
      );
    }

    // action === "synthesize"
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API key not configured" }), { status: 500, headers: CORS });
    }
    const rows = await readRows(accessToken, spreadsheetId);
    const { question, responses } = computeState(rows);
    if (!question) {
      return new Response(JSON.stringify({ error: "No question has been published yet for this part" }), { status: 400, headers: CORS });
    }
    if (!responses.length) {
      return new Response(JSON.stringify({ error: "No responses yet for the current question" }), { status: 400, headers: CORS });
    }

    const prompt = buildSynthesisPrompt(part, question, responses);
    const llmRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const llmData = await llmRes.json();
    if (!llmRes.ok) {
      return new Response(JSON.stringify({ error: llmData.error?.message || "OpenAI API error" }), { status: llmRes.status, headers: CORS });
    }

    return new Response(
      JSON.stringify({ question, responseCount: responses.length, synthesis: llmData.choices[0].message.content }),
      { status: 200, headers: CORS }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
