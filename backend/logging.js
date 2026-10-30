// Never log database messages, SQL, parameters, connection strings or stacks.
function logError(logger, context, error) {
  const code = typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : "UNCLASSIFIED";
  logger.error(`${context} [${code}]`);
}
module.exports = { logError };
