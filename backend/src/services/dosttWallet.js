const axios = require("axios");
const FormData = require("form-data");

async function creditCoins(dosttUserId, tierId, coins) {
  const url     = process.env.DOSTT_WALLET_API_URL;
  const authKey = process.env.DOSTT_WALLET_AUTH_KEY;

  if (!url || !authKey) {
    throw new Error("DOSTT_WALLET_API_URL / DOSTT_WALLET_AUTH_KEY not set");
  }
  if (!dosttUserId) {
    throw new Error(`Cannot credit wallet — dostt_user_id is null for tier ${tierId}`);
  }

  const csv = `user_id,coins\n${dosttUserId},${coins}\n`;

  const form = new FormData();
  form.append("file", Buffer.from(csv), {
    filename: "coins_batch.csv",
    contentType: "text/csv",
  });
  form.append("name", "Dostt free Rewards");

  const response = await axios.post(url, form, {
    headers: {
      ...form.getHeaders(),
      "x-n8n-auth-key": authKey,
    },
    timeout: 20_000,
  });

  return response.data;
}

module.exports = { creditCoins };
