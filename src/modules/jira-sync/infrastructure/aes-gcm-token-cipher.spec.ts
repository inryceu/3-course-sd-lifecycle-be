import { TokenIntegrityError } from '../domain/errors';
import { AesGcmTokenCipher } from './aes-gcm-token-cipher';

const KEY_A = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const KEY_B = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

const cipher = (key: string) => new AesGcmTokenCipher({ getOrThrow: () => key } as never);

describe('AesGcmTokenCipher', () => {
  it('round-trips a value', () => {
    const c = cipher(KEY_A);
    const token = 'atlassian-access-token-ünïcode-✓';
    expect(c.decrypt(c.encrypt(token))).toBe(token);
  });

  it('round-trips an empty string', () => {
    const c = cipher(KEY_A);
    expect(c.decrypt(c.encrypt(''))).toBe('');
  });

  it('uses a fresh random IV so equal plaintexts give different ciphertexts', () => {
    const c = cipher(KEY_A);
    const first = c.encrypt('same');
    const second = c.encrypt('same');
    expect(first).not.toBe(second);
    expect(first.split('.')[1]).not.toBe(second.split('.')[1]);
  });

  it('never contains the plaintext', () => {
    const c = cipher(KEY_A);
    expect(c.encrypt('super-secret-token')).not.toContain('super-secret-token');
  });

  it('detects a modified ciphertext', () => {
    const c = cipher(KEY_A);
    const [version, iv, tag, data] = c.encrypt('secret').split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 0xff;
    const tampered = [version, iv, tag, flipped.toString('base64url')].join('.');
    expect(() => c.decrypt(tampered)).toThrow(TokenIntegrityError);
  });

  it('detects a modified authentication tag', () => {
    const c = cipher(KEY_A);
    const [version, iv, tag, data] = c.encrypt('secret').split('.');
    const forged = Buffer.from(tag, 'base64url');
    forged[0] ^= 0x01;
    expect(() => c.decrypt([version, iv, forged.toString('base64url'), data].join('.'))).toThrow(
      TokenIntegrityError,
    );
  });

  it('fails with the wrong key', () => {
    const stored = cipher(KEY_A).encrypt('secret');
    expect(() => cipher(KEY_B).decrypt(stored)).toThrow(TokenIntegrityError);
  });

  it.each(['', 'plain', 'v2.a.b.c', 'v1.a.b', 'v1.a.b.c.d'])(
    'rejects malformed stored value "%s"',
    (value) => {
      expect(() => cipher(KEY_A).decrypt(value)).toThrow(TokenIntegrityError);
    },
  );

  it('refuses a key that is not 32 bytes', () => {
    expect(() => cipher('abcd')).toThrow(/32 bytes/);
  });
});
