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
      -- Audit log of every claim attempt — success or failure.
      -- Lets ops easily see if coins were credited or if something went wrong.
      CREATE TABLE IF NOT EXISTS claim_notifications (
        id              SERIAL PRIMARY KEY,
        phone           VARCHAR(20)   NOT NULL,
        country_code    VARCHAR(10)   NOT NULL,
        tier_id         INTEGER       NOT NULL,
        cycle_number    INTEGER       NOT NULL,
        coins_awarded   INTEGER,
        status          VARCHAR(20)   NOT NULL DEFAULT 'pending',
        -- status values: 'pending' | 'success' | 'failed'
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
