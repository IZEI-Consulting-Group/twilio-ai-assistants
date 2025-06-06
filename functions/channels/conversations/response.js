/**
 * @typedef {import('../../../assets/utils.private')} Utils
 * @typedef {import('../../../assets/logger.private')} Logger
 */

/** @type {Utils} */
const {
  verifyRequest,
  readConversationAttributes,
} = require(Runtime.getAssets()["/utils.js"].path);

/** @type {Logger} */
const { TwilioLogger } = require(Runtime.getAssets()["/logger.js"].path);

/**
 * @param {import('@twilio-labs/serverless-runtime-types/types').Context} context
 * @param {{}} event
 * @param {import('@twilio-labs/serverless-runtime-types/types').ServerlessCallback} callback
 */
exports.handler = async function (context, event, callback) {
  const logger = new TwilioLogger(context, "RESPONSE_AI", {
    initialEvent: event,
  });
  logger.info("INIT");

  try {
    if (!verifyRequest(context, event)) {
      logger.error("INVALID_TOKEN");
      return callback(new Error("Invalid token"));
    }
    const assistantIdentity =
      typeof event._assistantIdentity === "string"
        ? event._assistantIdentity
        : undefined;

    if (event.Status === "Failed") {
      logger.error("FAILED", { assistantIdentity });
      return callback(
        new Error("Failed to generate response. Check error logs.")
      );
    }

    const client = context.getTwilioClient();

    const [serviceSid, conversationsSid] = event.SessionId.replace(
      "webhook:conversations__",
      ""
    ).split("/");
    const body = event.Body;
    logger.info("VARIABLES", { serviceSid, conversationsSid, body });

    const attributes = await readConversationAttributes(
      context,
      serviceSid,
      conversationsSid
    );
    await client.conversations.v1
      .services(serviceSid)
      .conversations(conversationsSid)
      .update({
        attributes: JSON.stringify({ ...attributes, assistantIsTyping: false }),
      });

    const message = await client.conversations.v1
      .services(serviceSid)
      .conversations(conversationsSid)
      .messages.create({
        body,
        author: assistantIdentity,
      });

    logger.info("SUCCESS", message);

    return callback(null, {});
  } catch (err) {
    logger.error("ERROR", err);
    return callback(null, {});
  }
};
