// Licence keys - exactly the same format as the desktop app (sim/licensing.py), so a key made on the
// website works in the installer and the app, and a key made in the app is accepted here.
//
//   payload (38 bytes, big-endian): ver(1) kid(8) product(4) issued(u32) not_before(u32) not_after(u32)
//                                    duration(u32) flags(1) machine(8)   + Ed25519 signature (64 bytes)
//   text: Crockford base-32 (0-9 A-Z without I L O U), groups of 6 joined with "-"
import crypto from "node:crypto";
import { env, HttpError } from "./http.mjs";

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI = Buffer.from("302a300506032b6570032100", "hex");
export const PAYLOAD_SIZE = 38;
export const VERSION = 1;
export const FLAG_BOUND = 1;

export function b32(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function unb32(text) {
  const t = String(text || "").toUpperCase().replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");
  let bits = 0, value = 0; const out = [];
  for (const ch of t) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error("bad character");
    value = ((value << 5) | v) & 0xffffff; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const pretty = (raw, group = 6) => {
  const s = String(raw).replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return s.match(new RegExp(`.{1,${group}}`, "g")).join("-");
};
export const normMachine = (code) => String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "");

export function seed() {
  const hex = env("LICENCE_SIGNING_KEY").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex))
    throw new HttpError(500, "LICENCE_SIGNING_KEY isn't set on the website (copy it from the app's LICENSES page).");
  return Buffer.from(hex, "hex");
}

const privKey = (s) => crypto.createPrivateKey({ key: Buffer.concat([PKCS8, s]), format: "der", type: "pkcs8" });
const pubKeyObj = (p) => crypto.createPublicKey({ key: Buffer.concat([SPKI, p]), format: "der", type: "spki" });

export function publicKey(s = seed()) {
  return crypto.createPublicKey(privKey(s)).export({ format: "der", type: "spki" }).subarray(-32);
}

export const productOf = (pub) => crypto.createHash("sha256").update(Buffer.concat([Buffer.from("product:"), pub]))
  .digest().subarray(0, 4);

export function makeKey({ notBefore = 0, notAfter = 0, duration = 0, machine = null } = {}, s = seed()) {
  const pub = publicKey(s);
  const kid = crypto.randomBytes(8);
  const p = Buffer.alloc(PAYLOAD_SIZE);
  let o = 0;
  p.writeUInt8(VERSION, o); o += 1;
  kid.copy(p, o); o += 8;
  productOf(pub).copy(p, o); o += 4;
  p.writeUInt32BE(Math.floor(Date.now() / 1000), o); o += 4;
  p.writeUInt32BE(Math.max(0, Math.floor(notBefore)), o); o += 4;
  p.writeUInt32BE(Math.max(0, Math.floor(notAfter)), o); o += 4;
  p.writeUInt32BE(Math.max(0, Math.floor(duration)), o); o += 4;
  p.writeUInt8(machine ? FLAG_BOUND : 0, o); o += 1;
  (machine || Buffer.alloc(8)).copy(p, o);
  const sig = crypto.sign(null, p, privKey(s));
  const key = pretty(b32(Buffer.concat([p, sig])));
  return { key, info: readPayload(p) };
}

function readPayload(p) {
  const flags = p.readUInt8(29);
  return {
    version: p.readUInt8(0), kid: p.subarray(1, 9).toString("hex"), product: p.subarray(9, 13).toString("hex"),
    issued: p.readUInt32BE(13), notBefore: p.readUInt32BE(17), notAfter: p.readUInt32BE(21),
    duration: p.readUInt32BE(25), bound: flags & FLAG_BOUND ? p.subarray(30, 38) : null,
  };
}

// -> { info } or { error: "invalid" | "incomplete" }
export function readKey(key, pub = publicKey()) {
  let raw;
  try { raw = unb32(key); } catch { return { error: "invalid" }; }
  if (raw.length !== PAYLOAD_SIZE + 64) return { error: "incomplete" };
  const p = raw.subarray(0, PAYLOAD_SIZE), sig = raw.subarray(PAYLOAD_SIZE);
  const info = readPayload(p);
  let ok = false;
  try { ok = crypto.verify(null, p, pubKeyObj(pub), sig); } catch { ok = false; }
  if (info.version !== VERSION || !ok) return { error: "invalid" };
  if (info.product !== productOf(pub).toString("hex")) return { error: "invalid" };
  return { info };
}

export function humanDuration(s) {
  const units = [["year", 365 * 86400], ["month", 30 * 86400], ["week", 7 * 86400], ["day", 86400],
                 ["hour", 3600], ["minute", 60]];
  for (const [unit, n] of units) {
    if ((s >= n && s % n === 0) || (unit === "minute" && s >= 60)) {
      const k = Math.round(s / n);
      return `${k} ${unit}${k !== 1 ? "s" : ""}`;
    }
  }
  return `${s} seconds`;
}

export function describe(info) {
  if (info.duration) return `${humanDuration(info.duration)} from first use`;
  if (info.notAfter) {
    const d = new Date(info.notAfter * 1000);
    return "until " + d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short",
                                                  year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return "lifetime";
}
