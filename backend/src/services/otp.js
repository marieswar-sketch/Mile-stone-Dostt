/**
 * OTP service — swap providers via OTP_PROVIDER env variable.
 * Supported: "twilio" (default) | "2factor"
 *
 * sendOtp(phone, countryCode)  → throws on failure
 */

const axios = require("axios");

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendViaTwilio(phone, countryCode, otp) {
  const twilio = require("twilio")(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  await twilio.messages.create({
    body: `Your Dostt verification code is ${otp}. Valid for 10 minutes.`,
    from: process.env.TWILIO_FROM,
    to: `${countryCode}${phone}`,
  });
}

async function sendVia2Factor(phone, countryCode, otp) {
  // 2Factor.in transactional SMS API
  const url = `https://2factor.in/API/V1/${process.env.TWOFACTOR_API_KEY}/SMS/${countryCode}${phone}/${otp}/${process.env.TWOFACTOR_TEMPLATE_NAME}`;
  const res = await axios.get(url);
  if (res.data.Status !== "Success") {
    throw new Error(`2Factor error: ${res.data.Details}`);
  }
}

/**
 * Sends an OTP and returns the code so the caller can persist it.
 * @returns {Promise<string>} the generated OTP
 */
async function sendOtp(phone, countryCode) {
  const otp = generateOtp();
  const provider = process.env.OTP_PROVIDER || "twilio";

  if (provider === "2factor") {
    await sendVia2Factor(phone, countryCode, otp);
  } else {
    await sendViaTwilio(phone, countryCode, otp);
  }

  return otp;
}

module.exports = { sendOtp };
