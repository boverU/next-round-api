# NextRound API

Backs **US-1** — *"As a recruiter, I want to create an interview room for a role, so that I can invite a candidate to a live session."*

The Jitsi stack ships no database and its rooms are ephemeral (`storage = "memory"`), so everything about an interview — who, which role, which questions, who may enter — lives here.

- **Staff** (recruiters, interviewers) authenticate with **Clerk**. Postgres mirrors them.
- **Candidates** never touch Clerk. Their invite link *is* their credential (NFR-2: join in ≤2 clicks, no account).

## Run it

```bash
cp .env.example .env         # then fill in the Clerk keys and JWT_APP_SECRET
npm install
npm run db:up                # Postgres 16 on host port 5433
npm run migrate up
npm run seed                 # Acme Corp, Dana Morales, Senior Backend Engineer, Aida Karimova
npm start                    # http://localhost:4000
```

`DEV_AUTH_BYPASS=1` skips Clerk and acts as the seeded recruiter. The server **refuses to boot** if it is set while `NODE_ENV=production`.

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/interviews` | Clerk | Create a room; freezes the question plan onto it |
| `GET /api/interviews` | Clerk | Dashboard list |
| `POST /api/interviews/:id/join` | Clerk | Mint a moderator JWT for a panelist |
| `POST /api/interviews/:id/invite` | Clerk | Mint a candidate invite link (returned once) |
| `POST /api/interviews/:id/invite/:inviteId/revoke` | Clerk | Kill a link immediately |
| `GET /join/:token` | invite token | Candidate lobby: device check + consent |
| `POST /api/join/:token` | invite token | Record consent, mint a short-lived room JWT |
| `POST /api/jitsi/conference` | shared secret | Prosody reservations gate |
| `GET /health` | none | Uptime |

`/api` owns its own 404. This is deliberate: `nextround20/server.js:84` answers every unmatched path with `index.html` and a 200, which would turn a typo'd API route into a silent success.

## The fairness snapshot (NFR-9)

Every candidate for a role must get the same questions. If `interview` merely referenced `question_template`, editing that template tomorrow would rewrite what today's candidate was asked. So `createInterview` copies the plan in the same transaction that creates the interview:

- `interview.template_snapshot` (jsonb) — immutable audit record, never updated.
- `interview_question` / `interview_criterion` — copies that carry per-interview state (the "done" checkbox, the scores).

To prove it: create interview A, edit the role's `question_template`, create interview B. A's snapshot must be byte-identical; B's must reflect the edit.

## Two independent gates on a room

1. **The JWT.** `ENABLE_AUTH=1`, `AUTH_TYPE=jwt`, `ENABLE_GUESTS=0` in `docker-jitsi-meet/.env`. Nobody enters any room without a token we minted. The `room` claim pins each token to one conference; a 5-minute `exp` caps the damage of a leak. Candidates get `moderator: false` and no `features`, so they can never record.
2. **Reservations.** `PROSODY_RESERVATION_ENABLED=true` + `PROSODY_RESERVATION_REST_BASE_URL` point Prosody at `/api/jitsi`. Before a room may exist at all, Prosody asks us. A cancelled or unknown interview is refused even when the JWT is perfectly valid.

The JWT proves *who you are and which room*. Reservations prove *this room may exist right now*.

### Moderator must come from the token

Jicofo's `enable-auto-owner` makes the **first joiner** the room owner. A candidate who arrives before the interviewer would become moderator. So:

- `ENABLE_AUTO_OWNER=0`
- `XMPP_MUC_MODULES=token_affiliation`, with `mod_token_affiliation.lua` copied from
  `jitsi-meet/resources/prosody-plugins/` into `${CONFIG}/prosody/prosody-plugins-custom/`

That module reads `context.user.moderator` and sets the MUC affiliation to `owner` or `member`. Verified: candidate → `PARTICIPANT`, interviewer → `OWNER`.

## Local-development caveats

- **The iframe embed needs HTTPS.** `external_api.js` hardcodes `https://${domain}` (`jitsi-meet/modules/API/external/external_api.js:321`), so `public/join.html` cannot embed a plain-HTTP Jitsi. Locally we serve Jitsi on `http://localhost:8000` and drive it by URL; a real deployment terminates TLS and the embed works unchanged.
- **`BOSH_RELATIVE=1` and `ENABLE_XMPP_WEBSOCKET=0`** are local-only. `docker-jitsi-meet` builds the websocket URL as `wss://<PUBLIC_URL_DOMAIN>` and only strips an `https://` prefix, so an HTTP `PUBLIC_URL` yields the malformed `wss://http://localhost:8000/...`. Relative BOSH sidesteps it. In production set `PUBLIC_URL=https://...` and leave both alone.
- Postgres is on host port **5433** to avoid colliding with a local 5432.

## Not done yet

- `DELETE /api/jitsi/conference/:id` (room emptied → stamp `ended_at`) is implemented but was never observed firing; Prosody had not destroyed the idle room within 60s of the last participant leaving.
- `public/new-interview.html` requires a Clerk session. With Clerk enabled and no browser sign-in flow wired up, use `DEV_AUTH_BYPASS=1` to exercise it locally.
- Candidate picker is a `<select>` over seeded rows. Creating candidates inline is its own story.
