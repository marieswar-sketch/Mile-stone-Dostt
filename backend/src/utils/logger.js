function log(level, msg, meta = {}) {
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...meta }) + "\n"
  );
}

module.exports = {
  info:  (msg, meta = {}) => log("info",  msg, meta),
  warn:  (msg, meta = {}) => log("warn",  msg, meta),
  error: (msg, meta = {}) => log("error", msg, meta),
};
