import { useEffect, useMemo, useState } from "react";
import { useAppState } from "./AppState";
import { api } from "../services/api";
import { demoMode } from "../services/supabase";

export interface OperationalReport {
  range: { days: number; since: string };
  messages: {
    total: number;
    new: number;
    classified: number;
    review: number;
    automated: number;
    failed: number;
    incoming: number;
    outgoing: number;
  };
  outbound: {
    campaigns: number;
    recipients: number;
    delivered: number;
    failed: number;
  };
  automations: {
    runs: number;
    completed: number;
    failed: number;
    queued: number;
    success_rate: number;
  };
  daily: Array<{
    day: string;
    incoming: number;
    processed: number;
    automated: number;
    review: number;
    failed: number;
  }>;
  categories: Array<{
    id: string;
    name: string;
    color: string;
    count: number;
  }>;
  sources: Array<{
    id: string;
    name: string;
    type: string;
    processed: number;
    review: number;
    errors: number;
  }>;
  rules: Array<{
    id: string;
    name: string;
    matches: number;
    evaluations: number;
    score_delta: number;
  }>;
}

const emptyReport = (days: number): OperationalReport => ({
  range: {
    days,
    since: new Date(Date.now() - days * 86_400_000).toISOString(),
  },
  messages: {
    total: 0,
    new: 0,
    classified: 0,
    review: 0,
    automated: 0,
    failed: 0,
    incoming: 0,
    outgoing: 0,
  },
  outbound: {
    campaigns: 0,
    recipients: 0,
    delivered: 0,
    failed: 0,
  },
  automations: {
    runs: 0,
    completed: 0,
    failed: 0,
    queued: 0,
    success_rate: 0,
  },
  daily: [],
  categories: [],
  sources: [],
  rules: [],
});

export function useOperationalReport(days: number) {
  const {
    activeOrganizationId,
    messages,
    categories,
    sources,
    automations,
    campaigns,
    rules,
    addToast,
  } = useAppState();
  const cacheKey = `${activeOrganizationId}:${days}`;
  const [remote, setRemote] = useState<{
    key: string;
    report: OperationalReport;
  } | null>(null);

  const fallback = useMemo(() => {
    const report = emptyReport(days);
    const since = Date.parse(report.range.since);
    const periodMessages = messages.filter(
      (message) => Date.parse(message.receivedAt) >= since,
    );
    report.messages = {
      total: periodMessages.length,
      new: periodMessages.filter((message) => message.status === "new").length,
      classified: periodMessages.filter((message) =>
        ["classified", "review", "automated", "archived"].includes(
          message.status,
        ),
      ).length,
      review: periodMessages.filter((message) => message.status === "review")
        .length,
      automated: periodMessages.filter(
        (message) => message.status === "automated",
      ).length,
      failed: periodMessages.filter((message) => message.status === "failed")
        .length,
      incoming: periodMessages.filter(
        (message) => message.direction === "incoming",
      ).length,
      outgoing: periodMessages.filter(
        (message) => message.direction === "outgoing",
      ).length,
    };
    report.categories = categories.map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
      count: periodMessages.filter(
        (message) => message.categoryId === category.id,
      ).length,
    }));
    report.sources = sources.map((source) => {
      const sourceMessages = periodMessages.filter(
        (message) => message.sourceId === source.id,
      );
      return {
        id: source.id,
        name: source.name,
        type: source.type,
        processed: sourceMessages.length,
        review: sourceMessages.filter((message) => message.status === "review")
          .length,
        errors: sourceMessages.filter((message) => message.status === "failed")
          .length,
      };
    });
    const periodCampaigns = campaigns.filter(
      (campaign) => Date.parse(campaign.createdAt) >= since,
    );
    report.outbound = {
      campaigns: periodCampaigns.length,
      recipients: periodCampaigns.reduce(
        (sum, campaign) => sum + campaign.recipients,
        0,
      ),
      delivered: periodCampaigns.reduce(
        (sum, campaign) => sum + campaign.delivered,
        0,
      ),
      failed: periodCampaigns.reduce(
        (sum, campaign) =>
          sum + Math.max(0, campaign.recipients - campaign.delivered),
        0,
      ),
    };
    report.automations = {
      runs: automations.reduce((sum, automation) => sum + automation.runs, 0),
      completed: automations.reduce(
        (sum, automation) =>
          sum +
          Math.round((automation.runs * automation.successRate) / 100),
        0,
      ),
      failed: automations.reduce(
        (sum, automation) =>
          sum +
          Math.max(
            0,
            automation.runs -
              Math.round((automation.runs * automation.successRate) / 100),
          ),
        0,
      ),
      queued: automations.reduce(
        (sum, automation) =>
          sum +
          (automation.recentRuns ?? []).filter((run) =>
            ["pending", "processing"].includes(String(run.status)),
          ).length,
        0,
      ),
      success_rate:
        automations.length > 0
          ? automations.reduce(
              (sum, automation) => sum + automation.successRate,
              0,
            ) / automations.length
          : 0,
    };
    report.rules = rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      matches: rule.hits,
      evaluations: rule.hits,
      score_delta: 0,
    }));
    const daysMap = new Map<string, OperationalReport["daily"][number]>();
    for (let index = days - 1; index >= 0; index -= 1) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - index);
      const key = date.toISOString().slice(0, 10);
      daysMap.set(key, {
        day: key,
        incoming: 0,
        processed: 0,
        automated: 0,
        review: 0,
        failed: 0,
      });
    }
    for (const message of periodMessages) {
      const day = message.receivedAt.slice(0, 10);
      const bucket = daysMap.get(day);
      if (!bucket) continue;
      if (message.direction === "incoming") bucket.incoming += 1;
      if (message.status !== "new") bucket.processed += 1;
      if (message.status === "automated") bucket.automated += 1;
      if (message.status === "review") bucket.review += 1;
      if (message.status === "failed") bucket.failed += 1;
    }
    report.daily = [...daysMap.values()];
    return report;
  }, [automations, campaigns, categories, days, messages, rules, sources]);

  useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    void api
      .get<OperationalReport>(`reports?days=${days}`, activeOrganizationId)
      .then((report) => {
        if (!cancelled) setRemote({ key: cacheKey, report });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        addToast({
          title: "Nie udało się odświeżyć raportu",
          message: error instanceof Error ? error.message : "Spróbuj ponownie.",
          tone: "error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId, addToast, cacheKey, days]);

  return {
    report: remote?.key === cacheKey ? remote.report : fallback,
    loading: !demoMode && remote?.key !== cacheKey,
  };
}
