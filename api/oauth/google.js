// api/oauth/google.js
// Handle Google OAuth code exchange

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Authorization code required' });
  }

  try {
    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: code,
        client_id: '916330711384-a6uuvana6u051hvja5lk4h95gudspb4d.apps.googleusercontent.com',
        client_secret: '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',
        redirect_uri: 'https://inbox-ai-beige.vercel.app/dashboard.html',
        grant_type: 'authorization_code'
      })
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      return res.status(400).json({ error: tokens.error_description || tokens.error });
    }

    // Return access token to frontend
    return res.status(200).json({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in
    });

  } catch (error) {
    console.error('OAuth error:', error);
    return res.status(500).json({ error: error.message });
  }
}
