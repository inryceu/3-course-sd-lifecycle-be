import { createHash } from 'crypto';
import { codeChallenge, generateCodeVerifier, generateState } from './pkce';

describe('pkce', () => {
  it('generates unique 64-character hex states', () => {
    const states = new Set(Array.from({ length: 50 }, generateState));
    expect(states.size).toBe(50);
    for (const state of states) {
      expect(state).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('generates verifiers within the RFC 7636 length and alphabet', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('derives the S256 challenge', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    // Example from RFC 7636 appendix B
    expect(codeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(codeChallenge(verifier)).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });
});
