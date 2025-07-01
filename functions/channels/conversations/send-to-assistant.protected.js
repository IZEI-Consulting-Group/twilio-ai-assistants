/**
 * @typedef {import('../../../assets/utils.private')} Utils
 * @typedef {import('../../../assets/logger.private')} Logger
 */

/** @type {Utils} */
const {
  signRequest,
  sendMessageToAssistant,
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
  const logger = new TwilioLogger(context, "SEND_TO_ASSISTANT", {
    initialEvent: event,
  });
  logger.info("INIT");

  const { ConversationSid, ChatServiceSid, Author, Body, AssistantSid, InfoUser } = event;
  const AssistantIdentity =
    typeof event.AssistantIdentity === "string"
      ? event.AssistantIdentity
      : undefined;

  const identity = Author.includes(":") ? Author : `user_id:${Author}`;

  const client = context.getTwilioClient();

  const conversation = client.conversations.v1
    .services(ChatServiceSid)
    .conversations(ConversationSid);
  const webhooks = await conversation.webhooks.list();
  const webhooksToRemove = webhooks.map((webhook) => webhook.remove());
  await Promise.all(webhooksToRemove);
  await conversation.webhooks.create({
    target: "webhook",
    "configuration.method": "POST",
    "configuration.url": `https://${context.DOMAIN_NAME}/channels/conversations/messageAdded`,
    "configuration.filters": ["onMessageAdded"],
  });

  const token = await signRequest(context, event);
  const params = new URLSearchParams();
  params.append("_token", token);
  if (typeof AssistantIdentity === "string") {
    params.append("_assistantIdentity", AssistantIdentity);
  }
  const body = {
    body: Body,
    identity,
    session_id: `conversations__${ChatServiceSid}/${ConversationSid}`,
    // using a callback to handle AI Assistant responding
    webhook: `https://${
      context.DOMAIN_NAME
    }/channels/conversations/response?${params.toString()}`,
  };
  logger.info("REQUEST", body);

  const response = new Twilio.Response();
  response.appendHeader("content-type", "text/plain");
  response.setBody("");

  const attributes = await readConversationAttributes(
    context,
    ChatServiceSid,
    ConversationSid
  );
  await client.conversations.v1
    .services(ChatServiceSid)
    .conversations(ConversationSid)
    .update({
      attributes: JSON.stringify({ ...attributes, assistantIsTyping: true, infoUser: InfoUser }),
    });

  try {
    const sendedMessage = await sendMessageToAssistant(
      context,
      AssistantSid,
      body
    );
    logger.info("SUCCESS", sendedMessage);
  } catch (err) {
    logger.error("ERROR", err);
  }

  callback(null, response);
};
