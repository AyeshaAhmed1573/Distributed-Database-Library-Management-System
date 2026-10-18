// Node health checks, used by /health and by the search/reservation services
// to decide whether a branch is safe to route to. Thin wrapper around db.js
// so routes don't import db.js directly for this.
export { checkNode, checkAllNodes } from "../db.js";
