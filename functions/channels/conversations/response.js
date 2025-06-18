/**
 * @typedef {import('../../../assets/utils.private')} Utils
 * @typedef {import('../../../assets/logger.private')} Logger
 */

/** @type {Utils} */
const {
  verifyRequest,
  readConversationAttributes,
  extractBodyAndMeta,
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

  const [serviceSid, conversationsSid] = event.SessionId.replace(
    "webhook:conversations__",
    ""
  ).split("/");
  const assistantIdentity =
    typeof event._assistantIdentity === "string"
      ? event._assistantIdentity
      : undefined;

  const client = context.getTwilioClient();
  try {
    if (!verifyRequest(context, event)) {
      logger.error("INVALID_TOKEN");
      return callback(new Error("Invalid token"));
    }

    if (event.Status === "Failed" || event.Status === "Failure") {
      logger.error("FAILED", { assistantIdentity });

      throw new Error("Failed to generate response. Check error logs.");
    }

    const { body, meta } = extractBodyAndMeta(event.Body);
    logger.info("VARIABLES", { serviceSid, conversationsSid, body, meta });

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

    const { contentSid, contentVariables } = meta || {};
    const message = await client.conversations.v1
      .services(serviceSid)
      .conversations(conversationsSid)
      .messages.create({
        body,
        author: assistantIdentity,
        contentSid,
        contentVariables,
      })
      .then(() => {
        if (contentSid) {
          return client.conversations.v1
            .services(serviceSid)
            .conversations(conversationsSid)
            .messages.create({
              body,
              author: assistantIdentity,
            });
        }
      });

    logger.info("SUCCESS", { message, body, meta });

    return callback(null, {});
  } catch (err) {
    await client.conversations.v1
      .services(serviceSid)
      .conversations(conversationsSid)
      .messages.create({
        body: "¡Uy! Parece que algo falló al procesar tu mensaje 😅\n\n¿Te parece si lo intentamos otra vez? Puedes repetir tu pregunta o escribirla de otra forma. ¡Estoy listo para ayudarte! 💬",
        author: assistantIdentity,
      });
    logger.error("ERROR", err);
    return callback(err);
  }
};
