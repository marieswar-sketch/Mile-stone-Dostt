const express = require("express");
const db      = require("../db/client");
const { runQuery } = require("../services/redash");

const router = express.Router();

const TEST_PHONES = ["9500365660"];

async function lookupDosttUser(phone) {
  const queryId = Number(process.env.REDASH_VERIFY_PHONE_QUERY_ID);
  if (!queryId) return null;
  const rows = await runQuery(queryId, { phone }, 0);
  return rows.length ? rows[0] : null;
}

// POST /auth/login
// body: { phone, countryCode }
router.post("/login", async (req, res) => {
  try {
    const { phone, countryCode = "+91" } = req.body;

    if (!phone || !/^\d{7,15}$/.test(phone)) {
      return res.status(400).json({ error: "Invalid phone number" });
    }

    if (!TEST_PHONES.includes(phone)) {
      const dosttUser = await lookupDosttUser(phone);
      if (process.env.REDASH_VERIFY_PHONE_QUERY_ID && !dosttUser) {
        return res.status(403).json({ error: "Please use your Dostt registered number" });
      }
    }

    await db.upsert(
      "users",
      { phone, country_code: countryCode },
      ["phone", "country_code"]
    );

    res.json({ success: true, user: { phone, countryCode } });
  } catch (err) {
    console.error("[auth] login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

module.exports = router;
