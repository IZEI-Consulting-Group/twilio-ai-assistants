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
  const services = JSON.parse(Runtime.getAssets()["/services.json"].open());
  const areas = JSON.parse(Runtime.getAssets()["/areas.json"].open());
  const logger = new TwilioLogger(context, "STUDIO_HANDOVER", {
    initialEvent: { ...event, services },
  });
  logger.info("INIT");

  async function sendWhatsAppMessage(to, body) {
    const cleanTo = to.replace('whatsapp:', '');

    const client = context.getTwilioClient();
    const from = `${context.TWILIO_WHATSAPP_NUMBER}`;
    const toWhatsApp = `whatsapp:${cleanTo}`;

    try {
      await client.messages.create({
        from,
        to: toWhatsApp,
        body,
      });
    } catch (err) {
      logger.error("WHATSAPP_SEND_FAILED", err);
    }
  }

  let customerNumber = null;
  try {
    const parsedAttributes = JSON.parse(event.TaskAttributes || '{}');
    customerNumber =
      (parsedAttributes.customerAddress || parsedAttributes.customers?.phone || '').replace('whatsapp:', '');
    logger.info("CUSTOMER_NUMBER", customerNumber);
  } catch (err) {
    logger.warn("CANNOT_PARSE_CUSTOMER_NUMBER", err);
  }

  const { identified_service: identifiedService, identified_area: identifiedArea } = event;
  if (!identifiedService || !services.includes(identifiedService)) {
    logger.error("IDENTIFIED_SERVICE_MISSING");

    if (customerNumber) {
      await sendWhatsAppMessage(
        customerNumber,
        "Lo sentimos, no se pudo identificar el servicio que solicitaste. Por favor intenta nuevamente o contacta a un agente."
      );
    }

    return callback(new Error("Missing identified service"));
  }
  if (!identifiedArea || !areas.includes(identifiedArea)) {
    logger.error("IDENTIFIED_AREA_MISSING");

    if (customerNumber) {
      await sendWhatsAppMessage(
        customerNumber,
        "Lo sentimos, no se pudo identificar el área correspondiente. Por favor intenta nuevamente o contacta a un agente."
      );
    }

    return callback(new Error("Missing identified area"));
  }

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
        attributes: JSON.stringify({ ...attributes, identifiedService, identifiedArea }),
      }),
      conversation.webhooks.create({
        target: "studio",
        "configuration.flowSid": flowSid,
      }),
    ];
    await Promise.all(configsConversation);
    logger.info("CONVERSATION_UPDATED", {
      flowSid,
      identifiedService,
      identifiedArea
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
