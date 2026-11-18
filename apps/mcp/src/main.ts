// The KIM connector over streamable HTTP. Supabase Auth is the OAuth
// authorization server: assistants find it through the protected resource
// metadata, and the user approves the connection on the consent page served
// here. Each request acts as the linked Account its access token names.
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import { authInfoFromClaims } from "./auth";
import { connectorCore } from "./connectorCore";
import { consentPage } from "./consentPage";
import { createKimMcpServer } from "./server";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
}

const supabaseUrl = required("SUPABASE_URL");
/** The project's publishable (anon) key: every query runs as the user. */
const supabaseKey = required("SUPABASE_ANON_KEY");
/** Where assistants reach this server, such as https://mcp.example.com. */
const publicUrl = new URL(required("KIM_MCP_URL"));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const mcpUrl = new URL("/mcp", publicUrl);
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = createMcpExpressApp({
  host,
  ...(host !== "127.0.0.1" && { allowedHosts: [publicUrl.host] }),
});

app.get(
  [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ],
  (_req, res) => {
    res.json({
      resource: mcpUrl.href,
      authorization_servers: [new URL("/auth/v1", supabaseUrl).href],
      bearer_methods_supported: ["header"],
      resource_name: "KIM",
    });
  },
);

app.get("/oauth/consent", (_req, res) => {
  res.type("html").send(consentPage({ supabaseUrl, supabaseKey }));
});

const authenticate = requireBearerAuth({
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
  verifier: {
    async verifyAccessToken(token) {
      const { data, error } = await supabase.auth.getClaims(token);
      if (error || !data) throw new InvalidTokenError("Invalid access token");
      return authInfoFromClaims(token, data.claims);
    },
  },
});

// Stateless: every request builds its own server for the caller.
app.post("/mcp", authenticate, async (req, res) => {
  const userId = req.auth?.extra?.userId;
  if (!req.auth || typeof userId !== "string") {
    throw new Error("Unauthenticated request");
  }
  const server = createKimMcpServer(
    connectorCore({
      supabaseUrl,
      supabaseKey,
      token: req.auth.token,
      userId,
    }),
  );
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.all("/mcp", (_req, res) => {
  res.status(405).set("Allow", "POST").end();
});

app.listen(port, host, () => {
  console.log(`KIM connector on ${mcpUrl.href}, listening on ${host}:${port}`);
});
