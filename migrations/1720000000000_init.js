/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS citext;

    CREATE TABLE organization (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      clerk_org_id text NOT NULL UNIQUE,
      name         text NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now()
    );

    -- "app_user", not "user": user is reserved in Postgres.
    CREATE TABLE app_user (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      clerk_user_id text NOT NULL UNIQUE,
      org_id        uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      email         citext NOT NULL,
      name          text NOT NULL,
      avatar_color  text,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      UNIQUE (org_id, email)
    );
    CREATE INDEX idx_app_user_org ON app_user(org_id);

    CREATE TABLE candidate (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id       uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      full_name    text NOT NULL,
      email        citext,
      headline     text,
      avatar_color text,
      created_at   timestamptz NOT NULL DEFAULT now(),
      deleted_at   timestamptz
    );
    CREATE INDEX idx_candidate_org ON candidate(org_id) WHERE deleted_at IS NULL;

    CREATE TABLE job_role (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      title       text NOT NULL,
      track       text,
      is_archived boolean NOT NULL DEFAULT false,
      created_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (org_id, title)
    );

    -- Mutable. Editing these must never rewrite an interview that already happened.
    CREATE TABLE question_template (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      job_role_id   uuid NOT NULL REFERENCES job_role(id) ON DELETE CASCADE,
      position      int  NOT NULL,
      prompt        text NOT NULL,
      question_type text NOT NULL
                    CHECK (question_type IN ('coding','system','ai','behavioral')),
      UNIQUE (job_role_id, position)
    );

    CREATE TABLE scoring_criterion (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      job_role_id uuid NOT NULL REFERENCES job_role(id) ON DELETE CASCADE,
      position    int  NOT NULL,
      name        text NOT NULL,
      max_score   int  NOT NULL DEFAULT 5 CHECK (max_score BETWEEN 1 AND 10),
      UNIQUE (job_role_id, position)
    );

    CREATE TABLE interview (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id       uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      job_role_id  uuid NOT NULL REFERENCES job_role(id),
      candidate_id uuid NOT NULL REFERENCES candidate(id),
      created_by   uuid NOT NULL REFERENCES app_user(id),

      -- citext mirrors Jitsi's lowercasing of room names, so two interviews can
      -- never collide into one Jitsi room.
      room_name    citext NOT NULL UNIQUE,

      status       text NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled','live','awaiting_decision','completed','cancelled')),
      scheduled_at timestamptz,
      started_at   timestamptz,
      ended_at     timestamptz,

      -- Frozen at creation, never updated. Proves NFR-9 fairness in an audit.
      template_snapshot jsonb NOT NULL,

      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      deleted_at   timestamptz
    );
    CREATE INDEX idx_interview_org_status ON interview(org_id, status) WHERE deleted_at IS NULL;
    CREATE INDEX idx_interview_scheduled  ON interview(org_id, scheduled_at) WHERE deleted_at IS NULL;
    CREATE INDEX idx_interview_candidate  ON interview(candidate_id);

    -- prompt/question_type are COPIED from question_template, never FK'd.
    CREATE TABLE interview_question (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id  uuid NOT NULL REFERENCES interview(id) ON DELETE CASCADE,
      position      int  NOT NULL,
      prompt        text NOT NULL,
      question_type text NOT NULL,
      is_done       boolean NOT NULL DEFAULT false,
      UNIQUE (interview_id, position)
    );

    CREATE TABLE interview_criterion (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id uuid NOT NULL REFERENCES interview(id) ON DELETE CASCADE,
      position     int  NOT NULL,
      name         text NOT NULL,
      max_score    int  NOT NULL DEFAULT 5,
      UNIQUE (interview_id, position)
    );

    CREATE TABLE interview_panelist (
      interview_id uuid NOT NULL REFERENCES interview(id) ON DELETE CASCADE,
      user_id      uuid NOT NULL REFERENCES app_user(id),
      panel_role   text NOT NULL DEFAULT 'interviewer'
                   CHECK (panel_role IN ('lead','interviewer','observer')),
      is_moderator boolean NOT NULL DEFAULT false,
      added_at     timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (interview_id, user_id)
    );
    CREATE INDEX idx_panelist_user ON interview_panelist(user_id);

    -- Only the sha256 of the invite secret is stored. token_lookup is a non-secret
    -- prefix so support can identify an invite without the secret reaching a log.
    CREATE TABLE invite_token (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      interview_id uuid NOT NULL REFERENCES interview(id) ON DELETE CASCADE,
      token_hash   bytea NOT NULL,
      token_lookup char(12) NOT NULL UNIQUE,
      expires_at   timestamptz NOT NULL,
      revoked_at   timestamptz,
      max_uses     int,
      use_count    int NOT NULL DEFAULT 0,
      last_used_at timestamptz,
      created_by   uuid NOT NULL REFERENCES app_user(id),
      created_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_invite_interview ON invite_token(interview_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS invite_token;
    DROP TABLE IF EXISTS interview_panelist;
    DROP TABLE IF EXISTS interview_criterion;
    DROP TABLE IF EXISTS interview_question;
    DROP TABLE IF EXISTS interview;
    DROP TABLE IF EXISTS scoring_criterion;
    DROP TABLE IF EXISTS question_template;
    DROP TABLE IF EXISTS job_role;
    DROP TABLE IF EXISTS candidate;
    DROP TABLE IF EXISTS app_user;
    DROP TABLE IF EXISTS organization;
  `);
};
