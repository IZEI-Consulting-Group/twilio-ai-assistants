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
  const logger = new TwilioLogger(context, "FLEX_HANDOVER", {
    initialEvent: event,
  });
  logger.info("INIT");
  const client = context.getTwilioClient();

  const FLEX_WORKFLOW_SID = event.FlexWorkflowSid || context.FLEX_WORKFLOW_SID;
  const FLEX_WORKSPACE_SID =
    event.FlexWorkspaceSid || context.FLEX_WORKSPACE_SID;

  if (!FLEX_WORKFLOW_SID || !FLEX_WORKSPACE_SID) {
    logger.error("FLEX_MISSING", { FLEX_WORKFLOW_SID, FLEX_WORKSPACE_SID });
    return callback(
      new Error(
        "Missing configuration for FLEX_WORKSPACE_SID OR FLEX_WORKFLOW_SID"
      )
    );
  }

  const [serviceSid, conversationsSid] = event.request.headers["x-session-id"]
    ?.replace("conversations__", "")
    .split("/");
  const [traitName, identity] = event.request.headers["x-identity"]?.split(":");

  if (!identity || !conversationsSid) {
    logger.error("INVALID_REQUEST", { traitName, identity });
    return callback(new Error("Invalid request"));
  }

  let region = "";
  if (identity.startsWith("+5281") || identity.startsWith("+52181"))
    region = "norte";
  if (identity.startsWith("+5255") || identity.startsWith("+52155"))
    region = "centro";
  if (identity.startsWith("+5256") || identity.startsWith("+52156"))
    region = "centro";
  logger.info("IDENTITY", { traitName, identity, region });
  let conversation = null;
  try {
    let from = identity;
    let customerName = identity;
    let customerAddress = identity;
    let channelType = "chat";
    if (traitName === "whatsapp") {
      channelType = "whatsapp";
      from = `whatsapp:${identity}`;
      customerName = from;
      customerAddress = from;
    } else if (identity.startsWith("+")) {
      channelType = "sms";
      customerName = from;
      customerAddress = from;
    } else if (identity.startsWith("FX")) {
      // Flex webchat
      channelType = "web";
      customerName = from;
      customerAddress = from;
      try {
        const user = await client.conversations.v1.users(identity).fetch();
        from = user.friendlyName;
      } catch (err) {
        logger.error("USER_FETCH", err);
      }
    }

    conversation = client.conversations.v1
      .services(serviceSid)
      .conversations(conversationsSid);
    const webhooks = await conversation.webhooks.list();
    const webhooksToRemove = webhooks.map((webhook) => webhook.remove());
    await Promise.all(webhooksToRemove);

    const interactionConfig = {
      channel: {
        type: channelType,
        initiated_by: "customer",
        properties: {
          media_channel_sid: conversationsSid,
        },
      },
      routing: {
        properties: {
          workspace_sid: FLEX_WORKSPACE_SID,
          workflow_sid: FLEX_WORKFLOW_SID,
          task_channel_unique_name: "chat",
          attributes: {
            from,
            customerName,
            customerAddress,
            region,
          },
        },
      },
    };
    logger.info("INTERACTION_CONFIG", interactionConfig);
    const result = await client.flexApi.v1.interaction.create(
      interactionConfig
    );
    logger.info("RESULT", { sid: result.sid });
  } catch (err) {
    if (conversation) {
      await conversation.messages.create({
        author: "Twilio AI Assistant",
        body: "🫨 Ups! Hubo un *error al transferirte* a un asesor.\n\n_Intenta de nuevo mas tarde._",
      });
      await conversation.webhooks.create({
        target: "webhook",
        "configuration.method": "POST",
        "configuration.url": `https://${context.DOMAIN_NAME}/channels/conversations/messageAdded`,
        "configuration.filters": ["onMessageAdded"],
      });
    }
    logger.error("ERROR", err);
    return callback(new Error("Failed to hand over to a human agent"));
  }

  return callback(null, "Transferred to human agent");
};
