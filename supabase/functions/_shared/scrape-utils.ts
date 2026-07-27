function escapedPattern(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
}

function robotsPatternMatches(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const endAnchored = pattern.endsWith("$");
  const rawPattern = endAnchored ? pattern.slice(0, -1) : pattern;
  const expression = `^${escapedPattern(rawPattern)}${endAnchored ? "$" : ""}`;
  return new RegExp(expression).test(path);
}

export function robotsAllows(
  raw: string,
  userAgent: string,
  path: string,
): boolean {
  const agentToken = userAgent.split(/[\s/(]/, 1)[0]?.toLowerCase() ?? "";
  let agents: string[] = [];
  let rulesStarted = false;
  const matchingRules: Array<{ allow: boolean; pattern: string }> = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0]?.trim() ?? "";
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (rulesStarted) {
        agents = [];
        rulesStarted = false;
      }
      agents.push(value.toLowerCase());
      continue;
    }
    if (field !== "allow" && field !== "disallow") continue;
    rulesStarted = true;
    const applies = agents.some(
      (agent) => agent === "*" || agentToken.includes(agent),
    );
    if (applies && value) {
      matchingRules.push({ allow: field === "allow", pattern: value });
    }
  }

  const matched = matchingRules
    .filter((rule) => robotsPatternMatches(rule.pattern, path))
    .sort(
      (left, right) =>
        right.pattern.length - left.pattern.length ||
        Number(right.allow) - Number(left.allow),
    )[0];
  return matched?.allow ?? true;
}

function contentSignature(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.slice(0, 60_000) ?? [];
  if (tokens.length < 3) return new Set(tokens);
  const shingles = new Set<string>();
  for (let index = 0; index <= tokens.length - 3; index += 1) {
    shingles.add(tokens.slice(index, index + 3).join("\u001f"));
  }
  return shingles;
}

export function changedPercentage(previous: string, current: string): number {
  if (previous === current) return 0;
  if (!previous || !current) return 100;
  const previousSignature = contentSignature(previous);
  const currentSignature = contentSignature(current);
  const union = new Set([...previousSignature, ...currentSignature]);
  if (union.size === 0) return previous === current ? 0 : 100;
  let intersection = 0;
  for (const item of previousSignature) {
    if (currentSignature.has(item)) intersection += 1;
  }
  return Number(((1 - intersection / union.size) * 100).toFixed(2));
}
