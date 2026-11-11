// AES-256-GCM helpers for at-rest token encryption.
// Uses node's built-in crypto. The key is read from GHL_TOKEN_ENC_KEY
// (hex string, 32 bytes / 64 hex chars).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function getKey(): Buffer {
	const hex = process.env.GHL_TOKEN_ENC_KEY ?? '';
	if (!hex) throw new Error('GHL_TOKEN_ENC_KEY is not set');
	const buf = Buffer.from(hex, 'hex');
	if (buf.length !== 32) {
		throw new Error('GHL_TOKEN_ENC_KEY must be 32 bytes (64 hex chars); got ' + buf.length);
	}
	return buf;
}

/**
 * Encrypt a plaintext token. Returns a string in `v1:iv:tag:ciphertext` form,
 * all hex-encoded. Versioned so we can rotate the algorithm later.
 */
export function encryptToken(plaintext: string): string {
	const key = getKey();
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
	const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return ['v1', iv.toString('hex'), tag.toString('hex'), ct.toString('hex')].join(':');
}

export function decryptToken(payload: string): string {
	if (!payload) return '';
	const parts = payload.split(':');
	if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Unknown token encryption payload');
	const [, ivHex, tagHex, ctHex] = parts;
	const key = getKey();
	const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'), { authTagLength: 16 });
	decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
	const pt = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
	return pt.toString('utf8');
}
