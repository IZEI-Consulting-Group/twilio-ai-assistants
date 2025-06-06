const { createLogger, transports, format } = require('winston')
const LokiTransport = require('winston-loki')

// Niveles y configuraciones comunes
const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug'
}

const DEFAULT_FORMAT = format.combine(format.json(), format.timestamp())

class TwilioLogger {
  /**
   * @typedef {import('@twilio-labs/serverless-runtime-types/types').Context} Context
   * @typedef {'debug'|'info'|'warn'|'error'} LogLevel
   *
   * Creates a new TwilioLogger instance.
   * @param {Context} context - The Twilio Function execution context.
   * @param {string} moduleName - The name of the module.
   * @param {Object} options - An object containing the options for the logger.
   * @param {Object} [options.initialEvent] - The initial event object.
   * @param {boolean} [options.includeRequest=false] - Whether to include the request object in the initial event.
   * @param {LogLevel} [options.level=INFO] - The log level.
   * @param {string} [options.actionPrefix] - The prefix for the action.
   */
  constructor(context, moduleName, options = {}) {
    const {
      initialEvent,
      includeRequest = false,
      level = LOG_LEVELS.INFO,
      ...restOptions
    } = options
    this.context = {
      ...context,
      moduleName,
      level,
      initialEvent,
      ...restOptions
    }
    if (initialEvent && !includeRequest) this.resetInitialEvent(initialEvent)

    this.logger = createLogger({
      level,
      format: DEFAULT_FORMAT,
      transports: [
        new LokiTransporter(this.context),
        new ConsoleTransporter(this.context)
      ]
    })
  }

  _log(level, action, event) {
    const actionFormatted = this._formatAction(action)
    const meta = { action: actionFormatted, level }
    const message =
      level === LOG_LEVELS.ERROR
        ? this._formatErrorMessage(event)
        : this._formatMessage(event)

    this.logger.log(level, message, meta)
  }

  error(action, eventOrError) {
    this._log(LOG_LEVELS.ERROR, action, eventOrError)
  }

  warn(action, event) {
    this._log(LOG_LEVELS.WARN, action, event)
  }

  info(action, event) {
    this._log(LOG_LEVELS.INFO, action, event)
  }

  debug(action, event) {
    this._log(LOG_LEVELS.DEBUG, action, event)
  }

  resetInitialEvent(event) {
    const { request, ...initialEvent } = event
    this.context.initialEvent = initialEvent
  }

  _formatAction(action) {
    const { actionPrefix } = this.context
    return actionPrefix ? `${actionPrefix}-${action}` : action
  }

  _formatMessage(event) {
    if (event == null) return
    return typeof event === 'object' ? event : { message: String(event) }
  }

  _formatErrorMessage(eventOrError) {
    if (typeof eventOrError === 'object' && eventOrError != null) {
      const { error: errorEvent, ...rest } = eventOrError
      if (errorEvent instanceof Error) {
        return { ...rest, ...this._getMessageAndStackInfo(errorEvent) }
      }
    }

    return this._getMessageAndStackInfo(eventOrError)
  }

  _getMessageAndStackInfo(error) {
    const { DOMAIN_NAME, PATH, SERVICE_SID, ENVIRONMENT_SID } = this.context

    const loggedErrorMessage = {
      message: error?.message ?? error,
      stackInfo: {
        domainName: new URL(`https://${DOMAIN_NAME}`).hostname,
        path: PATH,
        serviceSid: SERVICE_SID,
        environmentSid: ENVIRONMENT_SID,
        stack: error?.stack
      }
    }

    if (error instanceof Error) {
      loggedErrorMessage.stackInfo = {
        ...loggedErrorMessage.stackInfo,
        ...error
      }
    }

    return loggedErrorMessage
  }
}

class LokiTransporter extends LokiTransport {
  constructor(options) {
    const {
      LOG_TO_GRAFANA,
      APP_NAME,
      ENV,
      GRAFANA_LOKI_USER,
      GRAFANA_LOKI_TOKEN,
      GRAFANA_LOKI_HOST,
      WEBHOOK_SITE_HOST,
      level,
      moduleName,
      initialEvent
    } = options

    const host =
      LOG_TO_GRAFANA === 'true' ? GRAFANA_LOKI_HOST : WEBHOOK_SITE_HOST
    const basicAuth =
      LOG_TO_GRAFANA === 'true'
        ? `${GRAFANA_LOKI_USER}:${GRAFANA_LOKI_TOKEN}`
        : undefined

    super({
      host,
      basicAuth,
      labels: { app: APP_NAME, module: moduleName, env: ENV },
      level: level ?? LOG_LEVELS.INFO,
      format: DEFAULT_FORMAT,
      json: true,
      replaceTimestamp: true,
      onConnectionError: (err) => console.error(err),
      timeout: 8000
    })

    this.name = 'LokiTransporter'
    this.initialEvent = initialEvent
  }

  log(info, callback) {
    const { initialEvent } = this
    const { action, level, message, ...restInfo } = info
    const cleanInfo = {
      ...restInfo,
      labels: { action, level }
    }
    const messageSymbol = Symbol.for('message')
    cleanInfo[messageSymbol] = safeStringify({
      ...message,
      initialEvent
    })

    super.log(cleanInfo, callback)
  }
}

class ConsoleTransporter extends transports.Console {
  constructor(options) {
    super({
      level: options.level ?? LOG_LEVELS.DEBUG,
      format: format.simple()
    })

    this.context = options
  }

  log(info, callback) {
    const { level, action, message } = info
    const { moduleName } = this.context

    if (message == null) console.log(`[${moduleName}] <${action}> ${level}`)
    else {
      console.log(
        `[${moduleName}] <${action}> ${level}:`,
        safeStringify(message)
      )
    }
    callback()
  }
}

function safeStringify(obj, replacer = null, space = 2) {
  const cache = new Set()
  return JSON.stringify(
    obj,
    (key, value) => {
      if (typeof value === 'object' && value != null) {
        if (cache.has(value)) {
          return '[Circular]'
        }
        cache.add(value)
      }
      return replacer ? replacer(key, value) : value
    },
    space
  )
}

module.exports = {
  TwilioLogger,
  safeStringify,
  LOG_LEVELS
}
