// ---- Spotify Authorization Code + PKCE flow (no client secret needed) ----

const AUTH_STORAGE_KEYS = {
  verifier: "sp_code_verifier",
  accessToken: "sp_access_token",
  refreshToken: "sp_refresh_token",
  expiresAt: "sp_expires_at"
};

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateRandomString(length) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => ("0" + b.toString(16)).slice(-2)).join("").slice(0, length);
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
}

// Kicks off login: builds a PKCE verifier/challenge pair and redirects to Spotify.
async function redirectToSpotifyLogin() {
  const verifier = generateRandomString(64);
  localStorage.setItem(AUTH_STORAGE_KEYS.verifier, verifier);
  const challenge = await generateCodeChallenge(verifier);

  const params = new URLSearchParams({
    client_id: CONFIG.CLIENT_ID,
    response_type: "code",
    redirect_uri: CONFIG.REDIRECT_URI,
    scope: CONFIG.SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

// Called from callback/index.html once Spotify redirects back with ?code=...
async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem(AUTH_STORAGE_KEYS.verifier);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: CONFIG.REDIRECT_URI,
    client_id: CONFIG.CLIENT_ID,
    code_verifier: verifier
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  storeTokens(data);
}

function storeTokens(data) {
  localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, data.access_token);
  if (data.refresh_token) {
    localStorage.setItem(AUTH_STORAGE_KEYS.refreshToken, data.refresh_token);
  }
  const expiresAt = Date.now() + data.expires_in * 1000;
  localStorage.setItem(AUTH_STORAGE_KEYS.expiresAt, String(expiresAt));
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken);
  if (!refreshToken) throw new Error("No refresh token available. Please log in again.");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CONFIG.CLIENT_ID
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!res.ok) throw new Error("Refresh failed. Please log in again.");

  const data = await res.json();
  storeTokens(data);
  return data.access_token;
}

// Returns a valid access token, refreshing it first if it's expired or about to be.
async function getValidAccessToken() {
  const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
  const expiresAt = Number(localStorage.getItem(AUTH_STORAGE_KEYS.expiresAt) || 0);

  if (!token) return null;
  if (Date.now() > expiresAt - 60000) {
    return await refreshAccessToken();
  }
  return token;
}

function isLoggedIn() {
  return Boolean(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken));
}

function logout() {
  Object.values(AUTH_STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
}
