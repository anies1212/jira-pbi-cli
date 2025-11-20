export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

export interface AccessibleResource {
  id: string;
  name: string;
  url: string;
  scopes: string[];
}

const AUTH_BASE = "https://auth.atlassian.com";
const API_BASE = "https://api.atlassian.com";
const REDIRECT_URI = "http://127.0.0.1:8765/callback";
const CALLBACK_PATH = "/callback";
const TOKEN_REFRESH_BUFFER_MS = 60_000;

export const DEFAULT_SCOPES = [
  "read:me",
  "read:account",
  "read:issue:jira",
  "read:project:jira",
  "read:field:jira",
  "read:user:jira",
  "read:jira-work",
  "read:jira-user",
];

export function needsTokenRefresh(expiresAt: number): boolean {
  return Date.now() + TOKEN_REFRESH_BUFFER_MS >= expiresAt;
}

export async function authorizeInBrowser(
  clientId: string,
  scopes: string[],
): Promise<string> {
  const state = cryptoRandomString();
  const authUrl = new URL(`${AUTH_BASE}/authorize`);
  authUrl.searchParams.set("audience", "api.atlassian.com");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("scope", scopes.join(" "));
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  const codePromise = waitForAuthorizationCode(state);
  await openBrowser(authUrl.toString());
  const code = await codePromise;
  return code;
}

export async function exchangeCodeForTokens(params: {
  clientId: string;
  clientSecret: string;
  code: string;
}): Promise<OAuthTokenSet> {
  const payload = {
    grant_type: "authorization_code",
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: REDIRECT_URI,
  };
  return await requestToken(payload);
}

export async function refreshAccessToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<OAuthTokenSet> {
  const payload = {
    grant_type: "refresh_token",
    client_id: params.clientId,
    client_secret: params.clientSecret,
    refresh_token: params.refreshToken,
  };
  return await requestToken(payload);
}

export async function fetchAccessibleResources(
  accessToken: string,
): Promise<AccessibleResource[]> {
  const response = await fetch(
    `${API_BASE}/oauth/token/accessible-resources`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to fetch accessible resources (${response.status}): ${text}`,
    );
  }

  return await response.json() as AccessibleResource[];
}

async function requestToken(body: Record<string, string>): Promise<OAuthTokenSet> {
  const response = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth token request failed (${response.status}): ${text}`);
  }

  const payload = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  const expiresAt = Date.now() + Math.max(payload.expires_in - 60, 0) * 1000;

  if (!payload.refresh_token && body.grant_type === "refresh_token") {
    throw new Error("OAuth server did not return a refresh token");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? body.refresh_token ?? "",
    expiresAt,
    scope: payload.scope,
  };
}

async function waitForAuthorizationCode(expectedState: string): Promise<string> {
  const controller = new AbortController();
  let resolveCode: ((code: string) => void) | null = null;
  let rejectCode: ((error: Error) => void) | null = null;

  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 8765,
    signal: controller.signal,
    onListen: () => {
      console.log("Waiting for OAuth callback at http://127.0.0.1:8765/callback");
    },
  }, (req) => {
    const url = new URL(req.url);
    if (url.pathname !== CALLBACK_PATH) {
      return new Response("Not found", { status: 404 });
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code) {
      rejectCode?.(new Error("OAuth callback did not include a code."));
      controller.abort();
      return new Response("Missing code.", { status: 400 });
    }
    if (!state || state !== expectedState) {
      rejectCode?.(new Error("State mismatch in OAuth callback."));
      controller.abort();
      return new Response("State mismatch.", { status: 400 });
    }

    resolveCode?.(code);
    controller.abort();
    return new Response(
      "<html><body><h2>Authentication successful.</h2><p>You can close this tab and return to the CLI.</p></body></html>",
      {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      },
    );
  });

  try {
    const code = await codePromise;
    await server.finished.catch(() => {});
    return code;
  } finally {
    controller.abort();
  }
}

async function openBrowser(url: string): Promise<void> {
  const os = Deno.build.os;
  const commands: string[][] = [];

  if (os === "darwin") {
    commands.push(["open", url]);
  } else if (os === "windows") {
    commands.push(["powershell", "-Command", `Start-Process '${escapeForPowershell(url)}'`]);
  } else {
    commands.push(["xdg-open", url]);
  }

  for (const args of commands) {
    try {
      const command = new Deno.Command(args[0], {
        args: args.slice(1),
        stdout: "null",
        stderr: "null",
      });
      command.output().catch(() => {});
      console.log(`Opened browser for authentication: ${url}`);
      return;
    } catch (_error) {
      continue;
    }
  }

  console.log("Unable to open the browser automatically. Please open this URL manually:");
  console.log(url);
}

function escapeForPowershell(url: string): string {
  return url.replace(/'/g, "''");
}

function cryptoRandomString(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
