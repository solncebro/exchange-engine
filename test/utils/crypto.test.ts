import { hmacSha256 } from '../../src/utils/crypto';

describe('hmacSha256', () => {
  it('produces correct hex digest for known input', () => {
    // echo -n "hello" | openssl dgst -sha256 -hmac "secret"
    const result = hmacSha256('hello', 'secret');

    expect(result).toBe('88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b');
  });

  it('produces different result for different secret', () => {
    const result1 = hmacSha256('hello', 'secret1');
    const result2 = hmacSha256('hello', 'secret2');

    expect(result1).not.toBe(result2);
  });

  it('handles empty payload', () => {
    const result = hmacSha256('', 'secret');

    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});
