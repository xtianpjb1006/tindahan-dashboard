// Decrypts data/summary.json in the browser (WebCrypto). Same scheme as src/main/cloud.js encryptSummary:
// AES-256-GCM, key = PBKDF2-SHA256(passphrase, salt, iterations), ciphertext with the GCM tag at the end.
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}

/** key: a CryptoKey from deriveKey (kept for the visit so the phone doesn't redo PBKDF2 every refresh). */
export async function decryptWithKey(env, key) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(env.iv) }, key, b64(env.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Throws when the passphrase is wrong (GCM tag check fails). */
export async function decryptEnvelope(env, passphrase) {
  if (env?.v !== 1 || env.kdf !== 'PBKDF2-SHA256') throw new Error('Unknown file format');
  const key = await deriveKey(passphrase, b64(env.salt), env.iterations);
  return { key, summary: await decryptWithKey(env, key) };
}
