export async function onRequestGet(context) {
  return new Response(
    JSON.stringify({ googleClientId: context.env.GOOGLE_CLIENT_ID || "" }),
    {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "https://christinecheong.com",
        "Content-Type": "application/json",
      },
    }
  );
}
