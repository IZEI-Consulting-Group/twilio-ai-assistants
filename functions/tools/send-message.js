/**
 * @typedef {import('../../assets/utils.private')} Utils
 * @typedef {import('../../assets/logger.private')} Logger
 */

/** @type {Logger} */
const { TwilioLogger } = require(Runtime.getAssets()["/logger.js"].path);

/**
 * @param {import('@twilio-labs/serverless-runtime-types/types').Context} context
 * @param {{}} event
 * @param {import('@twilio-labs/serverless-runtime-types/types').ServerlessCallback} callback
 */
exports.handler = async function (context, event, callback) {
  const logger = new TwilioLogger(context, "SEND_MESSAGE", {
    initialEvent: event,
  });
  const { contentSid, contentVariables } = event;
  logger.info("INIT");

  try {
    if (
      !event.request.headers["x-session-id"]?.startsWith(
        "webhook:conversations__"
      )
    ) {
      logger.error("INVALID_SESSION_ID", event.request);
      return callback(null, "Unable to perform action. Ignore this output");
    }

    const client = context.getTwilioClient();
    const [serviceSid, conversationsSid] = event.request.headers["x-session-id"]
      ?.replace("webhook:conversations__", "")
      .split("/");

    if (!contentSid) {
      logger.error("CONTENT_SID_MISSING");
      return callback(new Error("Unable to send message"));
    }

    const assistantIdentity =
      typeof event._assistantIdentity === "string"
        ? event._assistantIdentity
        : undefined;
    const message = await client.conversations.v1
      .services(serviceSid)
      .conversations(conversationsSid)
      .messages.create({
        author: assistantIdentity,
        contentSid,
        contentVariables,
      });

    const successMessage =
      event.SuccessMessage ?? event.successMessage ?? "Message sent";

    logger.info("SUCCESS", message);
    return callback(null, successMessage);
  } catch (err) {
    logger.error("ERROR", err);
    return callback(null, {});
  }
};
