const CORS = {
  "Access-Control-Allow-Origin": "https://christinecheong.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const SHEET_ID = "1eB2oPxMscUdh2uAN1ZKPYT-dI5k0_nJgdEWwneCIZZY";
const TAB_NAME = "Form Responses 1";

// where.*apply requires "where" before "apply" so it doesn't also match a
// Confidence question header that happens to contain the word "applying" —
// same fix already applied to cohort-stats.js's SURVEY_QUESTIONS[4].
const FIELD_DEFS = [
  { key: "timestamp", match: /^timestamp$/i },
  { key: "confidence", match: /confiden/i },
  { key: "whereApply", match: /where.*apply/i },
  { key: "remainingQuestions", match: /remaining question/i },
];

const DEFAULT_HEADERS = [
  "Timestamp",
  "Confidence — how confident are you now applying time series forecasting?",
  "Where will you apply time series forecasting?",
  "Remaining Questions — what's still unclear, or what would you like more practice on?",
];

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

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  try {
    const serviceAccountKey = context.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKey) {
      return new Response(JSON.stringify({ error: "Google service account key not configured" }), {
        status: 500,
        headers: CORS,
      });
    }

    const body = await context.request.json();
    const required = ["whereApply", "remainingQuestions"];
    for (const key of required) {
      if (!body[key] || String(body[key]).trim() === "") {
        return new Response(JSON.stringify({ error: `Missing required field: ${key}` }), {
          status: 400,
          headers: CORS,
        });
      }
    }
    const confidenceNum = Number(body.confidence);
    if (!Number.isInteger(confidenceNum) || confidenceNum < 1 || confidenceNum > 5) {
      return new Response(JSON.stringify({ error: "Confidence must be an integer 1-5" }), {
        status: 400,
        headers: CORS,
      });
    }

    const accessToken = await getGoogleAccessToken(serviceAccountKey);

    let headerRows = await readSheetValues(accessToken, SHEET_ID, `'${TAB_NAME}'!A1:Z1`);
    let headers = headerRows[0] || [];
    if (!headers.length) {
      headers = DEFAULT_HEADERS;
      await writeSheetValues(accessToken, SHEET_ID, `'${TAB_NAME}'!A1:${String.fromCharCode(64 + headers.length)}1`, [headers]);
    }

    const values = {
      timestamp: new Date().toISOString(),
      confidence: String(confidenceNum),
      whereApply: body.whereApply,
      remainingQuestions: body.remainingQuestions,
    };

    const row = headers.map((h) => {
      const def = FIELD_DEFS.find((f) => f.match.test(h || ""));
      return def ? values[def.key] || "" : "";
    });

    await appendSheetRow(accessToken, SHEET_ID, `'${TAB_NAME}'!A:Z`, row);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
