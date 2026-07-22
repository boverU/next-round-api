const express = require('express');
const { z } = require('zod');
const { verifyEventsToken, bearerFrom } = require('../lib/eventsToken');
const config = require('../config');

const router = express.Router();

// Languages the code editor exposes. Kept as an allowlist so a hostile frame
// can't ask Piston to run something unexpected. Version '*' = whatever Piston
// has installed (resolved from /runtimes at call time).
const LANGUAGES = new Set([
  'python', 'javascript', 'typescript', 'c', 'cpp', 'java',
  'go', 'rust', 'ruby', 'csharp', 'php', 'kotlin', 'bash',
]);

const runSchema = z.object({
  language: z.string().trim().min(1).max(30),
  // The single source file's content (v1 is single-file).
  code: z.string().max(100_000),
  stdin: z.string().max(10_000).optional(),
  // Optional explicit runtime version; otherwise the latest installed is used.
  version: z.string().trim().max(30).optional(),
});

/**
 * Authorize via the anti-cheat events token pinned to :id. Either role may run
 * code (candidate writes/runs; interviewer may run too). Returns the decoded
 * payload or null (never throws).
 */
function interviewTokenAuth(req) {
  const token = bearerFrom(req);
  if (!token) return null;
  try {
    const payload = verifyEventsToken(token);
    if (payload.interviewId !== req.params.id) return null;
    return payload;
  } catch (_err) {
    return null;
  }
}

// --- naive in-memory per-interview rate limiter (MVP; single process) --------
const runTimestamps = new Map(); // interviewId -> number[]

function rateLimited(interviewId) {
  const now = Date.now();
  const windowMs = config.CODE_EXEC_WINDOW_SECONDS * 1000;
  const hits = (runTimestamps.get(interviewId) || []).filter(t => now - t < windowMs);

  if (hits.length >= config.CODE_EXEC_MAX_RUNS) {
    runTimestamps.set(interviewId, hits);
    return true;
  }
  hits.push(now);
  runTimestamps.set(interviewId, hits);
  return false;
}

// --- Piston runtime version resolution (cached) ------------------------------
let runtimesCache = { at: 0, byLang: new Map() };

async function resolveVersion(language, requested) {
  if (requested) return requested;

  // Refresh at most once a minute.
  if (Date.now() - runtimesCache.at > 60_000) {
    const res = await fetch(`${config.PISTON_URL}/api/v2/runtimes`);
    if (!res.ok) throw new Error(`piston runtimes ${res.status}`);
    const runtimes = await res.json();
    const byLang = new Map();

    for (const rt of runtimes) {
      // A language can also be reached via aliases; index both.
      const keys = [ rt.language, ...(rt.aliases || []) ];
      for (const k of keys) {
        if (!byLang.has(k)) byLang.set(k, rt.version);
      }
    }
    runtimesCache = { at: Date.now(), byLang };
  }

  const version = runtimesCache.byLang.get(language);
  if (!version) throw new Error(`no installed runtime for "${language}"`);
  return version;
}

/**
 * POST /api/interviews/:id/execute
 * Run a code snippet in the interview's sandbox. Authorized by the events token
 * (candidate or staff). Proxies to Piston; Piston is never exposed directly.
 */
router.post('/:id/execute', async (req, res) => {
  const auth = interviewTokenAuth(req);
  if (!auth) return res.status(403).json({ error: 'Invalid or missing interview token' });

  const parsed = runSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid run request' });

  const { language, code, stdin, version: requestedVersion } = parsed.data;
  if (!LANGUAGES.has(language)) {
    return res.status(400).json({ error: `Unsupported language: ${language}` });
  }

  if (rateLimited(req.params.id)) {
    return res.status(429).json({ error: 'Too many runs, slow down' });
  }

  try {
    const version = await resolveVersion(language, requestedVersion);

    const pistonRes = await fetch(`${config.PISTON_URL}/api/v2/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language,
        version,
        files: [ { content: code } ],
        stdin: stdin ?? '',
        run_timeout: config.CODE_EXEC_RUN_TIMEOUT_MS,
        compile_timeout: config.CODE_EXEC_COMPILE_TIMEOUT_MS,
      }),
    });

    if (!pistonRes.ok) {
      const text = await pistonRes.text();
      return res.status(502).json({ error: `Execution engine error (${pistonRes.status})`, detail: text.slice(0, 500) });
    }

    const result = await pistonRes.json();

    // Normalize to the shape the editor renders. Piston returns { compile?, run }.
    return res.json({
      language,
      version,
      compile: result.compile
        ? { stdout: result.compile.stdout, stderr: result.compile.stderr, code: result.compile.code }
        : null,
      run: {
        stdout: result.run?.stdout ?? '',
        stderr: result.run?.stderr ?? '',
        code: result.run?.code ?? null,
        signal: result.run?.signal ?? null,
      },
    });
  } catch (err) {
    return res.status(502).json({ error: 'Execution failed', detail: String(err.message || err) });
  }
});

module.exports = router;
