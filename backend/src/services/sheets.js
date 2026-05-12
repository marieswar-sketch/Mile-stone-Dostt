/**
 * Google Sheets sync service.
 *
 * Reads the configured spreadsheet and upserts rows into user_points.
 *
 * Expected sheet columns (row 1 = header):
 *   user_id | mobile_no | wallet_balance | spent_on_audio |
 *   spent_on_video | total_spent | last_refreshed_at_ist | ltv
 *
 * GO_LIVE_DATE (env, ISO string) — rows whose last_refreshed_at_ist is
 * before this date are treated as having total_spent = 0, so only spend
 * accumulated after go-live is counted towards rewards.
 */

const { google } = require("googleapis");
const db = require("../db/client");

async function getSheetRows() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const range  = `${process.env.GOOGLE_SHEET_NAME || "Sheet1"}!A:H`;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range,
  });

  return response.data.values || [];
}

function normalisePhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function parseNum(raw) {
  const n = parseFloat(String(raw || "0").replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

async function syncFromSheet() {
  console.log("[sheets] Starting sync…");
  const rows = await getSheetRows();

  if (rows.length < 2) {
    console.log("[sheets] Sheet is empty or header-only — skipping.");
    return;
  }

  // Resolve column indices from header row (case/space insensitive)
  const headers = rows[0].map(h =>
    String(h).trim().toLowerCase().replace(/\s+/g, "_")
  );
  const col = name => headers.indexOf(name);

  const idxUserId         = col("user_id");
  const idxMobileNo       = col("mobile_no");
  const idxWalletBalance  = col("wallet_balance");
  const idxSpentOnAudio   = col("spent_on_audio");
  const idxSpentOnVideo   = col("spent_on_video");
  const idxTotalSpent     = col("total_spent");
  const idxLastRefreshed  = col("last_refreshed_at_ist");
  const idxLtv            = col("ltv");

  if (idxMobileNo === -1 || idxTotalSpent === -1) {
    throw new Error(
      "[sheets] Required columns mobile_no / total_spent not found in header row."
    );
  }

  const goLiveDate = process.env.GO_LIVE_DATE ? new Date(process.env.GO_LIVE_DATE) : null;

  let upserted = 0;
  let skipped  = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const mobile_no = normalisePhone(row[idxMobileNo]);
    if (!mobile_no) { skipped++; continue; }

    const last_refreshed_at_ist = idxLastRefreshed !== -1
      ? parseDate(row[idxLastRefreshed])
      : null;

    // If go-live date is set and this row hasn't been refreshed after it yet,
    // store the row but treat total_spent as 0 so it won't unlock any tiers.
    const afterGoLive = !goLiveDate
      || (last_refreshed_at_ist && last_refreshed_at_ist >= goLiveDate);

    const rawTotalSpent = parseNum(idxTotalSpent !== -1 ? row[idxTotalSpent] : 0);

    const ltv = parseNum(idxLtv !== -1 ? row[idxLtv] : 0);

    await db.upsert(
      "user_points",
      {
        user_id:              idxUserId        !== -1 ? String(row[idxUserId] || "").trim() : null,
        mobile_no,
        wallet_balance:       parseNum(idxWalletBalance !== -1 ? row[idxWalletBalance] : 0),
        spent_on_audio:       parseNum(idxSpentOnAudio  !== -1 ? row[idxSpentOnAudio]  : 0),
        spent_on_video:       parseNum(idxSpentOnVideo  !== -1 ? row[idxSpentOnVideo]  : 0),
        total_spent:          afterGoLive ? rawTotalSpent : 0,
        last_refreshed_at_ist,
        ltv,
        synced_at:            new Date(),
      },
      ["mobile_no"]
    );

    // Keep ltv_eligibility in sync — eligible only while ltv is 500–1500
    const isEligible = ltv >= 500 && ltv <= 1500;
    await db.upsert(
      "ltv_eligibility",
      {
        mobile_no,
        ltv,
        is_eligible:    isEligible,
        ineligible_at:  isEligible ? null : new Date(),
        updated_at:     new Date(),
      },
      ["mobile_no"]
    );

    upserted++;
  }

  console.log(`[sheets] Sync complete — ${upserted} upserted, ${skipped} skipped.`);
}

module.exports = { syncFromSheet };
