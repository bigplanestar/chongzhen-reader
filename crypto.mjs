const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

export function toBase64(bytes) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}

export function fromBase64(value) {
  if (typeof value !== 'string') throw new Error('书稿数据格式不正确。');
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}

export async function deriveKey(password, config) {
  if (config.kdf !== 'PBKDF2-SHA256' || config.iterations !== 600000) throw new Error('书房加密格式不受支持。');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(config.salt),
    iterations: config.iterations}, material, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
}

export async function seal(key, value, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv,
    additionalData: encoder.encode(context)}, key, encoder.encode(JSON.stringify(value)));
  return {format: 'aes-gcm-v1', iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext))};
}

export async function unseal(key, box, context) {
  if (box?.format !== 'aes-gcm-v1' || fromBase64(box.iv).length !== 12) throw new Error('书稿数据格式不正确。');
  const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: fromBase64(box.iv),
    additionalData: encoder.encode(context)}, key, fromBase64(box.ciphertext));
  return JSON.parse(decoder.decode(plain));
}
