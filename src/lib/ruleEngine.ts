import type {
  AutomationRule,
  ConditionField,
  EmailMessage,
  RuleCondition,
} from "../types";

export interface ConditionResult {
  conditionId: string;
  matched: boolean;
  actualValue: string;
}

export interface RuleEvaluation {
  ruleId: string;
  matched: boolean;
  conditionResults: ConditionResult[];
  scoreDelta: number;
}

const getSenderDomain = (sender: string) =>
  sender.toLowerCase().split("@").at(1) ?? "";

const getFieldValue = (
  message: EmailMessage,
  field: ConditionField,
): string => {
  switch (field) {
    case "sender":
      return message.sender;
    case "sender_domain":
      return getSenderDomain(message.sender);
    case "recipient":
      return message.recipient;
    case "subject":
      return message.subject;
    case "body":
      return message.body;
    case "attachment_name":
      return message.attachmentNames.join(" ");
    case "attachment_type":
      return message.attachmentNames
        .map((name) => name.split(".").at(-1) ?? "")
        .join(" ");
    case "source":
      return message.sourceId;
    case "sentiment":
      return message.score >= 70 ? "positive" : message.score < 35 ? "negative" : "neutral";
    case "url":
      return message.body.match(/https?:\/\/\S+/i)?.[0] ?? "";
    case "size":
      return String(message.body.length);
    default:
      return "";
  }
};

const normalize = (value: string) => value.trim().toLocaleLowerCase("pl");

export const evaluateCondition = (
  message: EmailMessage,
  condition: RuleCondition,
): ConditionResult => {
  const actualValue = getFieldValue(message, condition.field);
  const actual = normalize(actualValue);
  const expected = normalize(condition.value);
  let matched = false;

  switch (condition.operator) {
    case "contains":
      matched = actual.includes(expected);
      break;
    case "not_contains":
      matched = !actual.includes(expected);
      break;
    case "equals":
      matched = actual === expected;
      break;
    case "not_equals":
      matched = actual !== expected;
      break;
    case "starts_with":
      matched = actual.startsWith(expected);
      break;
    case "ends_with":
      matched = actual.endsWith(expected);
      break;
    case "matches":
      try {
        matched = new RegExp(condition.value, "iu").test(actualValue);
      } catch {
        matched = false;
      }
      break;
    case "greater_than":
      matched = Number(actualValue) > Number(condition.value);
      break;
    case "less_than":
      matched = Number(actualValue) < Number(condition.value);
      break;
    case "exists":
      matched = actualValue.trim().length > 0;
      break;
  }

  return { conditionId: condition.id, matched, actualValue };
};

export const evaluateRule = (
  message: EmailMessage,
  rule: AutomationRule,
): RuleEvaluation => {
  const conditionResults = rule.conditions.map((condition) =>
    evaluateCondition(message, condition),
  );
  const matched =
    rule.active &&
    conditionResults.length > 0 &&
    (rule.matchMode === "all"
      ? conditionResults.every((result) => result.matched)
      : conditionResults.some((result) => result.matched));

  const scoreDelta = matched
    ? rule.actions
        .filter((action) => action.type === "add_score")
        .reduce((sum, action) => sum + Number(action.value || 0), 0)
    : 0;

  return {
    ruleId: rule.id,
    matched,
    conditionResults,
    scoreDelta,
  };
};

export const evaluateRules = (
  message: EmailMessage,
  rules: AutomationRule[],
): RuleEvaluation[] =>
  [...rules]
    .sort((left, right) => right.priority - left.priority)
    .map((rule) => evaluateRule(message, rule));

