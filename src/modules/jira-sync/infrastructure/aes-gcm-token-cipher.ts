import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenCipher } from '../application/token-cipher.port';
import { TokenIntegrityError } from '../domain/errors';

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * AES-256-GCM with a random 96-bit IV per value. Stored form: `v1.<iv>.<tag>.<ciphertext>`
 * (base64url). The GCM tag authenticates the ciphertext, so tampering or a wrong key is detected.
 */
@Injectable()
export class AesGcmTokenCipher implements TokenCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('crypto.tokenEncryptionKey'), 'hex');
    if (this.key.length !== KEY_BYTES) {
      throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, ciphertext].map((part) => this.encode(part)).join('.');
  }

  decrypt(stored: string): string {
    const [version, iv, tag, ciphertext, ...rest] = stored.split('.');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length > 0) {
      throw new TokenIntegrityError();
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new TokenIntegrityError();
    }
  }

  private encode(part: Buffer | string): string {
    return typeof part === 'string' ? part : part.toString('base64url');
  }
}
