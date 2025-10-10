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
  if (!message || message.content == null) {
    throw new Error('Model response missing content');
  }

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    const text = message.content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object') {
          if (typeof part.text === 'string') {
            return part.text;
          }
          if (Array.isArray(part.text)) {
            return part.text.join('');
          }
          if (typeof part.content === 'string') {
            return part.content;
          }
        }
        return '';
      })
      .join('')
      .trim();

    if (text) {
      return text;
    }
  }

  throw new Error('Model response missing textual content');
}

module.exports = {
  requestCompletion
};
