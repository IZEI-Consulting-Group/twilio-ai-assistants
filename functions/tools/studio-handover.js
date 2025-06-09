/**
 * @typedef {import('../../assets/utils.private')} Utils
 * @typedef {import('../../assets/logger.private')} Logger
 */

/** @type {Utils} */
const { readConversationAttributes } = require(Runtime.getAssets()["/utils.js"]
  .path);

/** @type {Logger} */
const { TwilioLogger } = require(Runtime.getAssets()["/logger.js"].path);

/**
 * @param {import('@twilio-labs/serverless-runtime-types/types').Context} context
 * @param {{}} event
 * @param {import('@twilio-labs/serverless-runtime-types/types').ServerlessCallback} callback
 */
exports.handler = async function (context, event, callback) {
  const logger = new TwilioLogger(context, "STUDIO_HANDOVER", {
    initialEvent: event,
  });
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

    const flowSid = event.FlowSid || event.flowSid || context.STUDIO_FLOW_SID;
    if (!flowSid) {
      logger.error("FLOW_SID_MISSING");
      return callback(new Error("Unable to hand over conversation"));
    }

    logger.info("VARIABLES", { serviceSid, conversationsSid, flowSid });
    const conversation = client.conversations.v1
      .services(serviceSid)
      .conversations(conversationsSid);
    const webhooks = await conversation.webhooks.list();
    const webhooksToRemove = webhooks.map((webhook) => webhook.remove());
    await Promise.all(webhooksToRemove);

    const attributes = await readConversationAttributes(
      context,
      serviceSid,
      conversationsSid
    );
    const configsConversation = [
      conversation.update({
        attributes: JSON.stringify({ ...attributes, identifiedService }),
      }),
      conversation.webhooks.create({
        target: "studio",
        "configuration.flowSid": flowSid,
      }),
    ];
    await Promise.all(configsConversation);
    logger.info("CONVERSATION_UPDATED", {
      flowSid,
      message,
      identifiedService,
    });

    const successMessage =
      event.SuccessMessage ??
      event.successMessage ??
      "Conversation handed over";

    logger.info("SUCCESS", successMessage);
    return callback(null, successMessage);
  } catch (err) {
    logger.error("ERROR", err);
    return callback(null, "Could not handover");
  }
};
