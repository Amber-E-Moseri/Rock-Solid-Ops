// Deno tests for the Web Push core (PWA Phase C.2).
// Run: deno test supabase/functions/_shared/webpush.test.ts
// (Deno is absent in the dev env where this was written; the crypto paths were
//  additionally proven in-browser against a full encrypt→decrypt roundtrip and a
//  VAPID JWT sign+verify — same Web Crypto API as the Deno edge runtime.)

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  b64urlToBytes,
  bytesToB64url,
  createVapidJWT,
  encodePayloadBytes,
  encryptPayload,
  sendWebPush,
  type PushSubscriptionJSON,
  type VapidKeys,
} from "./webpush.ts";

const RSO_VAPID: VapidKeys = {
  publicKey: "BOVlCDUmr1OpRqO8-NjWRm5c38_6XTXunZmhGHr4PNODrLC7qk_6zcDMZ7ywAgV7O-wDpuuyQE-nX67KxFgqmJg",
  privateKey: "OEL0ht9AcYecpe8FtAoVwO52L0PYNXlUflaQ88C-1kc",
  subject: "mailto:ops@example.com",
};

Deno.test("base64url roundtrips arbitrary bytes", () => {
  const bytes = crypto.getRandomValues(new Uint8Array(65));
  assertEquals([...b64urlToBytes(bytesToB64url(bytes))], [...bytes]);
});

Deno.test("VAPID JWT: three parts, ES256 header, verifies under the public key", async () => {
  const jwt = await createVapidJWT("https://fcm.googleapis.com", RSO_VAPID);
  const parts = jwt.split(".");
  assertEquals(parts.length, 3);

  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
  assertEquals(header.alg, "ES256");
  assertEquals(header.typ, "JWT");

  const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  assertEquals(claims.aud, "https://fcm.googleapis.com");
  assertEquals(claims.sub, "mailto:ops@example.com");
  assert(typeof claims.exp === "number" && claims.exp > Math.floor(Date.now() / 1000));

  // A push service verifies the signature with the public key alone.
  const pub = b64urlToBytes(RSO_VAPID.publicKey);
  const verifyKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const sig = b64urlToBytes(parts[2]);
  assertEquals(sig.length, 64); // raw r||s
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    verifyKey,
    sig,
    new TextEncoder().encode(parts[0] + "." + parts[1]),
  );
  assert(ok, "VAPID JWT signature must verify under the public key");
});

// Independent receiver-side decrypt mirroring RFC 8291 aes128gcm, used to prove
// encryptPayload produces a body a real user agent can decrypt.
async function decryptAes128gcm(
  body: Uint8Array,
  uaPrivate: CryptoKey,
  uaPublicRaw: Uint8Array,
  authSecret: Uint8Array,
): Promise<string> {
  const enc = new TextEncoder();
  const concat = (...as: Uint8Array[]) => {
    const out = new Uint8Array(as.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of as) { out.set(a, o); o += a.length; }
    return out;
  };
  const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) => {
    const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
  };
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublicRaw = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const asPub = await crypto.subtle.importKey("raw", asPublicRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asPub }, uaPrivate, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode("WebPush: info"), new Uint8Array([0]), uaPublicRaw, asPublicRaw), 32);
  const cek = await hkdf(salt, ikm, concat(enc.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(enc.encode("Content-Encoding: nonce"), new Uint8Array([0])), 12);
  const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, ct));
  assertEquals(plain[plain.length - 1], 0x02); // last-record delimiter
  return new TextDecoder().decode(plain.slice(0, plain.length - 1));
}

Deno.test("RFC 8291 aes128gcm: encryptPayload produces a decryptable body", async () => {
  const uaKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const uaPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", uaKeyPair.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const sub: PushSubscriptionJSON = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    keys: { p256dh: bytesToB64url(uaPublicRaw), auth: bytesToB64url(authSecret) },
  };

  const message = JSON.stringify({ title: "Rock Solid Ops", body: "Registration ASSIGNED", type: "registration_status" });
  const body = await encryptPayload(sub, encodePayloadBytes(message));

  // aes128gcm header framing: rs=4096, keyid length 65.
  assertEquals(new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0, false), 4096);
  assertEquals(body[20], 65);

  const recovered = await decryptAes128gcm(body, uaKeyPair.privateKey, uaPublicRaw, authSecret);
  assertEquals(recovered, message);
});

// ── C6 timeout tests ─────────────────────────────────────────────────────────
// T26–T29 use Function.prototype.toString() to inspect the loaded function body
// without requiring --allow-read (no filesystem access).

Deno.test("T26: sendWebPush accepts a timeoutMs parameter (default 10 s)", () => {
  assert(
    sendWebPush.toString().includes("timeoutMs = 10_000"),
    "sendWebPush must declare timeoutMs with a 10 s default",
  );
});

Deno.test("T27: sendWebPush constructs an AbortController for the push fetch", () => {
  assert(
    sendWebPush.toString().includes("new AbortController()"),
    "sendWebPush must construct an AbortController",
  );
});

Deno.test("T28: sendWebPush passes signal to the push fetch", () => {
  assert(
    sendWebPush.toString().includes("signal: controller.signal"),
    "fetch in sendWebPush must receive signal: controller.signal",
  );
});

Deno.test("T29: sendWebPush clears the timer in a finally block", () => {
  const src = sendWebPush.toString();
  const fetchIdx = src.indexOf("signal: controller.signal");
  const finallyIdx = src.indexOf("} finally", fetchIdx);
  const clearIdx = src.indexOf("clearTimeout(timer)", fetchIdx);
  assert(finallyIdx > fetchIdx, "finally block must follow the fetch in sendWebPush");
  assert(clearIdx > finallyIdx, "clearTimeout must be inside the finally block");
});
