const CORS = {
  "Access-Control-Allow-Origin": "https://christinecheong.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// One backing Google Sheet per Part — a blank sheet the instructor creates
// once and shares with the same service account used for every other sheet
// in this system (self-provisioning via the Drive API was tried first, but
// service accounts outside a Workspace/Shared Drive have no Drive storage
// quota of their own and can't create files — a Google account limitation,
// not fixable from here). Each sheet is a flat append-only log of QUESTION
// and RESPONSE rows; "the current question" is just the most recent
// QUESTION row, and "its responses" are every RESPONSE row that came after
// it. No overwriting, no separate state table.
const PART_SHEETS = {
  1: { id: "1i-7un4_niRGQDnvUa-19OznB2Xso7i35yBxe3PGdolo", label: "Part 1 (SARIMA)" },
  2: { id: "1Yd-awRPTq8po2PmPQx8D4o4_AGDB22_z0Z5N0_t2Cx0", label: "Part 2 (ARIMAX)" },
};
const DATA_RANGE = "Sheet1!A:C";

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

// Overwrites just the text of one existing row in place (column C only —
// type and timestamp untouched), used by "edit-question" to fix a question
// without starting a new round. rowNumber is 1-based, matching the sheet's
// actual row (data starts at row 1, no header row).
async function updateRowText(accessToken, spreadsheetId, rowNumber, text) {
  const range = `Sheet1!C${rowNumber}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    range
  )}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [[text]] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to update row");
}

// The current question is the last QUESTION row; its responses are every
// RESPONSE row timestamped after it. Responses submitted before any
// question was ever published, or after a since-superseded one, are simply
// excluded — no cleanup needed when a new question is published. THEMES
// rows work the same way: the latest one timestamped after the current
// question is "the results for this question" — written once per
// synthesize call (see onRequestPost), student-visible, recommendation
// section stripped out before it's ever persisted.
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
  let themesText = null;
  if (questionTimestamp) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i][0] === "THEMES" && rows[i][1] > questionTimestamp) {
        themesText = rows[i][2] || "";
        break;
      }
    }
  }
  return { question: questionText, responses, themesText };
}

// 1-based sheet row number of the last QUESTION row, or null if none exists
// yet — used by "edit-question" to know which row to overwrite in place.
function findLastQuestionRowNumber(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][0] === "QUESTION") return i + 1;
  }
  return null;
}

// Same 3x3 micro-intervention move library used in cohort-report.js,
// duplicated here per this project's convention of self-contained function
// files. Kept in sync by hand if the library ever changes.
const MICRO_INTERVENTIONS_URL = "https://christinecheong.com/micro-interventions";
const ALL_MOVES = {
  CLARIFY: {
    "Quick quiz": `${MICRO_INTERVENTIONS_URL}#clarify-quick-quiz`,
    "Misconception check": `${MICRO_INTERVENTIONS_URL}#clarify-misconception-check`,
  },
  APPLY: {
    "Retail case": `${MICRO_INTERVENTIONS_URL}#apply-case-retail`,
    "Hospitality case": `${MICRO_INTERVENTIONS_URL}#apply-case-hospitality`,
    "Transport case": `${MICRO_INTERVENTIONS_URL}#apply-case-transport`,
    "Healthcare case": `${MICRO_INTERVENTIONS_URL}#apply-case-healthcare`,
  },
  CHALLENGE: {
    "What-if scenario": `${MICRO_INTERVENTIONS_URL}#challenge-what-if`,
    "Multiple perspectives": `${MICRO_INTERVENTIONS_URL}#challenge-multiple-perspectives`,
    "Challenge assumptions": `${MICRO_INTERVENTIONS_URL}#challenge-assumptions`,
    "Reframe the problem": `${MICRO_INTERVENTIONS_URL}#challenge-reframe-problem`,
    "Fill the evidence gap": `${MICRO_INTERVENTIONS_URL}#challenge-evidence-gap`,
    "Independent data check": `${MICRO_INTERVENTIONS_URL}#challenge-data-check`,
  },
};
const CHALLENGE_LIVE_TOOLS = {
  "What-if scenario": { url: "https://christinecheong.com/agents-hub/ai-council-agent.html", label: "AI Advisory Council" },
  "Multiple perspectives": { url: "https://christinecheong.com/agents-hub/perspectives-agent.html", label: "Multiple Perspectives Agent" },
  "Challenge assumptions": { url: "https://christinecheong.com/agents-hub/ai-council-agent.html", label: "AI Advisory Council" },
  "Reframe the problem": { url: "https://christinecheong.com/agents-hub/problem-hunter-agent.html", label: "Problem Hunter Agent" },
  "Fill the evidence gap": { url: "https://christinecheong.com/agents-hub/deep-research-agent.html", label: "Deep Research Agent" },
  "Independent data check": { url: "https://christinecheong.com/agents-hub/data-insight-agent.html", label: "Data Insight Agent" },
};

function buildMovesReferenceBlock() {
  const lines = [];
  for (const [level, moves] of Object.entries(ALL_MOVES)) {
    lines.push(`${level} moves:`);
    for (const [move, url] of Object.entries(moves)) {
      lines.push(`- "${move}" → ${url} (link text must be exactly "${move}")`);
    }
  }
  lines.push('CHALLENGE live-tool links (every CHALLENGE move has one now):');
  for (const [move, l] of Object.entries(CHALLENGE_LIVE_TOOLS)) {
    lines.push(`- If you pick "${move}" → also link: ${l.url} (link text must be "${l.label}")`);
  }
  return lines.join("\n");
}

// Safety net for the same issue linkifyReport() fixes in cohort-report.js:
// the model doesn't reliably wrap the chosen move name in [text](url)
// markdown — it sometimes closes the bold before the URL and drops the
// brackets entirely, e.g. "**Challenge assumptions**(url)" instead of
// "**[Challenge assumptions](url)**". Since every label+URL pair is a fixed,
// known set, deterministically fix it rather than trust model compliance.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Actively parses out just the theme bullets rather than slicing between
// two heading strings — a missed exact-string match (e.g. the model titles
// the section slightly differently) previously let the entire rest of the
// synthesis, including the "Recommended move" section, leak into what gets
// shown to students. Stops as soon as anything other than a genuine bullet
// line is seen — a heading, an emoji-led recommendation line, or anything
// else — so unrecognized content is excluded by default, not included.
function extractThemesSummary(synthesis) {
  const lines = synthesis.split("\n");
  const themeLines = [];
  let inThemes = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#{2,3}\s*Emerging themes/i.test(line)) {
      inThemes = true;
      continue;
    }
    if (!inThemes) continue;
    if (!line) continue;
    const bulletMatch = line.match(/^([*-])\s+\*\*(.+?)\*\*/);
    if (!bulletMatch) break;
    const label = bulletMatch[2].replace(/:\s*$/, "");
    themeLines.push(`${bulletMatch[1]} **${label}**`);
  }
  return themeLines.length ? "### Emerging themes\n" + themeLines.join("\n") : "";
}

function linkifySynthesis(text) {
  const allLabels = { ...ALL_MOVES.CLARIFY, ...ALL_MOVES.APPLY, ...ALL_MOVES.CHALLENGE };
  for (const [label, url] of Object.entries(allLabels)) {
    const escapedLabel = escapeRegex(label);
    const escapedUrl = escapeRegex(url);
    // Already-correct link: leave untouched.
    if (new RegExp(`\\[[^\\]]*${escapedLabel}[^\\]]*\\]\\(${escapedUrl}\\)`).test(text)) continue;
    // Malformed: label directly followed by (optional close-bold) then the
    // bare "(url)" with no brackets — strip the stray "(url)" and wrap
    // label+url together instead.
    const malformed = new RegExp(`${escapedLabel}(\\*\\*)?\\(${escapedUrl}\\)`);
    if (malformed.test(text)) {
      text = text.replace(malformed, (_, boldClose) => `[${label}](${url})${boldClose || ""}`);
      continue;
    }
    // Label present as plain text with no link at all anywhere nearby.
    if (text.includes(label)) {
      text = text.replace(label, `[${label}](${url})`);
    }
  }
  for (const [label, l] of Object.entries(CHALLENGE_LIVE_TOOLS)) {
    const escapedLabel = escapeRegex(l.label);
    const escapedUrl = escapeRegex(l.url);
    if (new RegExp(`\\[[^\\]]*${escapedLabel}[^\\]]*\\]\\(${escapedUrl}\\)`).test(text)) continue;
    if (text.includes(l.label)) {
      text = text.replace(l.label, `[${l.label}](${l.url})`);
    }
  }
  return text;
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
    if (!["publish-question", "edit-question", "get-state", "submit-response", "synthesize"].includes(action)) {
      return new Response(JSON.stringify({ error: "invalid action" }), { status: 400, headers: CORS });
    }

    const accessToken = await getGoogleAccessToken(serviceAccountKey);
    const spreadsheetId = PART_SHEETS[part].id;

    if (action === "publish-question") {
      const question = typeof body.question === "string" ? body.question.trim() : "";
      if (!question) {
        return new Response(JSON.stringify({ error: "question is required" }), { status: 400, headers: CORS });
      }
      await appendRow(accessToken, spreadsheetId, "QUESTION", question);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });
    }

    // Fixes the current question's text in place (e.g. a typo) without
    // starting a new round — unlike publish-question, this keeps every
    // response already collected still counted, since the row's timestamp
    // (what responses are compared against) is untouched.
    if (action === "edit-question") {
      const question = typeof body.question === "string" ? body.question.trim() : "";
      if (!question) {
        return new Response(JSON.stringify({ error: "question is required" }), { status: 400, headers: CORS });
      }
      const rows = await readRows(accessToken, spreadsheetId);
      const rowNumber = findLastQuestionRowNumber(rows);
      if (!rowNumber) {
        return new Response(JSON.stringify({ error: "No question published yet for this part — use Publish instead." }), { status: 400, headers: CORS });
      }
      await updateRowText(accessToken, spreadsheetId, rowNumber, question);
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
      const { question, responses, themesText } = computeState(rows);
      return new Response(
        JSON.stringify({ question, responseCount: responses.length, themes: themesText }),
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

    const synthesis = linkifySynthesis(llmData.choices[0].message.content);

    // Persist a student-visible copy: just the bold "count — label" part of
    // each "Emerging themes" bullet, elaboration and the "Recommended move"
    // section both dropped — students see the summary, never the analysis
    // or the instructor-only facilitation guidance. Actively collects only
    // genuine bullet lines and stops at the first heading or emoji-led
    // recommendation line, rather than searching for one exact heading
    // string — the model doesn't always title that section identically, and
    // a missed match previously let the whole rest of the text (including
    // the recommendation) leak through uncut.
    const themesOnly = extractThemesSummary(synthesis);
    if (themesOnly) {
      await appendRow(accessToken, spreadsheetId, "THEMES", themesOnly);
    }

    return new Response(
      JSON.stringify({ question, responseCount: responses.length, synthesis }),
      { status: 200, headers: CORS }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
