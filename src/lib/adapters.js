function endpointFor(provider) {
  return provider.request_shape === 'openai'
    ? `${provider.base_url}/chat/completions`
    : `${provider.base_url}/chat`;
}

function buildBody(provider, payload) {
  const { prompt, max_tokens } = payload;
  if (provider.request_shape === 'openai') {
    return {
      model: provider.model,
      messages: [{ role: 'user', content: prompt }],
      ...(max_tokens ? { max_tokens } : {}),
    };
  }
  return { prompt, ...(max_tokens ? { max_tokens } : {}) };
}


function parseResponse(provider, data) {
  if (provider.request_shape === 'openai') {
    const choice = data && data.choices && data.choices[0];
    return {
      text: (choice && (choice.message && (choice.message.content || choice.message.reasoning_content || choice.message.reasoning) || choice.text)) || '',
      model: data.model || provider.model || 'unknown',
    };
  }
  return {
    text: (data && (data.text || data.reply)) || '',
    model: (data && data.model) || 'unknown',
  };
}

module.exports = { endpointFor, buildBody, parseResponse };