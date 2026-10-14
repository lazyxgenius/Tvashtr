/**
 * Grok Build's custom sandbox profiles as its CLI documents them (1.0.46, `18-sandbox.md`), for the
 * tests and the fake grok: `[profiles.<name>]` in `<cwd>/.grok/sandbox.toml`; a `deny` entry with
 * `*`, `?` or `[` is a glob — `*` and `?` stay inside one path segment, `**` spans folders,
 * `[!x]`/`[^x]` negate — matched against the whole path, so a glob that matches a folder denies the
 * folder only; any other entry denies that path and everything under it.
 */
const fs = require("fs");
const path = require("path");

function globToRegExp(glob) {
  let re = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const end = glob.indexOf("]", i + 2);
      let cls = glob.slice(i + 1, end);
      if (cls[0] === "!" || cls[0] === "^") cls = `^${cls.slice(1)}`;
      re += `[${cls.replace(/\\/g, "\\\\")}]`;
      i = end;
    } else re += c.replace(/[.+^${}()|\\/]/g, "\\$&");
  }
  return new RegExp(`${re}$`);
}

/** Whether `deny` (a profile's deny list) refuses the absolute path `p`. */
function denies(deny, p) {
  return deny.some((d) =>
    /[*?[]/.test(d) ? globToRegExp(d).test(p) : p === d || p.startsWith(`${d}/`),
  );
}

/** The deny list of `[profiles.<name>]` in `<cwd>/.grok/sandbox.toml`, or null if there is none. */
function readProfile(cwd, name) {
  let text;
  try {
    text = fs.readFileSync(path.join(cwd, ".grok", "sandbox.toml"), "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n");
  const at = lines.indexOf(`[profiles.${name}]`);
  if (at === -1) return null;
  const deny = [];
  let inDeny = false;
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("[")) break;
    if (/^deny = \[/.test(line)) inDeny = true;
    else if (inDeny && line.trim() === "]") break;
    else if (inDeny) deny.push(JSON.parse(line.trim().replace(/,$/, "")));
  }
  return deny;
}

module.exports = { globToRegExp, denies, readProfile };
