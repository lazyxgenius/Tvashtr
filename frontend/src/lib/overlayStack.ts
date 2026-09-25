// The open overlays (dialogs, sheets, menus, pickers), innermost last. Each one listens for keys on
// `document`, so without a shared stack one Escape would close a ⋯ menu AND the dialog under it, and
// two focus traps would fight over Tab. Only the top-most overlay reacts to keys.
const stack: symbol[] = [];

export function pushOverlay(): symbol {
  const token = Symbol("overlay");
  stack.push(token);
  return token;
}

export function removeOverlay(token: symbol): void {
  const at = stack.indexOf(token);
  if (at !== -1) stack.splice(at, 1);
}

export function isTopOverlay(token: symbol): boolean {
  return stack[stack.length - 1] === token;
}
