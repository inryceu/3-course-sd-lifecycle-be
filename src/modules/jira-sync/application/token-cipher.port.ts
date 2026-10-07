/** Port for encrypting secrets at rest (NFR-SEC-2). */
export const TOKEN_CIPHER = Symbol('TOKEN_CIPHER');

export interface TokenCipher {
  /** Returns an opaque string safe to store; a fresh random IV is used for every call. */
  encrypt(plaintext: string): string;
  /** Throws `TokenIntegrityError` when the value was tampered with or the key is wrong. */
  decrypt(ciphertext: string): string;
}
