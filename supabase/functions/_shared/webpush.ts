/*
 * Web Push sender core (PWA Phase C.2) — built from the RFCs with Web Crypto,
 * NOT ported from the Nexus reference (which POSTed plaintext with no VAPID
 * signing and no payload encryption, and would be rejected by every browser
 * push service).
 *
 * Implements:
 *   - VAPID (RFC 8292): ES256 JWT + `Authorization: vapid t=..., k=...` header.
 *   - Message encryption (RFC 8291): aes128gcm content encoding — ephemeral
 *     ECDH(P-256) with the subscription's p256dh, HKDF key/nonce derivation,
 *     AES-128-GCM, and the aes128gcm header framing.
 *
 * Web Crypto (SubtleCrypto) is fully available in the Supabase edge (Deno)
 * runtime, so there is no npm/Node-crypto dependency to break at deploy time.
 */

// ── base64url helpers ─────────────────────────────────────────────────────────
export function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

// ── VAPID (RFC 8292) ──────────────────────────────────────────────────────────

export interface VapidKeys {
  publicKey: string; // base64url uncompressed P-256 point (0x04 || x || y)
  privateKey: string; // base64url raw scalar d (32 bytes)
  subject: string; // mailto: or https: contact URI
}

// Build a P-256 ECDSA private CryptoKey from the raw `d` scalar plus the x/y
// taken from the (uncompressed) VAPID public key.
async function importVapidSigningKey(keys: VapidKeys): Promise<CryptoKey> {
  const pub = b64urlToBytes(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error("Invalid VAPID public key: expected 65-byte uncompressed P-256 point");
  }
  const x = bytesToB64url(pub.slice(1, 33));
  const y = bytesToB64url(pub.slice(33, 65));
  const d = keys.privateKey; // already base64url
  return await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, d, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

// Signed VAPID JWT for a given push endpoint audience (scheme + host).
export async function createVapidJWT(
  audience: string,
  keys: VapidKeys,
  expSeconds = 12 * 60 * 60,
): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + expSeconds,
    sub: keys.subject,
  };
  const signingInput = bytesToB64url(utf8(JSON.stringify(header))) + "." +
    bytesToB64url(utf8(JSON.stringify(claims)));

  const signingKey = await importVapidSigningKey(keys);
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signingKey,
      utf8(signingInput),
    ),
  );
  // Web Crypto returns raw r||s (64 bytes) — exactly what JOSE ES256 expects.
  return signingInput + "." + bytesToB64url(sig);
}

// The `Authorization: vapid ...` header value for a push request.
export async function vapidAuthHeader(audience: string, keys: VapidKeys): Promise<string> {
  const jwt = await createVapidJWT(audience, keys);
  return `vapid t=${jwt}, k=${keys.publicKey}`;
}

// ── HKDF (RFC 5869 via Web Crypto) ────────────────────────────────────────────
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ── Message encryption (RFC 8291, aes128gcm) ──────────────────────────────────

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// Optional deterministic inputs — used only by tests to reproduce the RFC 8291
// Appendix A vector. Production always uses a fresh random salt + ephemeral key.
export interface EncryptOverrides {
  salt?: Uint8Array; // 16 bytes
  asPrivateJwkD?: string; // base64url scalar d of the ephemeral AS key
  asPublicRaw?: Uint8Array; // 65-byte uncompressed AS public point
}

// Returns the aes128gcm-encoded body: header(salt|rs|idlen|as_public) || ciphertext.
export async function encryptPayload(
  sub: PushSubscriptionJSON,
  payload: Uint8Array,
  overrides?: EncryptOverrides,
): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(sub.keys.p256dh); // 65 bytes, uncompressed
  const authSecret = b64urlToBytes(sub.keys.auth); // 16 bytes

  // Ephemeral application-server ECDH keypair (or an injected one for tests).
  let asPrivateKey: CryptoKey;
  let asPublicRaw: Uint8Array;
  if (overrides?.asPrivateJwkD && overrides?.asPublicRaw) {
    asPublicRaw = overrides.asPublicRaw;
    asPrivateKey = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        d: overrides.asPrivateJwkD,
        x: bytesToB64url(asPublicRaw.slice(1, 33)),
        y: bytesToB64url(asPublicRaw.slice(33, 65)),
        ext: true,
      },
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
  } else {
    const asKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    asPrivateKey = asKeyPair.privateKey;
    asPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", asKeyPair.publicKey)); // 65 bytes
  }

  // ECDH shared secret with the user agent's public key.
  const uaPublicKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublicKey }, asPrivateKey, 256),
  );

  // IKM = HKDF(salt=auth_secret, ikm=ecdh, info="WebPush: info"||0||ua||as, L=32)
  const keyInfo = concat(utf8("WebPush: info"), new Uint8Array([0]), uaPublic, asPublicRaw);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // Random 16-byte record salt (goes in the header); injectable for tests.
  const salt = overrides?.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const cek = await hkdf(salt, ikm, concat(utf8("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(utf8("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  // Single record: plaintext || 0x02 delimiter (last record), no extra padding.
  const record = concat(payload, new Uint8Array([0x02]));

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, record),
  );

  // aes128gcm header: salt(16) || rs(4 big-endian) || idlen(1) || keyid(as_public 65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  const header = concat(salt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw);

  return concat(header, ciphertext);
}

// ── Send ──────────────────────────────────────────────────────────────────────

export interface SendResult {
  ok: boolean;
  status: number;
  /** true when the subscription is gone (404/410) and should be cleared. */
  expired: boolean;
  body?: string;
}

// Encrypt + POST one push message to one subscription.
export async function sendWebPush(
  sub: PushSubscriptionJSON,
  payload: unknown,
  keys: VapidKeys,
  ttlSeconds = 2419200, // 28 days, the common max
): Promise<SendResult> {
  const bodyBytes = encodePayloadBytes(payload);
  const encrypted = await encryptPayload(sub, bodyBytes);

  const url = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const auth = await vapidAuthHeader(audience, keys);

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttlSeconds),
      Urgency: "normal",
    },
    body: encrypted,
  });

  const expired = res.status === 404 || res.status === 410;
  let text: string | undefined;
  if (!res.ok) text = await res.text().catch(() => undefined);
  return { ok: res.ok, status: res.status, expired, body: text };
}

// Notification payloads are small JSON objects; encode once as UTF-8 bytes.
export function encodePayloadBytes(payload: unknown): Uint8Array {
  const json = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  return utf8(json);
}

// Read VAPID config from edge-function secrets. Throws if incomplete so a
// misconfigured deploy fails loudly instead of silently sending nothing.
export function vapidKeysFromEnv(): VapidKeys {
  const publicKey = String(Deno.env.get("VAPID_PUBLIC_KEY") || "").trim();
  const privateKey = String(Deno.env.get("VAPID_PRIVATE_KEY") || "").trim();
  const subject = String(Deno.env.get("VAPID_SUBJECT") || "").trim();
  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      "Missing VAPID config: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT as edge secrets",
    );
  }
  return { publicKey, privateKey, subject };
}
