function extractJson(text) {
  const fencedMatch = text.match(/```(?:json)?\n([\s\S]*?)```/);
  if (fencedMatch) {
    const candidate = fencedMatch[1];
    try {
      return JSON.parse(candidate);
    } catch (err) {
      throw new Error(`Failed to parse JSON in fenced block: ${err.message}`);
    }
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse JSON response: ${err.message}`);
  }
}

function normalizePlan(rawPlan) {
  if (!rawPlan || typeof rawPlan !== 'object') {
    throw new Error('Plan is not an object');
  }

  const summary = typeof rawPlan.summary === 'string' ? rawPlan.summary.trim() : '';
  const nextFocus = typeof rawPlan.next_focus === 'string' ? rawPlan.next_focus.trim() : '';
  const changes = Array.isArray(rawPlan.changes) ? rawPlan.changes : [];

  const normalizedChanges = changes
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const action = entry.action === 'delete' ? 'delete' : 'write';
      const path = typeof entry.path === 'string' ? entry.path.trim() : '';
      const description = typeof entry.description === 'string' ? entry.description.trim() : '';
      const content = typeof entry.content === 'string' ? entry.content : '';
      if (!path) return null;
      if (action === 'write' && !content) return null;
      return { action, path, description, content };
    })
    .filter(Boolean);

  return {
    summary,
    nextFocus,
    changes: normalizedChanges
  };
}

function parsePlan(text) {
  const json = extractJson(text);
  return normalizePlan(json);
}

module.exports = {
  parsePlan
};
