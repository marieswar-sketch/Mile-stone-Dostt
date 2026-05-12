require("dotenv").config();

const express = require("express");
const cors    = require("cors");

const authRoutes    = require("./routes/auth");
const rewardsRoutes = require("./routes/rewards");
const { startSyncJob } = require("./jobs/syncSheets");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/auth",    authRoutes);
app.use("/rewards", rewardsRoutes);

app.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT}`);
  console.log(`[server] DB adapter: ${process.env.DB_ADAPTER || "postgres"}`);
  console.log(`[server] OTP provider: ${process.env.OTP_PROVIDER || "twilio"}`);

  // Start Google Sheets sync job
  if (process.env.GOOGLE_SHEETS_ID) {
    startSyncJob();
  } else {
    console.warn("[server] GOOGLE_SHEETS_ID not set — sheet sync disabled.");
  }
});
