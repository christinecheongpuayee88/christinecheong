const CORS = {
  "Access-Control-Allow-Origin": "https://christinecheong.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// ==================== ZIP parsing (hand-rolled, no dependencies — the
// same zero-dependency convention as the rest of functions/api/) ====================

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

// Reads a 64-bit little-endian size as a JS number. Zip entries here are all
// well under 4GB, so the high 32 bits are always 0 — this intentionally
// doesn't support truly huge (>2^53) entries, which will never occur for
// student notebook uploads.
function getUint64LE(view, offset) {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  return high * 0x100000000 + low;
}

// Tools like macOS's zip/Finder sometimes write ZIP64 extra fields even for
// small archives. When a header's size/offset field reads as the 0xFFFFFFFF
// sentinel, the real 64-bit value lives in a 0x0001 extra-field record
// instead — walk the extra field to find it, in the fixed order the spec
// defines (uncompressed size, compressed size, local header offset, disk
// number), including only whichever fields were actually sentineled.
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
      continue; // unsupported compression method (rare) — skip rather than fail the whole batch
    }
    files.push({ filename: e.filename, bytes: data });
  }
  return files;
}

// ==================== Notebook parsing ====================

// 45000 chars comfortably covers a full notebook end-to-end for typical
// workshop submissions (observed range ~9k-39k chars across a real batch of
// 19). This matters because naive front-truncation would disproportionately
// cut the END of the notebook — exactly where final model evaluation and
// business interpretation live, starving the rubric's "Interpretation" and
// "Decision Insight" dimensions of evidence.
const MAX_NOTEBOOK_CHARS = 45000;

// Pulls code, markdown, and text-based outputs (model summaries, printed
// metrics) out of a .ipynb — skips embedded plot images, which would need
// vision-based grading this MVP doesn't do.
function extractNotebookText(jsonText) {
  let nb;
  try {
    nb = JSON.parse(jsonText);
  } catch (err) {
    return null;
  }
  if (!nb || !Array.isArray(nb.cells)) return null;

  const parts = [];
  for (const cell of nb.cells) {
    const source = Array.isArray(cell.source) ? cell.source.join("") : cell.source || "";
    if (cell.cell_type === "markdown") {
      if (source.trim()) parts.push(`[Markdown]\n${source.trim()}`);
    } else if (cell.cell_type === "code") {
      if (source.trim()) parts.push(`[Code]\n${source.trim()}`);
      for (const out of cell.outputs || []) {
        if (out.output_type === "stream") {
          const text = Array.isArray(out.text) ? out.text.join("") : out.text || "";
          if (text.trim()) parts.push(`[Output]\n${text.trim().slice(0, 1500)}`);
        } else if ((out.output_type === "execute_result" || out.output_type === "display_data") && out.data && out.data["text/plain"]) {
          const raw = out.data["text/plain"];
          const text = Array.isArray(raw) ? raw.join("") : raw;
          if (text.trim()) parts.push(`[Output]\n${text.trim().slice(0, 1500)}`);
        } else if (out.output_type === "error") {
          parts.push(`[Error] ${out.ename || ""}: ${out.evalue || ""}`.slice(0, 300));
        }
      }
    }
  }
  const full = parts.join("\n\n");
  if (full.length <= MAX_NOTEBOOK_CHARS) return full;

  // Still over budget (an unusually long submission): keep the first 35% for
  // setup/method context and the last 65% for results/interpretation, rather
  // than losing the ending entirely — the rubric cares more about how it
  // concludes than about the full import/boilerplate at the top.
  const headBudget = Math.floor(MAX_NOTEBOOK_CHARS * 0.35);
  const tailBudget = MAX_NOTEBOOK_CHARS - headBudget;
  return `${full.slice(0, headBudget)}\n\n[... middle of submission truncated for length ...]\n\n${full.slice(-tailBudget)}`;
}

function studentKeyFromFilename(filename) {
  const base = filename.split("/").pop();
  return base.split("_")[0] || base;
}

// ==================== Rubric + grading ====================

const RUBRIC = [
  {
    id: "model_application",
    name: "Model Application",
    levels: {
      1: "Developing — Model/process is incomplete or inappropriate",
      2: "Competent — Appropriate time-series model is implemented reasonably",
      3: "Strong — Model is implemented correctly with appropriate choices and checks, and the student can justify why this model/approach fits the problem",
    },
  },
  {
    id: "interpretation",
    name: "Interpretation & Evaluation",
    levels: {
      1: "Developing — Results mainly reported with little interpretation",
      2: "Competent — Key results and model performance are interpreted",
      3: "Strong — Models/results are critically compared and limitations considered",
    },
  },
  {
    id: "decision_insight",
    name: "Decision Insight",
    levels: {
      1: "Developing — Limited connection to the business problem",
      2: "Competent — Findings translated into a reasonable conclusion",
      3: "Strong — Findings translated into clear, evidence-based business implications",
    },
  },
];

function rubricText() {
  return RUBRIC.map(
    (r) => `${r.name}:\n  1 – ${r.levels[1]}\n  2 – ${r.levels[2]}\n  3 – ${r.levels[3]}`
  ).join("\n\n");
}

async function gradeSubmission(notebook, apiKey) {
  const prompt = `You are grading a student's time series forecasting workshop submission (SARIMA/ARIMAX) against a 3-item rubric. Be concrete and evidence-based — cite what the student actually did or said in the submission below, never generic praise or generic criticism.

### RUBRIC ###
${rubricText()}

### SUBMISSION (extracted code, markdown commentary, and printed outputs — plots omitted) ###
${notebook.text}

#################

Score each of the 3 rubric dimensions 1-3 based only on the evidence above. Return ONLY JSON, no markdown, no commentary, as:
{"scores": {"model_application": 1, "interpretation": 1, "decision_insight": 1}, "evidence": {"model_application": "one sentence citing what they actually did", "interpretation": "...", "decision_insight": "..."}, "overall_feedback": "1-2 sentences of feedback for the student"}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 600,
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
    if (!parsed.scores) throw new Error("Malformed grading response");
    return {
      studentKey: notebook.studentKey,
      filename: notebook.filename,
      scores: parsed.scores,
      evidence: parsed.evidence || {},
      overallFeedback: parsed.overall_feedback || "",
    };
  } catch (err) {
    return { studentKey: notebook.studentKey, filename: notebook.filename, scores: null, error: err.message };
  }
}

async function gradeAllSubmissions(notebooks, apiKey, concurrency = 5) {
  const results = [];
  for (let i = 0; i < notebooks.length; i += concurrency) {
    const batch = notebooks.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((nb) => gradeSubmission(nb, apiKey)));
    results.push(...batchResults);
  }
  return results;
}

async function synthesizeCohort(gradedResults, apiKey) {
  if (!gradedResults.length) return null;

  const summary = gradedResults
    .map(
      (r) =>
        `${r.studentKey}: Model Application=${r.scores.model_application}, Interpretation & Evaluation=${r.scores.interpretation}, Decision Insight=${r.scores.decision_insight}`
    )
    .join("\n");

  const prompt = `You are synthesizing cohort-level rubric evidence from ${gradedResults.length} graded time series forecasting (SARIMA/ARIMAX) workshop submissions into recommendations for the instructor — both for this current cohort and for how future cohorts should be taught.

### PER-STUDENT SCORES (1 = Developing, 2 = Competent, 3 = Strong) ###
${summary}

#################

For each of the 3 rubric dimensions, identify the dominant level across the cohort and write one cohort-finding sentence citing the actual count/percentage, then write one concrete next step. The dominant level is already stated in the Rubric evidence column — never repeat it as a tag or label in the Recommendations column, just state the action directly.

Output in exactly this Markdown table format:

| Rubric evidence | Cohort finding | Recommendations |
|---|---|---|
| Model Application: [dominant level name] | [one sentence citing the count/percentage] | [one concrete next step] |
| Interpretation & Evaluation: [dominant level name] | [...] | [...] |
| Decision Insight: [dominant level name] | [...] | [...] |

Then one closing line starting with "**Teaching implication:**" that covers both horizons — what to do with this current cohort now (e.g. targeted feedback, a follow-up exercise, office-hours focus) and what to change in how the material is taught to future cohorts.

Output plain text only, no code fence — start directly with the table.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "OpenAI API error");
    return data.choices[0].message.content;
  } catch (err) {
    return `[Cohort synthesis unavailable: ${err.message}]`;
  }
}

// ==================== Request handling ====================

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  try {
    const apiKey = context.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), { status: 500, headers: CORS });
    }

    const formData = await context.request.formData();
    const file = formData.get("submissions");
    if (!file || typeof file === "string") {
      return new Response(JSON.stringify({ error: "No zip file uploaded (expected form field 'submissions')" }), {
        status: 400,
        headers: CORS,
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    let allFiles;
    try {
      allFiles = await parseZip(bytes);
    } catch (err) {
      return new Response(JSON.stringify({ error: `Could not read zip file: ${err.message}` }), {
        status: 400,
        headers: CORS,
      });
    }

    const notebookFiles = allFiles.filter((f) => /\.(ipynb|ipy)$/i.test(f.filename));
    const unsupportedFiles = allFiles.filter((f) => !/\.(ipynb|ipy)$/i.test(f.filename)).map((f) => f.filename);

    const notebooks = notebookFiles
      .map((f) => ({
        filename: f.filename,
        studentKey: studentKeyFromFilename(f.filename),
        text: extractNotebookText(new TextDecoder("utf-8").decode(f.bytes)),
      }))
      .filter((nb) => nb.text && nb.text.trim());

    const unparsable = notebookFiles
      .filter((f) => !notebooks.some((nb) => nb.filename === f.filename))
      .map((f) => f.filename);

    if (!notebooks.length) {
      return new Response(
        JSON.stringify({ error: "No parsable .ipynb files found in the zip", unsupportedFiles, unparsable }),
        { status: 400, headers: CORS }
      );
    }

    const perStudent = await gradeAllSubmissions(notebooks, apiKey);
    const graded = perStudent.filter((r) => r.scores);
    const cohortSynthesis = await synthesizeCohort(graded, apiKey);

    return new Response(
      JSON.stringify({
        success: true,
        totalFilesInZip: allFiles.length,
        gradedCount: graded.length,
        failedCount: perStudent.length - graded.length,
        unsupportedFiles,
        unparsable,
        perStudent,
        cohortSynthesis,
      }),
      { status: 200, headers: CORS }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
