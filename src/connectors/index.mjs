import { atlassian } from './atlassian.mjs';
import { salesforce } from './salesforce.mjs';

// A connector is one system pilotkit can read (Jira and Confluence, Salesforce), with its own MCP server
// named `pilotkit-<id>`. Each is added and registered on its own, so Copilot only carries the
// tools of the systems a user added; the desk and its credits cover all of them.
//
// A connector has: id, title, server, replaces (old server names), env (variables its server
// needs), tools (names), configured(config), setup(config, { brand, opts }), check(config) (for
// doctor and the desk: { ok, message, fix?, account? }), forget(config), summary(config) (where it
// reads, without network), desk(config) and serve().
export const CONNECTORS = [atlassian, salesforce];

export function findConnector(id) {
  const c = CONNECTORS.find((x) => x.id === id);
  if (!c) throw new Error(`"${id}" is not a pilotkit connector. Connectors: ${CONNECTORS.map((x) => x.id).join(', ')}`);
  return c;
}

/** The connectors this PC added, in catalogue order. */
export function addedConnectors(config) {
  return CONNECTORS.filter((c) => config.connectors.includes(c.id));
}

export function markAdded(config, connector) {
  if (!config.connectors.includes(connector.id)) config.connectors = [...config.connectors, connector.id];
}

export function markRemoved(config, connector) {
  config.connectors = config.connectors.filter((id) => id !== connector.id);
}
