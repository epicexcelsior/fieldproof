import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAddressDecoder } from '@solana/kit';
import { loadBuyerSigner } from '../buyer.js';

async function fixture(t, contents) {
  const directory = await mkdtemp(join(tmpdir(), 'fieldproof-key-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'fixture.json');
  await writeFile(path, contents, { mode: 0o600 });
  return path;
}

test('buyer loads a valid Solana CLI keypair without changing its address', async t => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const publicBytes = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const path = await fixture(t, JSON.stringify([...seed, ...publicBytes]));
  const signer = await loadBuyerSigner(path);
  assert.equal(signer.address, getAddressDecoder().decode(publicBytes));
});

test('buyer key JSON errors do not expose file contents', async t => {
  const path = await fixture(t, 'FAKE_PRIVATE_KEY_SENTINEL');
  await assert.rejects(loadBuyerSigner(path), error => {
    assert.match(error.message, /valid JSON/);
    assert.doesNotMatch(error.message, /FAKE|SENTINEL/);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test('buyer key read errors do not expose local paths', async t => {
  const path = await fixture(t, '[]');
  await rm(path);
  await assert.rejects(loadBuyerSigner(path), error => {
    assert.match(error.message, /cannot be read/);
    assert.ok(!error.message.includes(path));
    assert.equal(error.cause, undefined);
    return true;
  });
});

test('buyer rejects invalid or inconsistent key bytes with a safe error', async t => {
  for (const bytes of [[1, 2, 3], new Array(64).fill(0)]) {
    const path = await fixture(t, JSON.stringify(bytes));
    await assert.rejects(loadBuyerSigner(path), error => {
      assert.match(error.message, /64-byte Solana CLI keypair/);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});
