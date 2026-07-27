import { describe, expect, it } from "vitest";
import { messages, rules } from "../data/demo";
import { evaluateCondition, evaluateRule } from "./ruleEngine";

describe("ruleEngine", () => {
  it("matches a simple subject condition case-insensitively", () => {
    const result = evaluateCondition(messages[0], {
      id: "subject",
      field: "subject",
      operator: "contains",
      value: "REKLAMACJA",
    });

    expect(result.matched).toBe(true);
  });

  it("handles invalid regular expressions without throwing", () => {
    const result = evaluateCondition(messages[0], {
      id: "regexp",
      field: "subject",
      operator: "matches",
      value: "[",
    });

    expect(result.matched).toBe(false);
  });

  it("calculates rule score only after all conditions match", () => {
    const evaluation = evaluateRule(messages[0], rules[0]);

    expect(evaluation.matched).toBe(true);
    expect(evaluation.scoreDelta).toBe(35);
  });
});

