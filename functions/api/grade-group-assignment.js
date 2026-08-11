const CORS = {
  "Access-Control-Allow-Origin": "https://christinecheong.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// The shared Google Slides deck linked from the Part 2 (ARIMAX) Workshop
// block's "Group collaborative space" card. Read-only — this endpoint never
// writes to it. The service account needs at least Viewer access to this
// specific file (e.g. via "Anyone with the link → Viewer" sharing, the same
// pattern already used for the self-provisioned sheets elsewhere in this
// project) before this endpoint can read it.
const GROUP_SLIDES_ID = "1LigXSWkT_R8C4egGYtyWnz96TTCXbyS6";

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
    scope: "https://www.googleapis.com/auth/drive.readonly",
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

// The linked file is a plain uploaded .pptx (not a native Google Slides
// file), so Drive's /export endpoint ("Export only supports Docs Editors
// files") doesn't work on it. Instead we download the raw bytes and read
// the .pptx ourselves — it's just a ZIP of XML. This also means the feature
// keeps working regardless of whether the file is ever converted to native
// Slides format.

// ==================== ZIP parsing (hand-rolled, no dependencies —
// duplicated from grade-submissions.js's unzip logic per this project's
// convention of self-contained function files. Kept in sync by hand if the
// zip-parsing logic there ever changes.) ====================

function findEOCD(bytes, view) {
  const sig = 0x06054b50;
  const minPos = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === sig) return i;
  }
  throw new Error("Not a valid ZIP file (end-of-central-directory record not found)");
}

async function inflateRaw(compressedBytes) {
  const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

const ZIP64_SENTINEL_32 = 0xffffffff;

function getUint64LE(view, offset) {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  return high * 0x100000000 + low;
}

function resolveZip64(view, extraStart, extraLen, needs) {
  let p = extraStart;
  const end = extraStart + extraLen;
  while (p + 4 <= end) {
    const tag = view.getUint16(p, true);
    const size = view.getUint16(p + 2, true);
    if (tag === 0x0001) {
      let q = p + 4;
      const out = {};
      if (needs.uncompSize) { out.uncompSize = getUint64LE(view, q); q += 8; }
      if (needs.compSize) { out.compSize = getUint64LE(view, q); q += 8; }
      if (needs.localOffset) { out.localOffset = getUint64LE(view, q); q += 8; }
      return out;
    }
    p += 4 + size;
  }
  return {};
}

// Returns [{ filename, bytes }] for every regular (non-directory) file entry.
async function parseZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEOCD(bytes, view);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdCount = view.getUint16(eocdOffset + 10, true);

  const entries = [];
  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) {
      throw new Error("Malformed ZIP central directory");
    }
    const compMethod = view.getUint16(pos + 10, true);
    let compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    let localOffset = view.getUint32(pos + 42, true);
    const nameBytes = bytes.subarray(pos + 46, pos + 46 + nameLen);
    const filename = new TextDecoder("utf-8").decode(nameBytes);

    if (compSize === ZIP64_SENTINEL_32 || localOffset === ZIP64_SENTINEL_32) {
      const resolved = resolveZip64(view, pos + 46 + nameLen, extraLen, {
        uncompSize: view.getUint32(pos + 24, true) === ZIP64_SENTINEL_32,
        compSize: compSize === ZIP64_SENTINEL_32,
        localOffset: localOffset === ZIP64_SENTINEL_32,
      });
      if (resolved.compSize != null) compSize = resolved.compSize;
      if (resolved.localOffset != null) localOffset = resolved.localOffset;
    }

    entries.push({ filename, compMethod, compSize, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  const files = [];
  for (const e of entries) {
    if (e.filename.endsWith("/")) continue;
    const lp = e.localOffset;
    if (view.getUint32(lp, true) !== 0x04034b50) {
      throw new Error(`Malformed ZIP local header for ${e.filename}`);
    }
    const lNameLen = view.getUint16(lp + 26, true);
    const lExtraLen = view.getUint16(lp + 28, true);
    const dataStart = lp + 30 + lNameLen + lExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + e.compSize);
    let data;
    if (e.compMethod === 0) {
      data = compressed;
    } else if (e.compMethod === 8) {
      data = await inflateRaw(compressed);
    } else {
      continue; // unsupported compression method (rare) — skip rather than fail
    }
    files.push({ filename: e.filename, bytes: data });
  }
  return files;
}

function xmlTextRuns(xml) {
  const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]);
  return runs.map((s) =>
    s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  );
}

// Downloads the raw .pptx and reads every slide's text runs in slide order —
// equivalent output to a native Slides plain-text export, but works on a
// plain uploaded .pptx too.
async function fetchSlidesText(accessToken, fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      data.error?.message ||
        `Failed to download the group deck (HTTP ${res.status}). Make sure it's shared with the service account (Anyone with the link → Viewer works).`
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const files = await parseZip(bytes);

  const slideFiles = files
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.filename))
    .map((f) => ({ ...f, num: parseInt(f.filename.match(/slide(\d+)\.xml/)[1], 10) }))
    .sort((a, b) => a.num - b.num);

  if (!slideFiles.length) {
    throw new Error("No slides found — the file may not be a .pptx or a native Google Slides file.");
  }

  const decoder = new TextDecoder("utf-8");
  let fullText = "";
  for (const f of slideFiles) {
    const xml = decoder.decode(f.bytes);
    fullText += xmlTextRuns(xml).join("\n") + "\n";
  }
  return fullText;
}

// Splits the exported deck text into one chunk per group. This deck's
// slides each carry a "STUDENT SUBMISSION N OF M" eyebrow (from the
// original slide template) followed by a "Group N" label — reused here as
// the group boundary marker since it's already a stable, reliable anchor
// in every slide's text.
function splitIntoGroups(text) {
  const marker = /STUDENT SUBMISSION \d+ OF \d+/g;
  const starts = [...text.matchAll(marker)].map((m) => m.index);
  if (!starts.length) return [{ label: "Whole deck", text: text.trim() }];

  const chunks = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : text.length;
    const chunk = text.slice(start, end).trim();
    const labelMatch = chunk.match(/Group\s+\d+/);
    chunks.push({ label: labelMatch ? labelMatch[0] : `Section ${i + 1}`, text: chunk });
  }
  return chunks;
}

// Same 3-level framework used throughout this project's cohort reports —
// applied here to the group's own shared work rather than quiz accuracy.
const RUBRIC = [
  {
    id: "understanding",
    name: "Understanding of Concepts",
    levels: {
      1: "Developing — Shows a real misconception, low accuracy, or leaves the concept unclear or incomplete",
      2: "Competent — Explains the concept correctly with no significant misconception",
      3: "Strong — Explains the concept correctly and proactively surfaces a subtlety or edge case most groups would miss",
    },
  },
  {
    id: "interpretation",
    name: "Interpretation & Application",
    levels: {
      1: "Developing — States the finding without connecting it to a real decision or context",
      2: "Competent — Connects the finding to a real decision or business context",
      3: "Strong — Connects the finding to a specific, well-reasoned decision or recommendation, not just a general context",
    },
  },
  {
    id: "judgment",
    name: "Critical Judgment",
    levels: {
      1: "Developing — Accepts the result at face value; no assumption, trade-off, or limitation is questioned",
      2: "Competent — Notes at least one real limitation, caveat, or open question on the finding",
      3: "Strong — Actively questions an assumption, weighs a trade-off, or proposes a concrete way to test the finding further",
    },
  },
];

function rubricText() {
  return RUBRIC.map(
    (r) => `${r.name}:\n  1 – ${r.levels[1]}\n  2 – ${r.levels[2]}\n  3 – ${r.levels[3]}`
  ).join("\n\n");
}

async function gradeGroups(groups, apiKey) {
  const groupsBlock = groups
    .map((g, i) => `### ${g.label || `Group ${i + 1}`} ###\n${g.text}`)
    .join("\n\n");

  const prompt = `You are grading a group's shared time series forecasting assignment (SARIMA/ARIMAX) against a 3-item rubric — one entry per group below. Be concrete and evidence-based, citing what each group actually wrote, never generic praise or criticism.

### RUBRIC ###
${rubricText()}

### GROUP SUBMISSIONS (from a shared slide deck) ###
${groupsBlock}

#################

Score each group on all 3 rubric dimensions 1-3 based only on the evidence above. Return ONLY JSON, no markdown, no commentary, as:
{"groups": [{"label": "Group 1", "scores": {"understanding": 1, "interpretation": 1, "judgment": 1}, "evidence": {"understanding": "one sentence citing what they actually wrote", "interpretation": "...", "judgment": "..."}}], "cohort_synthesis": "3-5 sentences: the pattern across all groups — where the cohort is strong, where it's weak, and one concrete next step for the instructor"}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You output only a single JSON object, nothing else — no markdown, no code fences." },
        { role: "user", content: prompt },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "OpenAI API error");
  const parsed = JSON.parse(data.choices[0].message.content);
  if (!parsed.groups) throw new Error("Malformed grading response");
  return parsed;
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

    const accessToken = await getGoogleAccessToken(serviceAccountKey);
    const deckText = await fetchSlidesText(accessToken, GROUP_SLIDES_ID);
    const groups = splitIntoGroups(deckText);
    const { groups: gradedGroups, cohort_synthesis } = await gradeGroups(groups, apiKey);

    return new Response(
      JSON.stringify({
        groupCount: groups.length,
        groups: gradedGroups,
        cohortSynthesis: cohort_synthesis,
      }),
      { status: 200, headers: CORS }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
