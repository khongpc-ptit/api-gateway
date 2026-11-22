import { describe, expect, it } from 'vitest';
import { PublicKeyStore } from '../../src/config/public-keys.js';
import { TEST_KEY_PAIR_1, TEST_KEY_PAIR_2 } from '../helpers/token-helper.js';

describe('PublicKeyStore (Multi-kid RS256 Key Management)', () => {
  it('loads valid key pair from JSON string', () => {
    const jsonConfig = JSON.stringify({
      'kid-1': TEST_KEY_PAIR_1.publicKeyPem,
    });

    const store = new PublicKeyStore(jsonConfig);
    expect(store.hasKey('kid-1')).toBe(true);
    expect(store.getKey('kid-1')).toBe(TEST_KEY_PAIR_1.publicKeyPem.trim());
    expect(store.getAvailableKids()).toEqual(['kid-1']);
  });

  it('supports multiple keys for rotation overlap', () => {
    const jsonConfig = JSON.stringify({
      'kid-1': TEST_KEY_PAIR_1.publicKeyPem,
      'kid-2': TEST_KEY_PAIR_2.publicKeyPem,
    });

    const store = new PublicKeyStore(jsonConfig);
    expect(store.hasKey('kid-1')).toBe(true);
    expect(store.hasKey('kid-2')).toBe(true);
    expect(store.hasKey('kid-3')).toBe(false);
    expect(store.getAvailableKids()).toEqual(['kid-1', 'kid-2']);
  });

  it('allows dynamic addition of new key without restart', () => {
    const store = new PublicKeyStore();
    expect(store.getAvailableKids()).toHaveLength(0);

    store.addKey('kid-1', TEST_KEY_PAIR_1.publicKeyPem);
    expect(store.hasKey('kid-1')).toBe(true);

    store.addKey('kid-2', TEST_KEY_PAIR_2.publicKeyPem);
    expect(store.hasKey('kid-2')).toBe(true);
  });

  it('throws error when JSON format is invalid', () => {
    expect(() => new PublicKeyStore('not-json')).toThrow(/Failed to parse JWT_PUBLIC_KEYS_JSON/);
  });

  it('throws error when public key PEM is corrupted', () => {
    const invalidJson = JSON.stringify({
      'kid-corrupted': '-----BEGIN PUBLIC KEY-----\nNOT_A_VALID_KEY\n-----END PUBLIC KEY-----',
    });
    expect(() => new PublicKeyStore(invalidJson)).toThrow(/Invalid RSA Public Key for kid/);
  });
});
