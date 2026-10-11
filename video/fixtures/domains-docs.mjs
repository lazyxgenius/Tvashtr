/**
 * Scene 1.5's three "Exchange API docs" files: their text (the one source), the tiny real PDFs made
 * from it (video/fixtures/files/domains-exchange-api-*.pdf) and the pieces the server would cut
 * from it (domain_chunking.chunk_text: fixed characters, the Support template's 600 / 100).
 * The exchange is made up (*.example hosts), so no real company's docs are shown.
 *
 *   node video/fixtures/domains-docs.mjs     # rewrite the PDFs from DOCS
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** filename (as the app shows it, story.json domain.files) → [title, paragraphs]. */
export const DOCS = {
  "exchange-api-getting-started.pdf": [
    "Exchange API: Getting started",
    [
      "Base URL: https://api.exchange.example/v1. All requests and responses are JSON.",
      "Sign every private request with your API key and secret: an HMAC-SHA256 of the timestamp, the method, the path and the body, sent in the X-Signature header.",
      "Timestamps are Unix milliseconds in UTC. A request more than 5 seconds old is refused.",
      "Symbols use the BASE-QUOTE form, for example BTC-USD or ETH-USD.",
      "Try your code against the sandbox first: https://sandbox.exchange.example/v1 holds test balances and the same endpoints.",
      "Candles: GET /candles?symbol=BTC-USD&interval=1h returns open, high, low, close and volume for each interval, oldest first.",
      "Order book: GET /orderbook?symbol=BTC-USD&depth=50 returns the best 50 bids and asks.",
    ],
  ],
  "exchange-api-limits.pdf": [
    "Exchange API: Rate limits",
    [
      "Limits are counted per API key over a rolling one-second window.",
      "Order endpoints (POST /orders, DELETE /orders/{id}): 10 requests per second.",
      "Market data endpoints (GET /ticker, GET /candles, GET /orderbook): 20 requests per second.",
      "GET /candles returns at most 1,000 candles per request; page back with the end parameter for older data.",
      "Every response carries the X-RateLimit-Remaining and X-RateLimit-Reset headers, so a client can slow down before it is refused.",
      "Intervals: 1m, 5m, 15m, 1h, 4h and 1d. A request for more than 1,000 candles is cut to the newest 1,000; it is not an error.",
      "WebSocket: up to 5 subscribe messages per second on each connection, and up to 10 connections per API key.",
    ],
  ],
  "exchange-api-errors.pdf": [
    "Exchange API: Errors",
    [
      "Every error has a JSON body with code and message.",
      "429 rate_limited: you went over a rate limit. The response has a Retry-After header with the seconds to wait. Wait that long before you retry; repeated 429s within one minute block the key for 60 seconds.",
      "400 bad_request: a parameter is missing or has the wrong type. The message names it.",
      "401 invalid_signature: the signature or the timestamp is wrong. Check your clock and the string you signed.",
      "404 unknown_symbol: the symbol is not listed. GET /symbols lists every market.",
      "503 unavailable: the exchange is in maintenance. Retry with exponential backoff, starting at one second.",
    ],
  ],
};

export const FILENAMES = Object.keys(DOCS);
export const pdfPath = (name) => path.join(here, "files", `domains-${name}`);

/** The PDF's lines: each paragraph wrapped at 92 characters. */
const lines = (paragraphs) =>
  paragraphs.flatMap((para) => {
    const out = [];
    let line = "";
    for (const w of para.split(" ")) {
      if ((line + w).length > 92) {
        out.push(line.trim());
        line = "";
      }
      line += `${w} `;
    }
    if (line.trim()) out.push(line.trim());
    return out;
  });

/** The text the server extracts (pypdf: one line per PDF line, as checked against the files). */
export const textOf = (name) => [DOCS[name][0], ...lines(DOCS[name][1])].join("\n");

/** domain_chunking.chunk_text, as the server cuts a file into pieces. */
export function pieces(name, size = 600, overlap = 100) {
  const t = textOf(name).trim();
  const out = [];
  for (let start = 0; start < t.length; start += size - overlap) {
    out.push(t.slice(start, start + size));
    if (start + size >= t.length) break;
  }
  return out;
}

/** The piece (1-based) that holds `phrase`, and the passage the Ask tab shows for it (≤ 400 chars). */
export function passage(name, phrase) {
  const list = pieces(name);
  const i = list.findIndex((p) => p.includes(phrase));
  if (i < 0) throw new Error(`"${phrase}" is in no piece of ${name}`);
  return { piece_number: i + 1, pieces_in_file: list.length, excerpt: list[i].slice(0, 400) };
}

/** A one-page text PDF (Helvetica), valid enough for any reader. */
function pdf(title, paragraphs) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  let stream = `BT /F1 18 Tf 56 750 Td (${esc(title)}) Tj ET\n`;
  let y = 712;
  for (const para of paragraphs) {
    for (const line of lines([para])) {
      stream += `BT /F1 10.5 Tf 56 ${y} Td (${esc(line)}) Tj ET\n`;
      y -= 15;
    }
    y -= 9;
  }
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Title (${esc(title)}) >>`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => {
    const at = Buffer.byteLength(out);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fs.mkdirSync(path.join(here, "files"), { recursive: true });
  for (const [name, [title, paras]] of Object.entries(DOCS)) {
    fs.writeFileSync(pdfPath(name), pdf(title, paras));
    console.log(pdfPath(name), `${pieces(name).length} pieces`);
  }
}
