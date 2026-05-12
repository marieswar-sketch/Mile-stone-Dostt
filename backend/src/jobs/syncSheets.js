/**
 * Cron job: syncs Google Sheet → user_points every 2 hours.
 * Also runs once immediately on startup.
 */

const cron = require("node-cron");
const { syncFromSheet } = require("../services/sheets");

async function runSync() {
  try {
    await syncFromSheet();
  } catch (err) {
    console.error("[syncSheets] Error during sync:", err.message);
  }
}

function startSyncJob() {
  // Run immediately on startup
  runSync();

  // Then every 2 hours
  cron.schedule("0 */2 * * *", runSync);
  console.log("[syncSheets] Sheet sync job scheduled (every 2 hours).");
}

module.exports = { startSyncJob };
