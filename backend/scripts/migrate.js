/**
 * Run with:  npm run migrate
 *
 * Creates all tables if they don't exist yet.
 * Safe to re-run — uses IF NOT EXISTS throughout.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const db = require("../src/db/client");

const tables = [
  {
    name: "users",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id           SERIAL PRIMARY KEY,
        phone        VARCHAR(20)  NOT NULL,
        country_code VARCHAR(10)  NOT NULL DEFAULT '+91',
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE (phone, country_code)
      );
    `,
  },
  {
    name: "otp_sessions",
    sql: `
      CREATE TABLE IF NOT EXISTS otp_sessions (
        id           SERIAL PRIMARY KEY,
        phone        VARCHAR(20)  NOT NULL,
        country_code VARCHAR(10)  NOT NULL,
        otp_code     VARCHAR(6)   NOT NULL,
        expires_at   TIMESTAMPTZ  NOT NULL,
        used         BOOLEAN      NOT NULL DEFAULT FALSE,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_otp_phone
        ON otp_sessions (phone, country_code);
    `,
  },
  {
    name: "user_points",
    sql: `
      -- Synced from Google Sheet every 2 hours.
      -- Columns mirror the sheet exactly:
      --   user_id | mobile_no | wallet_balance | spent_on_audio |
      --   spent_on_video | total_spent | last_refreshed_at_ist | ltv
      CREATE TABLE IF NOT EXISTS user_points (
        id                   SERIAL PRIMARY KEY,
        user_id              VARCHAR(100),
        mobile_no            VARCHAR(20)   NOT NULL,
        wallet_balance       NUMERIC(14,2) NOT NULL DEFAULT 0,
        spent_on_audio       NUMERIC(14,2) NOT NULL DEFAULT 0,
        spent_on_video       NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_spent          NUMERIC(14,2) NOT NULL DEFAULT 0,
        last_refreshed_at_ist TIMESTAMPTZ,
        ltv                  NUMERIC(14,2) NOT NULL DEFAULT 0,
        synced_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        UNIQUE (mobile_no)
      );
    `,
  },
  {
    name: "claimed_rewards",
    sql: `
      CREATE TABLE IF NOT EXISTS claimed_rewards (
        id             SERIAL PRIMARY KEY,
        -- Who
        phone          VARCHAR(20)   NOT NULL,
        country_code   VARCHAR(10)   NOT NULL,
        dostt_user_id  VARCHAR(100),           -- from user_points, for cross-referencing
        -- What
        tier_id        INTEGER       NOT NULL,
        unlock_at      INTEGER       NOT NULL,  -- points threshold needed for this tier
        coins_awarded  INTEGER       NOT NULL,  -- free coins credited
        -- When / which cycle
        cycle_number   INTEGER       NOT NULL DEFAULT 1,
        claimed_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        UNIQUE (phone, country_code, tier_id, cycle_number)
      );
      CREATE INDEX IF NOT EXISTS idx_claimed_phone
        ON claimed_rewards (phone, country_code);
      CREATE INDEX IF NOT EXISTS idx_claimed_tier
        ON claimed_rewards (tier_id);
      CREATE INDEX IF NOT EXISTS idx_claimed_cycle
        ON claimed_rewards (cycle_number);
    `,
  },
  {
    name: "claimed_rewards backfill columns (safe)",
    sql: `
      ALTER TABLE claimed_rewards
        ADD COLUMN IF NOT EXISTS cycle_number  INTEGER      NOT NULL DEFAULT 1;
      ALTER TABLE claimed_rewards
        ADD COLUMN IF NOT EXISTS dostt_user_id VARCHAR(100);
      ALTER TABLE claimed_rewards
        ADD COLUMN IF NOT EXISTS unlock_at     INTEGER      NOT NULL DEFAULT 0;
      ALTER TABLE claimed_rewards
        ADD COLUMN IF NOT EXISTS coins_awarded INTEGER      NOT NULL DEFAULT 0;
    `,
  },
  {
    name: "ltv_eligibility",
    sql: `
      -- Tracks LTV gate status per user.
      -- Users are eligible only while ltv is between 500 and 1500.
      -- When ltv crosses 1500 the sheet sync marks them ineligible here.
      CREATE TABLE IF NOT EXISTS ltv_eligibility (
        id              SERIAL PRIMARY KEY,
        mobile_no       VARCHAR(20)   NOT NULL,
        ltv             NUMERIC(14,2) NOT NULL DEFAULT 0,
        is_eligible     BOOLEAN       NOT NULL DEFAULT TRUE,
        ineligible_at   TIMESTAMPTZ,
        updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        UNIQUE (mobile_no)
      );
      CREATE INDEX IF NOT EXISTS idx_ltv_mobile
        ON ltv_eligibility (mobile_no);
    `,
  },
  {
    name: "claim_notifications",
    sql: `
      CREATE TABLE IF NOT EXISTS claim_notifications (
        id              SERIAL PRIMARY KEY,
        phone           VARCHAR(20)   NOT NULL,
        country_code    VARCHAR(10)   NOT NULL,
        tier_id         INTEGER       NOT NULL,
        cycle_number    INTEGER       NOT NULL,
        coins_awarded   INTEGER,
        status          VARCHAR(20)   NOT NULL DEFAULT 'pending',
        failure_reason  TEXT,
        redash_response JSONB,
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_notif_phone
        ON claim_notifications (phone, country_code);
      CREATE INDEX IF NOT EXISTS idx_notif_status
        ON claim_notifications (status);
    `,
  },
  {
    name: "claim_notifications new columns (safe)",
    sql: `
      ALTER TABLE claim_notifications ADD COLUMN IF NOT EXISTS claim_mode    VARCHAR(20);
      ALTER TABLE claim_notifications ADD COLUMN IF NOT EXISTS claim_type    VARCHAR(20);
      ALTER TABLE claim_notifications ADD COLUMN IF NOT EXISTS dostt_user_id VARCHAR(100);
      ALTER TABLE claim_notifications ADD COLUMN IF NOT EXISTS tier_unlock_at INTEGER;
      ALTER TABLE claim_notifications ADD COLUMN IF NOT EXISTS tier_coins     INTEGER;
    `,
  },
  {
    name: "users cooldown column (safe)",
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS next_claim_at TIMESTAMPTZ;
    `,
  },
  {
    name: "login_logs",
    sql: `
      CREATE TABLE IF NOT EXISTS login_logs (
        id           SERIAL PRIMARY KEY,
        phone        VARCHAR(20)  NOT NULL,
        country_code VARCHAR(10)  NOT NULL DEFAULT '+91',
        user_type    VARCHAR(10)  NOT NULL DEFAULT 'real',
        status       VARCHAR(10)  NOT NULL,
        error_reason TEXT,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_login_logs_phone  ON login_logs (phone);
      CREATE INDEX IF NOT EXISTS idx_login_logs_status ON login_logs (status);
    `,
  },
  {
    name: "view: v_waiting_for_cooldown",
    sql: `
      CREATE OR REPLACE VIEW v_waiting_for_cooldown AS
      SELECT u.phone, u.country_code, u.next_claim_at,
             EXTRACT(EPOCH FROM (u.next_claim_at - NOW()))::INTEGER AS seconds_remaining
      FROM users u
      WHERE u.next_claim_at > NOW()
        AND EXISTS (SELECT 1 FROM user_points up WHERE up.mobile_no = u.phone);
    `,
  },
  {
    name: "view: v_eligible_not_claimed",
    sql: `
      CREATE OR REPLACE VIEW v_eligible_not_claimed AS
      SELECT DISTINCT u.phone, u.country_code, up.total_spent, up.last_refreshed_at_ist
      FROM users u
      JOIN user_points up ON up.mobile_no = u.phone
      CROSS JOIN (
        VALUES (1,200),(2,400),(3,700),(4,1000),(5,1400),(6,1900),(7,2500),
               (8,3200),(9,4000),(10,4900),(11,6100),(12,7600),(13,9600),
               (14,12100),(15,15350),(16,19350),(17,24350)
      ) AS tiers(tier_id, unlock_at)
      WHERE (u.next_claim_at IS NULL OR u.next_claim_at <= NOW())
        AND up.total_spent >= tiers.unlock_at
        AND NOT EXISTS (
          SELECT 1 FROM claimed_rewards cr
          WHERE cr.phone = u.phone AND cr.tier_id = tiers.tier_id
        );
    `,
  },
  {
    name: "view: v_login_logs",
    sql: `
      CREATE OR REPLACE VIEW v_login_logs AS
      SELECT phone, country_code, user_type, status, error_reason, created_at
      FROM login_logs
      ORDER BY created_at DESC;
    `,
  },
  {
    name: "view: v_claim_logs",
    sql: `
      CREATE OR REPLACE VIEW v_claim_logs AS
      SELECT phone, country_code, tier_id, tier_unlock_at, tier_coins,
             coins_awarded, claim_mode, claim_type, status, failure_reason,
             dostt_user_id, created_at
      FROM claim_notifications
      ORDER BY created_at DESC;
    `,
  },
  {
    name: "view: v_user_performance",
    sql: `
      CREATE OR REPLACE VIEW v_user_performance AS
      SELECT
        u.phone,
        u.country_code,
        u.next_claim_at,
        COUNT(DISTINCT ll.id)                                         AS login_attempts,
        COUNT(DISTINCT ll.id) FILTER (WHERE ll.status = 'success')    AS successful_logins,
        COUNT(DISTINCT ll.id) FILTER (WHERE ll.status = 'failed')     AS failed_logins,
        MAX(ll.created_at)    FILTER (WHERE ll.status = 'success')    AS last_login_at,
        COUNT(DISTINCT cn.id)                                         AS claim_attempts,
        COUNT(DISTINCT cn.id) FILTER (WHERE cn.status = 'success')    AS successful_claims,
        COUNT(DISTINCT cn.id) FILTER (WHERE cn.status = 'failed')     AS failed_claims,
        COALESCE(SUM(cn.coins_awarded) FILTER (WHERE cn.status = 'success'), 0) AS total_coins_claimed
      FROM users u
      LEFT JOIN login_logs ll ON ll.phone = u.phone
      LEFT JOIN claim_notifications cn ON cn.phone = u.phone
      GROUP BY u.phone, u.country_code, u.next_claim_at;
    `,
  },
];

async function migrate() {
  console.log("Running migrations…\n");
  for (const table of tables) {
    try {
      await db.query(table.sql);
      console.log(`  ✓  ${table.name}`);
    } catch (err) {
      console.error(`  ✗  ${table.name}: ${err.message}`);
      process.exit(1);
    }
  }
  console.log("\nAll tables ready.");
  process.exit(0);
}

migrate();
