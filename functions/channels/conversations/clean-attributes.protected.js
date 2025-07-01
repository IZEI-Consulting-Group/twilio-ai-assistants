/**
 * @typedef {import('../../../assets/utils.private')} Utils
 * @typedef {import('../../../assets/logger.private')} Logger
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
  const logger = new TwilioLogger(context, "CLEAN_ATTRIBUTES", {
    initialEvent: event,
  });
  logger.info("INIT");

  const { ConversationSid, ChatServiceSid } = event;
  const response = new Twilio.Response();
  response.appendHeader("content-type", "text/plain");
  response.setBody("");

  try {
    const attributes = await readConversationAttributes(
      context,
      ChatServiceSid,
      ConversationSid
    );
    const newAttributes = {
      ...attributes,
      assistantIsTyping: undefined,
      identifiedService: undefined,
      identifiedArea: undefined,
    };

    const client = context.getTwilioClient();

    await client.conversations.v1
      .services(ChatServiceSid)
      .conversations(ConversationSid)
      .update({
        attributes: JSON.stringify(newAttributes),
      });
    logger.info("SUCCESS", newAttributes);
  } catch (err) {
    logger.error("ERROR", err);
  }

  callback(null, response);
};
