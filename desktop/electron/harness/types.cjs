/** @typedef {"claude"|"grok"|"codex"} SubscriptionProviderId */
/** @typedef {"disconnected"|"checking"|"needs_install"|"needs_login"|"connected"|"error"} SubscriptionCardState */

/**
 * @typedef {object} EngineStatus
 * @property {SubscriptionProviderId} provider
 * @property {boolean} connected
 * @property {SubscriptionCardState} state
 * @property {string|null} account_hint
 * @property {"harness"|"oauth"|null} source
 * @property {string|null} checked_at
 */

module.exports = {};
