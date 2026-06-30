export async function onRequestGet(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // Return env key names (not values) so we can see what's available
  const envKeys = Object.keys(context.env || {});
  const hasOpenAI = !!context.env.OPENAI_API_KEY;
  const keyPreview = context.env.OPENAI_API_KEY
    ? context.env.OPENAI_API_KEY.slice(0, 8) + "..."
    : "NOT FOUND";

  return new Response(JSON.stringify({
    env_keys: envKeys,
    has_openai_key: hasOpenAI,
    key_preview: keyPreview,
  }, null, 2), { headers: corsHeaders });
}
