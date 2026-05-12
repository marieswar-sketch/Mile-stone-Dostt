/**
 * 30-day cycle helper.
 *
 * Cycles start from GO_LIVE_DATE and repeat every CYCLE_DAYS days (default 30).
 * Cycle 1 = days 0–29, Cycle 2 = days 30–59, etc.
 */

function getCycleInfo() {
  const goLive = process.env.GO_LIVE_DATE ? new Date(process.env.GO_LIVE_DATE) : null;
  const cycleDays = parseInt(process.env.CYCLE_DAYS || "30", 10);

  if (!goLive || isNaN(goLive.getTime())) {
    // No go-live date set — everything is cycle 1, no reset date
    return { cycleNumber: 1, cycleStartDate: null, cycleEndDate: null, cycleDays };
  }

  const now = Date.now();
  const elapsed = Math.floor((now - goLive.getTime()) / (1000 * 60 * 60 * 24));
  const cycleNumber = Math.floor(elapsed / cycleDays) + 1;
  const cycleStartDate = new Date(goLive.getTime() + (cycleNumber - 1) * cycleDays * 24 * 60 * 60 * 1000);
  const cycleEndDate   = new Date(cycleStartDate.getTime() + cycleDays * 24 * 60 * 60 * 1000);

  return { cycleNumber, cycleStartDate, cycleEndDate, cycleDays };
}

module.exports = { getCycleInfo };
