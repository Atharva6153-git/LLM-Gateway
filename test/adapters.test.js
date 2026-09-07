const test = require('node:test');
const assert = require('node:assert');
const { endpointFor, buildBody, parseResponse } = require('../src/lib/adapters');

const flat = { request_shape: 'flat', base_url: 'http://mock:4000' };
const openai = { request_shape: 'openai', base_url: 'https://api.groq.com/openai/v1', model: 'qwen/qwen3.8-27b' };

test('flat provider hits /chat with {prompt, max_tokens}', () => {
  assert.strictEqual(endpointFor(flat), 'http://mock:4000/chat');
  assert.deepStrictEqual(buildBody(flat, { prompt: 'hi', max_tokens: 10 }), { prompt: 'hi', max_tokens: 10 });
  assert.deepStrictEqual(buildBody(flat, { prompt: 'hi' }), { prompt: 'hi' });
});

test('openai provider hits /chat/completions with {model, messages}', () => {
  assert.strictEqual(endpointFor(openai), 'https://api.groq.com/openai/v1/chat/completions');
  assert.deepStrictEqual(buildBody(openai, { prompt: 'hi', max_tokens: 10 }), {
    model: 'qwen/qwen3.8-27b',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 10,
  });
  assert.deepStrictEqual(buildBody(openai, { prompt: 'hi' }), {
    model: 'qwen/qwen3.8-27b',
    messages: [{ role: 'user', content: 'hi' }],
  });
});

test('flat parseResponse normalizes {text, model}', () => {
  assert.deepStrictEqual(parseResponse(flat, { text: 'hello', model: 'm1' }), { text: 'hello', model: 'm1' });
  assert.deepStrictEqual(parseResponse(flat, { reply: 'hello' }), { text: 'hello', model: 'unknown' });
  assert.deepStrictEqual(parseResponse(flat, {}), { text: '', model: 'unknown' });
});

test('openai parseResponse reads choices[0].message.content', () => {
  const data = { model: 'qwen/qwen3.8-27b', choices: [{ message: { content: 'hello there' } }] };
  assert.deepStrictEqual(parseResponse(openai, data), { text: 'hello there', model: 'qwen/qwen3.8-27b' });
});

test('openai parseResponse falls back to reasoning fields (gpt-oss style)', () => {
  const data = { model: 'm', choices: [{ message: { content: '', reasoning_content: 'step 1' } }] };
  assert.strictEqual(parseResponse(openai, data).text, 'step 1');
});

test('openai parseResponse degrades to empty text on malformed body', () => {
  assert.deepStrictEqual(parseResponse(openai, {}), { text: '', model: 'qwen/qwen3.8-27b' });
});