import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, convertBits } from '../bech32.js';
import { lnurlEndpoint, isLightningAddress, invoiceFromLnurl } from '../lnurl.js';

test('lightning address and lnurl parsing', () => {
  assert.equal(lnurlEndpoint('Sam@Wallet.example.com'), 'https://wallet.example.com/.well-known/lnurlp/Sam');
  assert.equal(isLightningAddress('no-at-sign.com'), false);
  assert.equal(isLightningAddress('a@b'), false);
  const url = 'https://pay.example.com/lnurlp/abc';
  const l = encode('lnurl', convertBits([...Buffer.from(url)], 8, 5, true));
  assert.equal(lnurlEndpoint(l), url);
  assert.equal(lnurlEndpoint(l.slice(0, -1) + 'q'), null, 'bad checksum rejected');
});

test('never connects to internal hosts', async () => {
  await assert.rejects(invoiceFromLnurl('x@localhost.localdomain', 1000), /Could not reach|valid/);
  await assert.rejects(invoiceFromLnurl(encode('lnurl', convertBits([...Buffer.from('http://127.0.0.1/x')], 8, 5, true)), 1000), /Could not reach/);
  await assert.rejects(invoiceFromLnurl(encode('lnurl', convertBits([...Buffer.from('https://127.0.0.1/x')], 8, 5, true)), 1000), /Could not reach/);
});
