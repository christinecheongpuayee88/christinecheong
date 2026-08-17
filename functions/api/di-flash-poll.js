const CORS = {
  "Access-Control-Allow-Origin": "https://christinecheong.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// Single backing Google Sheet for the Day 2 Module 3 checkpoint flash poll —
// same self-provisioning constraint as live-pulse.js (service accounts
// outside a Workspace/Shared Drive can't create their own Drive files), so
// this sheet is created once by the instructor and shared with the same
// service account used everywhere else in this system. Flat append-only
// log of VOTE rows: [timestamp, questionIndex, choice]. Reset between class
// runs is just clearing the data rows in the Sheet UI — no reset action
// exposed here, since an unauthenticated reset endpoint would let anyone
// wipe live results mid-class.
const POLL_SHEET_ID = "1sgCwmQDt3pQ1ObWqCaN5d7ByuIR2Be29uzh5wLagnYA";
const DATA_RANGE = "Sheet1!A:C";
const NUM_QUESTIONS = 5;
const CHOICES = ["A", "B", "C", "D"];

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

async function readRows(accessToken) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${POLL_SHEET_ID}/values/${encodeURIComponent(DATA_RANGE)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to read sheet");
  return data.values || [];
}

async function appendRows(accessToken, rows) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${POLL_SHEET_ID}/values/${encodeURIComponent(
    DATA_RANGE
  )}:append?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to append rows");
}

function tallyResults(rows) {
  const byQuestion = {};
  for (let q = 1; q <= NUM_QUESTIONS; q++) {
    byQuestion[q] = { A: 0, B: 0, C: 0, D: 0 };
  }
  let totalVotes = 0;
  const seenSubmissions = new Set();
  for (const row of rows) {
    const timestamp = row[0];
    const q = Number(row[1]);
    const choice = row[2];
    if (!q || q < 1 || q > NUM_QUESTIONS || !CHOICES.includes(choice)) continue;
    byQuestion[q][choice] += 1;
    // A "submission" is one timestamp — all 5 answers from one student are
    // appended together in a single batch, so counting distinct timestamps
    // approximates distinct respondents for the headline count.
    seenSubmissions.add(timestamp);
  }
  totalVotes = seenSubmissions.size;
  return { totalVotes, byQuestion };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  try {
    const serviceAccountKey = context.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKey) {
      return new Response(JSON.stringify({ error: "Google service account key not configured" }), { status: 500, headers: CORS });
    }

    const body = await context.request.json();
    const action = body.action;
    if (!["submit-vote", "get-results"].includes(action)) {
      return new Response(JSON.stringify({ error: "invalid action" }), { status: 400, headers: CORS });
    }

    const accessToken = await getGoogleAccessToken(serviceAccountKey);

    if (action === "submit-vote") {
      const answers = body.answers;
      if (!answers || typeof answers !== "object") {
        return new Response(JSON.stringify({ error: "answers object is required" }), { status: 400, headers: CORS });
      }
      const timestamp = new Date().toISOString();
      const rows = [];
      for (let q = 1; q <= NUM_QUESTIONS; q++) {
        const choice = answers[q];
        if (!CHOICES.includes(choice)) {
          return new Response(JSON.stringify({ error: `Missing or invalid answer for question ${q}` }), { status: 400, headers: CORS });
        }
        rows.push([timestamp, q, choice]);
      }
      await appendRows(accessToken, rows);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });
    }

    // action === "get-results"
    const rows = await readRows(accessToken);
    const { totalVotes, byQuestion } = tallyResults(rows);
    return new Response(JSON.stringify({ totalVotes, byQuestion }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
