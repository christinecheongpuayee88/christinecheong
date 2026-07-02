export async function onRequestPost(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "https://christinecheong.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  try {
    const body = await context.request.json();
    const { formId, accessToken } = body;

    if (!formId || !accessToken) {
      return new Response(JSON.stringify({ error: "formId and accessToken required" }), { status: 400, headers: corsHeaders });
    }

    // Fetch form structure and responses in parallel
    const [formRes, respRes] = await Promise.all([
      fetch(`https://forms.googleapis.com/v1/forms/${formId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      fetch(`https://forms.googleapis.com/v1/forms/${formId}/responses?pageSize=1000`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    ]);

    const formData = await formRes.json();
    if (!formRes.ok) throw new Error(formData.error?.message || "Could not access form. Make sure you are the form owner.");

    const respData = await respRes.json();
    if (!respRes.ok) throw new Error(respData.error?.message || "Could not fetch responses.");

    // Build question map: questionId -> title
    const questionOrder = [];
    for (const item of formData.items || []) {
      const q = item.questionItem?.question;
      if (q) {
        questionOrder.push({ id: q.questionId, title: item.title || "Question" });
      } else if (item.questionGroupItem) {
        for (const row of item.questionGroupItem.questions || []) {
          questionOrder.push({
            id: row.questionId,
            title: `${item.title} — ${row.rowQuestion?.title || ""}`,
          });
        }
      }
    }

    // Convert responses to CSV
    const headers = ["Timestamp", ...questionOrder.map((q) => q.title)];
    const rows = (respData.responses || []).map((resp) => {
      const row = [new Date(resp.createTime || "").toLocaleString("en-SG")];
      for (const q of questionOrder) {
        const ans = resp.answers?.[q.id];
        if (!ans) { row.push(""); continue; }
        const val =
          ans.textAnswers?.answers?.map((a) => a.value).join(", ") ||
          ans.fileUploadAnswers?.answers?.map((a) => a.fileName).join(", ") ||
          "";
        row.push(val);
      }
      return row;
    });

    const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");

    return new Response(
      JSON.stringify({
        csv,
        formTitle: formData.info?.title || "Survey",
        responseCount: (respData.responses || []).length,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "https://christinecheong.com",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
