const CORS = {
  "Access-Control-Allow-Origin": "https://christinecheong.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// Currently pointed at the instructor's sample-answers deck (illustrative,
// fully filled-in responses for all 5 groups) rather than the blank student
// template, so this endpoint has something real to grade before students
// have actually submitted. Swap back to the blank Group Collaborative Space
// deck (1yz6kVLdIjgeybPX_llnKy2Q4Kd78lOkE) once real submissions exist.
// Read-only — this endpoint never writes to it. The service account needs
// at least Viewer access to whichever file is set here (e.g. via "Anyone
// with the link → Viewer" sharing, the same pattern already used for the
// self-provisioned sheets elsewhere in this project) before this endpoint
// can read it.
const GROUP_SLIDES_ID = "1fXKa02k4JAPy8bymaCEQ4hkU1KqbhdVG";

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
// duplicated from grade-group-assignment.js per this project's convention
// of self-contained function files. Kept in sync by hand if the zip-parsing
// logic there ever changes.) ====================

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

// Splits the exported deck text into one chunk per group. Every variant of
// this deck (blank Group Collaborative Space template, filled-in sample
// answers, take-home Workshop Assignment copy) carries two slides per
// group, each with a "GROUP N <VARIANT LABEL>" eyebrow — merge consecutive
// slide-chunks that share the same group number into a single per-group
// chunk, since the rubric needs the full Problem Framing/Information
// Partner (page 1) + Thinking/Decision-Support Partner (page 2) context
// together.
function splitIntoGroups(text) {
  const marker = /GROUP (\d+) (?:COLLABORATIVE SPACE|SAMPLE RESPONSE|WORKSHOP ASSIGNMENT)/g;
  const matches = [...text.matchAll(marker)];
  if (!matches.length) return [{ label: "Whole deck", text: text.trim() }];

  const raw = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    raw.push({ num: matches[i][1], text: text.slice(start, end).trim() });
  }

  const merged = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && last.num === r.num) {
      last.text += "\n" + r.text;
    } else {
      merged.push({ num: r.num, text: r.text });
    }
  }
  return merged.map((m) => ({ label: `Group ${m.num}`, text: m.text }));
}

// This case's own 4-stage workflow — Problem Framing, Information Partner,
// Thinking Partner, Decision-Support Partner — rather than the generic
// 3-item framework used for the time-series workshops. Same 3-level format
// (1 Developing / 2 Competent / 3 Strong) for consistency with the rest of
// this project's cohort reports.
const RUBRIC = [
  {
    id: "problemFraming",
    name: "Problem Framing",
    levels: {
      1: "Developing — States a vague restatement of the case without a clear Problem, Decision, or Gaps, or conflates the finding with the decision",
      2: "Competent — Clearly states the Problem, the Decision the analysis should support, and at least one genuine Gap",
      3: "Strong — All three are clear and specific enough to rule out a different valid framing — the Decision names a concrete choice, not just \"investigate further\"",
    },
  },
  {
    id: "informationPartner",
    name: "Information Partner",
    levels: {
      1: "Developing — Evidence is asserted without supporting numbers, or numbers are copied without synthesis (a data dump, not a summary)",
      2: "Competent — Evidence is organised into clear findings with relevant numbers/percentages, staying descriptive — no causes or hypotheses smuggled in",
      3: "Strong — Findings are organised and the group explicitly separates what the data shows from what it might mean — evidence stays evidence",
    },
  },
  {
    id: "thinkingPartner",
    name: "Thinking Partner",
    levels: {
      1: "Developing — Only one explanation is offered, or the AI-broadened alternative is never engaged with",
      2: "Competent — At least two plausible explanations are considered, with a stated reason why one is better supported by the evidence",
      3: "Strong — The chosen explanation explicitly survives a real challenge — an alternative or assumption was tested, and the group can say why it was weakened",
    },
  },
  {
    id: "decisionSupportPartner",
    name: "Decision-Support Partner",
    levels: {
      1: "Developing — A recommendation is given with no confidence level, or perspectives are listed without connecting them to it",
      2: "Competent — At least one stakeholder perspective stress-tests the finding, and a recommendation with a stated confidence level is given",
      3: "Strong — Multiple perspectives are weighed against each other, a genuine blind spot or trade-off is surfaced, and confidence is justified by naming what evidence would change it",
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

  const prompt = `You are grading a group's shared retail banking case assignment (Decision Intelligence with AI) against a 4-item rubric — one entry per group below. The case: a Singapore retail bank saw an 8% YoY decline in mobile-app transactions; groups worked through Problem Framing, Information Partner, Thinking Partner and Decision-Support Partner stages. Be concrete and evidence-based, citing what each group actually wrote, never generic praise or criticism.

### RUBRIC ###
${rubricText()}

### GROUP SUBMISSIONS (from a shared slide deck) ###
${groupsBlock}

#################

Score each group on all 4 rubric dimensions 1-3 based only on the evidence above. Return ONLY JSON, no markdown, no commentary, as:
{"groups": [{"label": "Group 1", "scores": {"problemFraming": 1, "informationPartner": 1, "thinkingPartner": 1, "decisionSupportPartner": 1}, "evidence": {"problemFraming": "one sentence citing what they actually wrote", "informationPartner": "...", "thinkingPartner": "...", "decisionSupportPartner": "..."}}], "cohort_synthesis": "3-5 sentences: the pattern across all groups — where the cohort is strong, where it's weak, and one concrete next step for the instructor"}`;

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

// Accepts a pasted Drive/Slides URL in any of its common shapes
// (docs.google.com/presentation/d/ID/edit, drive.google.com/file/d/ID/view,
// or a bare ID typed directly) and pulls out just the file ID.
function extractFileId(input) {
  const trimmed = String(input).trim();
  const match = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
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

    // Falls back to the built-in default (currently the sample-answers deck)
    // when no link is provided, so existing callers keep working unchanged.
    const body = await context.request.json().catch(() => ({}));
    let slidesId = GROUP_SLIDES_ID;
    if (body.driveUrl) {
      const parsed = extractFileId(body.driveUrl);
      if (!parsed) {
        return new Response(
          JSON.stringify({ error: "Couldn't find a file ID in that link — paste the full Google Slides URL or just the file ID." }),
          { status: 400, headers: CORS }
        );
      }
      slidesId = parsed;
    }

    const accessToken = await getGoogleAccessToken(serviceAccountKey);
    const deckText = await fetchSlidesText(accessToken, slidesId);
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
