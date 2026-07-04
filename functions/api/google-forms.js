const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { sheetId } = body;

    if (!sheetId) {
      return new Response(JSON.stringify({ error: "sheetId required" }), { status: 400, headers: CORS });
    }

    // Fetch the Google Sheet as CSV (works when sheet is "Anyone with link can view")
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&id=${sheetId}`;
    const res = await fetch(csvUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "follow",
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return new Response(JSON.stringify({
          error: "SHEET_NOT_PUBLIC",
          message: "The Google Sheet is not publicly accessible. In Google Sheets: click Share → change to 'Anyone with the link' → Viewer → Done. Then try again.",
        }), { status: 403, headers: CORS });
      }
      throw new Error(`Google returned ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    // If Google redirects to a login page instead of CSV, content-type will be text/html
    if (contentType.includes("text/html")) {
      return new Response(JSON.stringify({
        error: "SHEET_NOT_PUBLIC",
        message: "The Google Sheet is private. In Google Sheets: click Share → change to 'Anyone with the link' → Viewer → Done. Then try again.",
      }), { status: 403, headers: CORS });
    }

    const csv = await res.text();
    if (!csv || csv.trim().length < 10) {
      throw new Error("Sheet returned empty data. Make sure the sheet has at least one response row.");
    }

    // Count rows (minus header)
    const rows = csv.trim().split("\n");
    const responseCount = Math.max(0, rows.length - 1);

    return new Response(JSON.stringify({ csv, responseCount }), { status: 200, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
