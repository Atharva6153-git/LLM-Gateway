const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { hashKey } = require('../src/middleware/auth');
const { hashKey: hashAdminKey } = require('../src/middleware/adminAuth');

test('hashKey is deterministic and produces a sha256 hex digest', () => {
  const a = hashKey('test123');
  const b = hashKey('test123');
  const expected = crypto.createHash('sha256').update('test123').digest('hex');
  assert.strictEqual(a, b);
  assert.strictEqual(a, expected);
  assert.strictEqual(a.length, 64);
});

test('hashKey differs for different keys', () => {
  assert.notStrictEqual(hashKey('test123'), hashKey('other'));
});

test('adminAuth and auth hash keys consistently', () => {
  assert.strictEqual(hashAdminKey('admin'), hashKey('admin'));
});