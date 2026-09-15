/**
 * Tiny node assert suite for desktop proxy cookie rewrite (no jest required).
 * Run: node scripts/proxy-auth.test.cjs
 */
const assert = require("assert");
const { stripCookieDomainAndSecure } = require("./local-server.cjs");

const input =
  "tv_session=abc; Path=/; HttpOnly; Secure; SameSite=lax; Domain=tvashtr.fly.dev";
const out = stripCookieDomainAndSecure(input);
assert.ok(!/Domain=/i.test(out), "Domain must be stripped");
assert.ok(!/;\s*Secure/i.test(out), "Secure must be stripped");
assert.ok(out.includes("tv_session=abc"), "name/value kept");
assert.ok(out.includes("HttpOnly"), "HttpOnly kept");
assert.ok(/SameSite=lax/i.test(out), "SameSite kept");
console.log("proxy-auth.test.cjs OK");
