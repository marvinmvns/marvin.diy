const { endpoint, model, temperature, maxTokens } = require('./config');

async function requestCompletion(messages, { responseFormat = 'json_object' } = {}) {
  const payload = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages,
    response_format: { type: responseFormat }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Model request failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();

  if (!data.choices || !data.choices.length) {
    throw new Error('Model response missing choices');
  }

  const [{ message }] = data.choices;
  if (!message || typeof message.content !== 'string') {
    throw new Error('Model response missing content');
  }

  return message.content;
}

module.exports = {
  requestCompletion
};
