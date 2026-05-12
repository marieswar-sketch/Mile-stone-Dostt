const express = require("express");
const db      = require("../db/client");
const { runQuery } = require("../services/redash");
const logger  = require("../utils/logger");

const router = express.Router();

const TEST_PHONES = ["9500365660"];

async function lookupDosttUser(phone) {
  const queryId = Number(process.env.REDASH_VERIFY_PHONE_QUERY_ID);
  if (!queryId) return null;
  const rows = await runQuery(queryId, { phone }, 0);
  return rows.length ? rows[0] : null;
}

async function recordLogin(phone, countryCode, userType, status, errorReason = null) {
  try {
    await db.insert("login_logs", {
      phone,
      country_code: countryCode,
      user_type: userType,
      status,
      error_reason: errorReason,
    });
  } catch (err) {
    logger.warn("Failed to write login log", { phone, err: err.message });
  }
}

// POST /auth/login
// body: { phone, countryCode }
router.post("/login", async (req, res) => {
  const { phone, countryCode = "+91" } = req.body;
  const isTester = TEST_PHONES.includes(phone);
  const userType = isTester ? "tester" : "real";

  try {
    if (!phone || !/^\d{7,15}$/.test(phone)) {
      await recordLogin(phone || "", countryCode, userType, "failed", "Invalid phone number");
      return res.status(400).json({ error: "Invalid phone number" });
    }

    if (!isTester) {
      const dosttUser = await lookupDosttUser(phone);
      if (process.env.REDASH_VERIFY_PHONE_QUERY_ID && !dosttUser) {
        await recordLogin(phone, countryCode, userType, "failed", "Not a registered Dostt user");
        return res.status(403).json({ error: "Please use your Dostt registered number" });
      }
    }

    await db.upsert(
      "users",
      { phone, country_code: countryCode },
      ["phone", "country_code"]
    );

    await recordLogin(phone, countryCode, userType, "success");

    logger.info("login success", { phone, userType });
    res.json({ success: true, user: { phone, countryCode }, isTester });
  } catch (err) {
    logger.error("login error", { phone, err: err.message });
    await recordLogin(phone || "", countryCode, userType, "failed", err.message);
    res.status(500).json({ error: "Login failed" });
  }
});

module.exports = router;
