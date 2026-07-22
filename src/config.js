require('dotenv').config();

const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  PUBLIC_BASE_URL: z.string().url(),

  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().optional(),

  // The public web origin candidates are sent to.
  JITSI_DOMAIN: z.string().min(1),
  // The XMPP domain Prosody serves (docker-jitsi-meet's XMPP_DOMAIN, default
  // meet.jitsi). This is what belongs in the token's `sub`, NOT the web domain.
  JITSI_XMPP_DOMAIN: z.string().min(1).default('meet.jitsi'),
  JWT_APP_ID: z.string().min(1),
  JWT_APP_SECRET: z.string().min(16),
  JWT_ACCEPTED_AUDIENCES: z.string().min(1),
  JITSI_JWT_TTL_SECONDS: z.coerce.number().default(300),

  INVITE_TTL_HOURS: z.coerce.number().default(24),

  // Browser origins allowed to call the API with a Clerk Bearer token.
  // Comma-separated. The custom jitsi-meet frontend is served from :8080 in dev.
  CORS_ORIGINS: z.string().default('http://localhost:8080,http://localhost:3000'),

  // Authenticates Prosody's reservations callbacks. Optional: when unset the
  // endpoint relies on network isolation alone.
  RESERVATION_SHARED_SECRET: z.string().optional(),

  // Piston code-execution engine (internal service). The API proxies runs to it
  // so candidate code never reaches the browser's origin directly and we can
  // authorize + rate-limit each run.
  PISTON_URL: z.string().url().default('http://piston:2000'),
  // Per-interview run rate limit (max runs within the window).
  CODE_EXEC_MAX_RUNS: z.coerce.number().default(20),
  CODE_EXEC_WINDOW_SECONDS: z.coerce.number().default(60),
  // Hard caps handed to Piston (ms / bytes) so a run can't hog the box.
  CODE_EXEC_RUN_TIMEOUT_MS: z.coerce.number().default(10000),
  CODE_EXEC_COMPILE_TIMEOUT_MS: z.coerce.number().default(10000),

  // Local-only escape hatch: skip Clerk and act as a seeded staff user.
  // Not z.coerce.boolean(): Boolean("0") is true, so DEV_AUTH_BYPASS=0 would
  // turn the bypass ON. Only an explicit "1" or "true" enables it.
  DEV_AUTH_BYPASS: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  DEV_CLERK_USER_ID: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const config = parsed.data;

// An auth bypass that reaches production is the worst possible bug in this file.
if (config.DEV_AUTH_BYPASS && config.NODE_ENV === 'production') {
  console.error('FATAL: DEV_AUTH_BYPASS must never be set in production.');
  process.exit(1);
}

if (!config.DEV_AUTH_BYPASS && !config.CLERK_SECRET_KEY) {
  console.error('FATAL: CLERK_SECRET_KEY is required unless DEV_AUTH_BYPASS=1.');
  process.exit(1);
}

// The first audience is the one we stamp into minted tokens.
config.jitsiAudience = config.JWT_ACCEPTED_AUDIENCES.split(',')[0].trim();

config.corsOrigins = config.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);

module.exports = config;
