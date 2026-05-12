const express = require("express");
const jwt     = require("jsonwebtoken");
const db      = require("../db/client");
const { sendOtp }  = require("../services/otp");
const { runQuery } = require("../services/redash");

const router = express.Router();
const OTP_TTL_MINUTES = 10;

/**
 * Check if the phone number exists as a registered Dostt user via Redash.
 * Expects REDASH_VERIFY_PHONE_QUERY_ID to be set to a query like:
 *   SELECT user_id, mobile_no FROM users WHERE mobile_no = '{{ phone }}'
 *
 * Returns the user row or null.
 */
async function lookupDosttUser(phone) {
  const queryId = Number(process.env.REDASH_VERIFY_PHONE_QUERY_ID);
  if (!queryId) return null; // skip check if not configured

  const rows = await runQuery(queryId, { phone }, 0); // max_age=0 → always fresh
  return rows.length ? rows[0] : null;
}

// POST /auth/send-otp
// body: { phone, countryCode }
router.post("/send-otp", async (req, res) => {
  try {
    const { phone, countryCode = "+91" } = req.body;

    if (!phone || !/^\d{7,15}$/.test(phone)) {
      return res.status(400).json({ error: "Invalid phone number" });
    }

    // Verify this phone is a registered Dostt user (via Redash)
    const dosttUser = await lookupDosttUser(phone);
    if (process.env.REDASH_VERIFY_PHONE_QUERY_ID && !dosttUser) {
      return res.status(403).json({ error: "Phone number not found in Dostt" });
    }

    const otp = await sendOtp(phone, countryCode);

    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    // Invalidate any previous unused OTPs for this number
    await db.query(
      `UPDATE otp_sessions SET used = TRUE
       WHERE phone = $1 AND country_code = $2 AND used = FALSE`,
      [phone, countryCode]
    );

    await db.insert("otp_sessions", {
      phone,
      country_code: countryCode,
      otp_code: otp,
      expires_at: expiresAt,
    });

    res.json({ success: true, message: "OTP sent" });
  } catch (err) {
    console.error("[auth] send-otp error:", err);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

// POST /auth/verify-otp
// body: { phone, countryCode, otp }
router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, countryCode = "+91", otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: "phone and otp are required" });
    }

    const session = await db.findOne("otp_sessions", {
      phone,
      country_code: countryCode,
      otp_code: otp,
      used: false,
    });

    if (!session) {
      return res.status(401).json({ error: "Invalid OTP" });
    }

    if (new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ error: "OTP expired" });
    }

    // Mark OTP as used
    await db.update("otp_sessions", { id: session.id }, { used: true });

    // Upsert user into local DB
    const user = await db.upsert(
      "users",
      { phone, country_code: countryCode },
      ["phone", "country_code"]
    );

    const token = jwt.sign(
      { userId: user.id, phone, countryCode },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "30d" }
    );

    res.json({ success: true, token, user: { id: user.id, phone, countryCode } });
  } catch (err) {
    console.error("[auth] verify-otp error:", err);
    res.status(500).json({ error: "Verification failed" });
  }
});

module.exports = router;
