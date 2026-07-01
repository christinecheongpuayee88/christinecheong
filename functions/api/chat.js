export async function onRequestPost(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "https://christinecheong.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  try {
    const apiKey = context.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API key not configured" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const body = await context.request.json();
    const { system, message, model, max_tokens, urls } = body;

    if (!message) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Fetch URL contents server-side (no CORS issues here)
    let urlContext = "";
    if (urls && urls.length > 0) {
      const fetched = await Promise.all(
        urls.map(async (url) => {
          try {
            const res = await fetch(url, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; ResearchAgent/1.0)" },
              signal: AbortSignal.timeout(8000),
            });
            const html = await res.text();
            // Strip HTML tags to get readable text
            const text = html
              .replace(/<script[\s\S]*?<\/script>/gi, "")
              .replace(/<style[\s\S]*?<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s{2,}/g, " ")
              .trim()
              .slice(0, 6000);
            return `--- URL: ${url} ---\n${text}\n--- END: ${url} ---`;
          } catch (e) {
            return `--- URL: ${url} ---\n[Could not fetch: ${e.message}]\n--- END: ${url} ---`;
          }
        })
      );
      urlContext = "\n\nWEB REFERENCES (fetched server-side — treat as primary source material, cite by URL):\n\n" + fetched.join("\n\n");
    }

    // Support array content (multipart: text + images) or plain string
    let userContent;
    if (Array.isArray(message)) {
      if (urlContext) {
        userContent = message.map(part =>
          part.type === 'text' ? { ...part, text: part.text + urlContext } : part
        );
      } else {
        userContent = message;
      }
    } else {
      userContent = message + urlContext;
    }

    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: userContent });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || "gpt-4o",
        max_tokens: max_tokens || 4096,
        messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: data.error?.message || "OpenAI API error" }),
        { status: response.status, headers: corsHeaders }
      );
    }

    // Normalise to Anthropic-style response so all agent pages work unchanged
    const normalised = {
      content: [{ type: "text", text: data.choices[0].message.content }],
    };

    return new Response(JSON.stringify(normalised), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
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
