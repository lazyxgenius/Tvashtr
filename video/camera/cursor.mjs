/**
 * The camera's cursor (F7): an overlay drawn in the page by the camera, never product code. The REAL
 * mouse moves along the same eased path (the overlay follows real mousemove events), so hover states
 * are real; a click shows a ripple; the cursor parks off the controls after each click; typing is at
 * a human pace. Every step goes into the take's step log (time in the clip, kind, label, position in
 * CSS px of the 1440×900 view, target box) for V4's zooms.
 */
import { sleep } from "./desktop.mjs";

/** Installed with addInitScript (every document) and evaluated once on the current one. */
export const CURSOR_SCRIPT = `(() => {
  if (window.__tvCam) return;
  const SVG = '<svg width="24" height="30" viewBox="0 0 24 30" style="position:absolute;left:-4px;top:-3px;overflow:visible;filter:drop-shadow(0 1.5px 2.5px rgba(0,0,0,.35))"><path d="M4 3 L4 23.5 L9.4 18.6 L13 27 L16.8 25.4 L13.3 17.2 L20.4 17.2 Z" fill="#141413" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  let root = null, x = -200, y = -200;
  const mount = () => {
    if (root && root.isConnected) return root;
    root = document.createElement("div");
    root.id = "tv-cam-cursor";
    root.setAttribute("aria-hidden", "true");
    root.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;will-change:transform;";
    root.innerHTML = SVG;
    root.style.transform = "translate(" + x + "px," + y + "px)";
    document.documentElement.appendChild(root);
    const style = document.createElement("style");
    style.textContent = "@keyframes tv-cam-ripple{from{transform:translate(-50%,-50%) scale(.25);opacity:.55}to{transform:translate(-50%,-50%) scale(1);opacity:0}}";
    document.documentElement.appendChild(style);
    return root;
  };
  const move = (e) => {
    x = e.clientX; y = e.clientY;
    mount().style.transform = "translate(" + x + "px," + y + "px)";
  };
  addEventListener("mousemove", move, true);
  addEventListener("mousedown", (e) => {
    move(e);
    const r = document.createElement("div");
    r.style.cssText = "position:fixed;left:" + e.clientX + "px;top:" + e.clientY + "px;width:44px;height:44px;border-radius:50%;border:2.5px solid rgba(217,119,87,.9);background:rgba(217,119,87,.18);pointer-events:none;z-index:2147483646;animation:tv-cam-ripple .5s ease-out forwards;";
    mount();
    document.documentElement.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }, true);
  const INTERACTIVE = "button,a[href],input,textarea,select,summary,label,[role=button],[role=menuitem],[role=option],[role=tab],[role=switch],[role=checkbox],[role=radio],[role=link],[contenteditable=true],.react-flow__handle,.react-flow__node,.react-flow__edge";
  window.__tvCam = {
    /** A point near (px,py) with no control under it (and not under the given box). */
    park(px, py, bx, by, bw, bh) {
      const offs = [[56, 64], [-64, 60], [72, -48], [-60, -56], [110, 20], [20, 110], [-120, 10], [150, 90], [-150, 100], [0, 170], [200, -60]];
      for (const [dx, dy] of offs) {
        const tx = Math.round(px + dx), ty = Math.round(py + dy);
        if (tx < 12 || ty < 40 || tx > innerWidth - 12 || ty > innerHeight - 12) continue;
        if (bw && tx >= bx - 8 && tx <= bx + bw + 8 && ty >= by - 8 && ty <= by + bh + 8) continue;
        const el = document.elementFromPoint(tx, ty);
        if (el && !el.closest(INTERACTIVE)) return [tx, ty];
      }
      return [Math.min(innerWidth - 40, px + 90), Math.min(innerHeight - 40, py + 90)];
    },
    /** Is the element at (px,py) the target (or inside it)? */
    hits(px, py, sel) {
      const el = document.elementFromPoint(px, py);
      return Boolean(el && sel && (el === sel || sel.contains(el)));
    },
  };
  if (document.documentElement) mount();
  else addEventListener("DOMContentLoaded", mount, { once: true });
})();`;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const round = (v) => Math.round(v * 10) / 10;

/**
 * A cursor bound to `page`. `log` collects steps once `start()` sets the clip's clock; before that
 * (pre-roll) moves are made but not logged.
 */
export function makeCursor(page, { speed = 1 } = {}) {
  let x = 1300;
  let y = 860;
  let t0 = null;
  const steps = [];
  const regions = {};
  const now = () => (t0 === null ? null : round((Date.now() - t0) / 1000));
  const log = (kind, label, extra = {}) => {
    if (t0 === null) return;
    steps.push({ t: now(), kind, label, x: round(x), y: round(y), ...extra });
  };

  async function install() {
    await page.addInitScript(CURSOR_SCRIPT).catch(() => {});
    await page.evaluate(CURSOR_SCRIPT).catch(() => {});
  }

  /** Eased glide from the current point to (tx,ty), moving the real mouse along the path. */
  async function glide(tx, ty, { ms } = {}) {
    const d = Math.hypot(tx - x, ty - y);
    const dur = (ms ?? Math.min(1100, Math.max(260, 220 + d * 0.75))) / speed;
    const frames = Math.max(2, Math.round(dur / 16));
    const sx = x;
    const sy = y;
    const start = Date.now();
    for (let i = 1; i <= frames; i += 1) {
      const k = ease(i / frames);
      x = sx + (tx - sx) * k;
      y = sy + (ty - sy) * k;
      await page.mouse.move(x, y);
      const wait = start + (dur * i) / frames - Date.now();
      if (wait > 0) await sleep(wait);
    }
  }

  async function boxOf(locator) {
    await locator.waitFor({ state: "attached", timeout: 30000 });
    if (!(await locator.isVisible())) {
      // A visually hidden control (a switch's or checkbox's <input>): aim at what the viewer sees —
      // its label, else the nearest ancestor with a size. A real click there toggles it.
      const box = await locator.evaluate((el) => {
        let v = el.closest("label") ?? el.parentElement;
        while (v && (v.getBoundingClientRect().width < 4 || v.getBoundingClientRect().height < 4)) v = v.parentElement;
        if (!v) return null;
        v.scrollIntoView({ block: "nearest" });
        const r = v.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      if (box) return box;
    }
    await locator.waitFor({ state: "visible", timeout: 30000 });
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const b = await locator.boundingBox();
    if (!b) throw new Error("no box for the cursor's target");
    return b;
  }

  async function park(box) {
    const [px, py] = await page.evaluate(
      ([cx, cy, b]) => window.__tvCam?.park(cx, cy, b?.x, b?.y, b?.width, b?.height) ?? [cx + 60, cy + 60],
      [x, y, box ?? null],
    );
    await glide(px, py, { ms: 420 });
  }

  /** Glide to a target and rest on it (a hover). */
  async function hover(locator, label, { at } = {}) {
    const b = await boxOf(locator);
    const [tx, ty] = at ? [b.x + at[0], b.y + at[1]] : [b.x + b.width / 2, b.y + b.height / 2];
    await glide(tx, ty);
    log("hover", label, { box: box4(b) });
    await sleep(350 / speed);
    return b;
  }

  /** Glide, click with the real mouse (a ripple), then park off the controls. */
  async function click(locator, label, { at, park: doPark = true, double = false } = {}) {
    const b = await boxOf(locator);
    const [tx, ty] = at ? [b.x + at[0], b.y + at[1]] : [b.x + b.width / 2, b.y + b.height / 2];
    await glide(tx, ty);
    await sleep(140 / speed);
    const handle = await locator.elementHandle();
    const onTarget = await page
      .evaluate(([px, py, el]) => window.__tvCam?.hits(px, py, el.closest?.("label") ?? el) ?? true, [tx, ty, handle])
      .catch(() => true);
    log("click", label, { box: box4(b) });
    if (onTarget) {
      await page.mouse.down();
      await sleep(70);
      await page.mouse.up();
      if (double) {
        await sleep(90);
        await page.mouse.down();
        await sleep(70);
        await page.mouse.up();
      }
    } else {
      // Something covers the point (an overlay mid-animation): click the element itself.
      await (double ? locator.dblclick() : locator.click());
    }
    await sleep(260 / speed);
    if (doPark) await park(b);
    return b;
  }

  /** Glide to a point (CSS px) and click there with the real mouse (an SVG path, a canvas spot). */
  async function clickAt(tx, ty, label) {
    await glide(tx, ty);
    await sleep(140 / speed);
    log("click", label);
    await page.mouse.down();
    await sleep(70);
    await page.mouse.up();
    await sleep(260 / speed);
    await park({ x: tx - 20, y: ty - 20, width: 40, height: 40 });
  }

  /** Click into a field, then type at a human pace. `clear` empties it first (select-all + delete). */
  async function type(locator, text, label, { clear = false, cps = 16, click: doClick = true } = {}) {
    if (doClick) await click(locator, label, { park: false });
    if (clear) {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.press("Backspace");
    }
    const b = await locator.boundingBox().catch(() => null);
    if (b) await park(b);
    const t = now();
    for (const ch of text) {
      await page.keyboard.type(ch);
      const base = 1000 / cps;
      const jitter = base * (0.55 + Math.random() * 0.9);
      await sleep((/[ .,:;!?\n]/.test(ch) ? jitter * 1.8 : jitter) / speed);
    }
    if (t0 !== null) steps.push({ t, t_end: now(), kind: "type", label, text, x: round(x), y: round(y), box: b && box4(b) });
  }

  async function press(key, label) {
    log("key", label || key);
    await page.keyboard.press(key);
    await sleep(220 / speed);
  }

  /** Drag from one locator's point to another's with the button held (canvas edges, reorders). */
  async function drag(from, to, label, { fromAt, toAt } = {}) {
    const a = await boxOf(from);
    const [ax, ay] = fromAt ? [a.x + fromAt[0], a.y + fromAt[1]] : [a.x + a.width / 2, a.y + a.height / 2];
    await glide(ax, ay);
    await sleep(160);
    log("drag", label, { from: [round(ax), round(ay)] });
    await page.mouse.down();
    const b = await boxOf(to);
    const [bx, by] = toAt ? [b.x + toAt[0], b.y + toAt[1]] : [b.x + b.width / 2, b.y + b.height / 2];
    await glide(bx, by, { ms: 900 });
    await sleep(120);
    await page.mouse.up();
    await sleep(260);
    await park(b);
  }

  /** Wheel-scroll at the current point (positive = down), in gentle increments. */
  async function scroll(dy, label = "scroll") {
    log("scroll", label, { dy });
    const n = Math.max(1, Math.round(Math.abs(dy) / 60));
    for (let i = 0; i < n; i += 1) {
      await page.mouse.wheel(0, dy / n);
      await sleep(28);
    }
    await sleep(300);
  }

  /** A region of interest (the reel's zoom target) from a locator or a box. */
  async function roi(name, target) {
    const b = target && typeof target.boundingBox === "function" ? await target.boundingBox() : target;
    if (b) regions[name] = { t: now(), ...box4(b) };
    return b;
  }

  return {
    install,
    /** The clip's clock starts now (the screencast's first frame). */
    start(at = Date.now()) {
      t0 = at;
    },
    glide: async (tx, ty, label) => {
      await glide(tx, ty);
      if (label) log("move", label);
    },
    /** Rest the cursor at a safe spot (pre-roll and between beats). */
    async rest(tx = 1300, ty = 860) {
      await glide(tx, ty, { ms: 500 });
    },
    park,
    hover,
    click,
    clickAt,
    type,
    press,
    drag,
    scroll,
    roi,
    mark: (label, extra) => log("mark", label, extra),
    pause: async (ms, label) => {
      if (label) log("pause", label, { ms });
      await sleep(ms);
    },
    get steps() {
      return steps;
    },
    get regions() {
      return regions;
    },
    get t() {
      return now();
    },
  };
}

function box4(b) {
  return { x: round(b.x), y: round(b.y), w: round(b.width), h: round(b.height) };
}
