const express = require("express");
const db = require("../db/client");
const { requireAuth } = require("../middleware/auth");
const { runQuery }    = require("../services/redash");
const { getCycleInfo } = require("../services/cycle");

const router = express.Router();

const TIER_DATA = [
  { id: 1,  unlockAt: 200,   coins: 20 },
  { id: 2,  unlockAt: 400,   coins: 20 },
  { id: 3,  unlockAt: 700,   coins: 20 },
  { id: 4,  unlockAt: 1000,  coins: 30 },
  { id: 5,  unlockAt: 1400,  coins: 30 },
  { id: 6,  unlockAt: 1900,  coins: 30 },
  { id: 7,  unlockAt: 2500,  coins: 40 },
  { id: 8,  unlockAt: 3200,  coins: 40 },
  { id: 9,  unlockAt: 4000,  coins: 50 },
  { id: 10, unlockAt: 4900,  coins: 50 },
  { id: 11, unlockAt: 6100,  coins: 60 },
  { id: 12, unlockAt: 7600,  coins: 60 },
  { id: 13, unlockAt: 9600,  coins: 70 },
  { id: 14, unlockAt: 12100, coins: 70 },
  { id: 15, unlockAt: 15350, coins: 80 },
  { id: 16, unlockAt: 19350, coins: 80 },
  { id: 17, unlockAt: 24350, coins: 90 },
];

/**
 * Credit coins to the user's Dostt wallet via Redash.
 * Expects REDASH_ADD_COINS_QUERY_ID — a parameterised Redash query, e.g.:
 *   INSERT INTO wallet_transactions (user_id, coins, reason)
 *   VALUES ('{{ dostt_user_id }}', {{ coins }}, 'free_reward_tier_{{ tier_id }}')
 */
async function creditCoinsViaRedash(dosttUserId, tierId, coins) {
  const queryId = Number(process.env.REDASH_ADD_COINS_QUERY_ID);
  if (!queryId) {
    console.warn("[rewards] REDASH_ADD_COINS_QUERY_ID not set — skipping coin credit");
    return null;
  }
  return runQuery(
    queryId,
    { dostt_user_id: dosttUserId, tier_id: tierId, coins },
    0  // always execute fresh — never use cache for write queries
  );
}

// GET /rewards/me
// Returns user's full point breakdown and claimed tier IDs for the current cycle.
router.get("/me", requireAuth, async (req, res) => {
  try {
    const { phone, countryCode } = req.user;
    const { cycleNumber, cycleStartDate, cycleEndDate } = getCycleInfo();

    const points = await db.findOne("user_points", { mobile_no: phone });

    // Only return claims from the current cycle
    const claimedRows = await db.query(
      `SELECT tier_id FROM claimed_rewards
       WHERE phone = $1 AND country_code = $2 AND cycle_number = $3`,
      [phone, countryCode, cycleNumber]
    );

    res.json({
      totalSpent:      points ? Number(points.total_spent)   : 0,
      walletBalance:   points ? Number(points.wallet_balance) : 0,
      spentOnAudio:    points ? Number(points.spent_on_audio) : 0,
      spentOnVideo:    points ? Number(points.spent_on_video) : 0,
      ltv:             points ? Number(points.ltv)            : 0,
      lastRefreshedAt: points ? points.last_refreshed_at_ist  : null,
      claimedTiers:    claimedRows.map(r => r.tier_id),
      cycle: {
        number:    cycleNumber,
        startDate: cycleStartDate,
        endDate:   cycleEndDate,
      },
    });
  } catch (err) {
    console.error("[rewards] /me error:", err);
    res.status(500).json({ error: "Failed to fetch rewards" });
  }
});

// POST /rewards/claim
// body: { tierId }
router.post("/claim", requireAuth, async (req, res) => {
  try {
    const { phone, countryCode, userId } = req.user;
    const tierId = Number(req.body.tierId);

    const tier = TIER_DATA.find(t => t.id === tierId);
    if (!tier) {
      return res.status(400).json({ error: "Invalid tierId" });
    }

    const { cycleNumber } = getCycleInfo();

    // Guard: already claimed this cycle?
    const existing = await db.findOne("claimed_rewards", {
      phone,
      country_code: countryCode,
      tier_id: tierId,
      cycle_number: cycleNumber,
    });
    if (existing) {
      return res.status(409).json({ error: "Already claimed this cycle" });
    }

    // Guard: enough points?
    const points = await db.findOne("user_points", { mobile_no: phone });
    const totalSpent = points ? Number(points.total_spent) : 0;
    if (totalSpent < tier.unlockAt) {
      return res.status(403).json({
        error: `Not enough Dostt Points. Need ${tier.unlockAt}, have ${totalSpent}.`,
      });
    }

    // Log claim attempt as pending
    const notification = await db.insert("claim_notifications", {
      phone,
      country_code: countryCode,
      tier_id: tierId,
      cycle_number: cycleNumber,
      coins_awarded: tier.coins,
      status: "pending",
    });

    let redashResponse = null;
    try {
      redashResponse = await creditCoinsViaRedash(userId, tierId, tier.coins);

      // Mark notification success
      await db.update("claim_notifications", { id: notification.id }, {
        status: "success",
        redash_response: redashResponse ? JSON.stringify(redashResponse) : null,
      });
    } catch (redashErr) {
      // Mark notification failed — do NOT record the claim
      await db.update("claim_notifications", { id: notification.id }, {
        status: "failed",
        failure_reason: redashErr.message,
      });
      console.error("[rewards] Redash coin credit failed:", redashErr.message);
      return res.status(502).json({ error: "Failed to credit coins. Please try again." });
    }

    // Record claim in local DB only after successful coin credit
    const claimed = await db.insert("claimed_rewards", {
      phone,
      country_code:  countryCode,
      dostt_user_id: points ? points.user_id : null,
      tier_id:       tierId,
      unlock_at:     tier.unlockAt,
      coins_awarded: tier.coins,
      cycle_number:  cycleNumber,
    });

    res.json({ success: true, coinsAwarded: tier.coins, claimed });
  } catch (err) {
    console.error("[rewards] /claim error:", err);
    res.status(500).json({ error: "Failed to claim reward" });
  }
});

module.exports = router;
