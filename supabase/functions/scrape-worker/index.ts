import { parseHTML } from "npm:linkedom@0.18.12";
import {
  adminClient,
  assertInternalRequest,
  boundedInteger,
  jsonResponse,
  sha256Hex,
} from "../_shared/runtime.ts";
import {
  changedPercentage,
  robotsAllows,
} from "../_shared/scrape-utils.ts";

const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_TEXT_LENGTH = 250_000;
const MAX_REDIRECTS = 3;

interface ScrapeJob extends Record<string, unknown> {
  id: string;
  organization_id: string;
  source_connector_id: string;
  url: string;
  scheduled_at: string;
  attempt_count: number;
  max_attempts: number;
}

interface ParsedNode {
  textContent: string | null;
  getAttribute(name: string): string | null;
  remove(): void;
}

interface ParsedDocument {
  body: ParsedNode | null;
  querySelector(selector: string): ParsedNode | null;
  querySelectorAll(selector: string): ArrayLike<ParsedNode> &
    Iterable<ParsedNode> & {
      forEach(callback: (node: ParsedNode) => void): void;
    };
}

function configuredHosts(): Set<string> {
  return new Set(
    (Deno.env.get("SCRAPER_ALLOWED_HOSTS") ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function hostMatches(host: string, allowedHosts: Set<string>): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, "");
  return [...allowedHosts].some(
    (allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`),
  );
}

function privateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] >= 224
  );
}

function privateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("::ffff:0.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:169.254.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

async function assertPublicDns(hostname: string): Promise<void> {
  const lookups = await Promise.allSettled([
    Deno.resolveDns(hostname, "A"),
    Deno.resolveDns(hostname, "AAAA"),
  ]);
  const addresses = lookups.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
  if (addresses.length === 0) {
    throw new Error(`Host ${hostname} does not have a public DNS record`);
  }
  if (
    addresses.some((address) =>
      address.includes(":") ? privateIpv6(address) : privateIpv4(address)
    )
  ) {
    throw new Error(`Host ${hostname} resolves to a private network address`);
  }
}

async function assertSafeUrl(
  rawUrl: string,
  allowedHosts: Set<string>,
): Promise<URL> {
  const url = new URL(rawUrl);
  const hostname = url.hostname.toLowerCase();
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs can be scraped");
  }
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.includes(":") ||
    privateIpv4(hostname)
  ) {
    throw new Error("Local and private network addresses are blocked");
  }
  if (!hostMatches(hostname, allowedHosts)) {
    throw new Error(`Host ${hostname} is not present on the scraper allowlist`);
  }
  await assertPublicDns(hostname);
  url.username = "";
  url.password = "";
  url.hash = "";
  return url;
}

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("Response exceeds the 2 MB scraper limit");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Response exceeds the 2 MB scraper limit");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder().decode(bytes);
}

async function fetchAllowed(
  rawUrl: string,
  allowedHosts: Set<string>,
  userAgent: string,
): Promise<{ response: Response; finalUrl: URL }> {
  let current = await assertSafeUrl(rawUrl, allowedHosts);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        "user-agent": userAgent,
        accept:
          "text/html,text/plain,application/json,application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.8",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect did not contain a location");
      current = await assertSafeUrl(
        new URL(location, current).toString(),
        allowedHosts,
      );
      continue;
    }
    return { response, finalUrl: current };
  }

  throw new Error("Too many redirects");
}

async function assertRobotsAllowed(
  rawUrl: string,
  allowedHosts: Set<string>,
  userAgent: string,
): Promise<void> {
  const target = await assertSafeUrl(rawUrl, allowedHosts);
  const robotsUrl = new URL("/robots.txt", target);
  const { response } = await fetchAllowed(
    robotsUrl.toString(),
    allowedHosts,
    userAgent,
  );
  if (response.status === 401 || response.status === 403) {
    throw new Error("robots.txt blocks unauthenticated scraping");
  }
  if (response.status >= 500) {
    throw new Error(`robots.txt is temporarily unavailable (${response.status})`);
  }
  if (!response.ok) return;
  const body = await readBoundedBody(response);
  if (!robotsAllows(body, userAgent, `${target.pathname}${target.search}`)) {
    throw new Error(`robots.txt disallows scraping ${target.pathname}`);
  }
}

function extractContent(
  raw: string,
  contentType: string,
  sourceConfig: Record<string, unknown>,
) {
  const mode = String(sourceConfig.extraction_mode ?? "content");
  if (
    contentType.includes("text/html") ||
    contentType.includes("xml") ||
    mode === "rss" ||
    mode === "sitemap"
  ) {
    const document = (
      parseHTML(raw) as unknown as { document: ParsedDocument }
    ).document;
    document
      .querySelectorAll("script,style,noscript,template,svg")
      .forEach((node) => node.remove());
    const title =
      document.querySelector("channel > title, feed > title, title")
        ?.textContent?.trim() ?? "";
    const description =
      document
        .querySelector(
          'meta[name="description"], channel > description, feed > subtitle',
        )
        ?.getAttribute("content")
        ?.trim() ??
      document
        .querySelector("channel > description, feed > subtitle")
        ?.textContent?.trim() ??
      "";
    const selector =
      mode === "selector"
        ? String(sourceConfig.css_selector ?? "main")
        : mode === "rss"
          ? "item, entry"
          : mode === "sitemap"
            ? "url, sitemap"
            : "body";
    const selected =
      mode === "content" ? document.body : document.querySelector(selector);
    if (!selected) {
      throw new Error(`CSS selector ${selector} did not match any content`);
    }
    const text = (selected.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TEXT_LENGTH);
    const links = [...document.querySelectorAll("a[href], link, loc")]
      .map(
        (anchor) =>
          anchor.getAttribute("href") ?? anchor.textContent?.trim() ?? null,
      )
      .filter((href): href is string => Boolean(href))
      .slice(0, 500);
    return { title, description, text, links };
  }

  if (
    contentType.includes("text/plain") ||
    contentType.includes("application/json")
  ) {
    return {
      title: "",
      description: "",
      text: raw.slice(0, MAX_TEXT_LENGTH),
      links: [],
    };
  }
  throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
}

async function failJob(
  supabase: ReturnType<typeof adminClient>,
  job: Record<string, unknown>,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : "Unknown scrape error";
  const attemptCount = Number(job.attempt_count ?? 0);
  const maxAttempts = Number(job.max_attempts ?? 3);
  const retry = attemptCount < maxAttempts;
  await supabase
    .from("scrape_jobs")
    .update({
      status: retry ? "pending" : "failed",
      scheduled_at: retry
        ? new Date(Date.now() + 2 ** attemptCount * 60_000).toISOString()
        : job.scheduled_at,
      claimed_by: null,
      claimed_at: null,
      error_message: message,
    })
    .eq("id", job.id);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    assertInternalRequest(request);
    const payload = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const batchSize = boundedInteger(payload.batchSize, 10, 1, 50);
    const globalAllowedHosts = configuredHosts();
    const supabase = adminClient();
    const { data: jobs, error: claimError } = await supabase.rpc(
      "claim_scrape_jobs",
      {
        worker_name: `scrape-worker-${crypto.randomUUID()}`,
        batch_size: batchSize,
      },
    );
    if (claimError) throw claimError;
    const claimedJobs = (jobs ?? []) as ScrapeJob[];

    const sourceIds = [
      ...new Set(
        claimedJobs
          .map((job) => job.source_connector_id)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    const sourceConfigs = new Map<string, Record<string, unknown>>();
    if (sourceIds.length > 0) {
      const { data: sources, error: sourceError } = await supabase
        .from("source_connectors")
        .select("id, public_config")
        .in("id", sourceIds);
      if (sourceError) throw sourceError;
      (sources ?? []).forEach((source) =>
        sourceConfigs.set(String(source.id), source.public_config ?? {}),
      );
    }

    const results: Record<string, unknown>[] = [];
    for (const job of claimedJobs) {
      try {
        const allowedHosts = new Set(globalAllowedHosts);
        const sourceConfig = job.source_connector_id
          ? sourceConfigs.get(String(job.source_connector_id))
          : undefined;
        const sourceHosts = Array.isArray(sourceConfig?.allowed_hosts)
          ? sourceConfig.allowed_hosts
          : [];
        sourceHosts
          .filter((host): host is string => typeof host === "string")
          .forEach((host) => allowedHosts.add(host.toLowerCase()));
        if (allowedHosts.size === 0) {
          throw new Error(
            "No scraper hosts are allowed; configure SCRAPER_ALLOWED_HOSTS or source public_config.allowed_hosts",
          );
        }

        const userAgent = String(
          sourceConfig?.user_agent ??
            "MailFlowBot/1.0 (+https://example.com/bot)",
        );
        if (sourceConfig?.respect_robots_txt !== false) {
          await assertRobotsAllowed(
            String(job.url),
            allowedHosts,
            userAgent,
          );
        }
        const { response, finalUrl } = await fetchAllowed(
          String(job.url),
          allowedHosts,
          userAgent,
        );
        if (!response.ok) {
          throw new Error(`Remote server returned HTTP ${response.status}`);
        }
        const contentType = response.headers
          .get("content-type")
          ?.toLowerCase() ?? "";
        const raw = await readBoundedBody(response);
        const extracted = extractContent(
          raw,
          contentType,
          sourceConfig ?? {},
        );
        const contentHash = await sha256Hex(extracted.text);
        const { data: previousJob, error: previousError } = await supabase
          .from("scrape_jobs")
          .select("content_hash, extracted_text")
          .eq("source_connector_id", job.source_connector_id)
          .eq("status", "complete")
          .neq("id", job.id)
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (previousError) throw previousError;
        const firstRun = !previousJob?.content_hash;
        const hashChanged = previousJob?.content_hash !== contentHash;
        const changePercentage = firstRun
          ? 100
          : changedPercentage(
              String(previousJob?.extracted_text ?? ""),
              extracted.text,
            );
        const changeThreshold = boundedInteger(
          sourceConfig?.change_threshold,
          1,
          1,
          100,
        );
        const changed = hashChanged && changePercentage >= changeThreshold;
        const shouldCreateMessage =
          changed &&
          (!firstRun || sourceConfig?.notify_on_initial === true);

        let messageId: string | null = null;
        if (shouldCreateMessage) {
          const externalId = `scrape:${job.source_connector_id}:${contentHash}`;
          const dedupeHash = await sha256Hex(
            [
              String(job.organization_id),
              String(job.source_connector_id),
              externalId,
            ].join("\u001f"),
          );
          const { data: message, error: messageError } = await supabase
            .from("messages")
            .insert({
              organization_id: job.organization_id,
              source_connector_id: job.source_connector_id,
              external_id: externalId,
              direction: "incoming",
              sender_email: `scraper@${finalUrl.hostname}`,
              sender_name: finalUrl.hostname,
              recipients: [],
              subject:
                extracted.title ||
                `Zmiana treści na ${finalUrl.hostname}`,
              preview: extracted.text.slice(0, 1000),
              body_text: extracted.text,
              headers: {
                source_url: finalUrl.toString(),
                content_type: contentType,
                content_hash: contentHash,
                change_percentage: changePercentage,
              },
              received_at: new Date().toISOString(),
              status: "new",
              dedupe_hash: dedupeHash,
            })
            .select("id")
            .single();
          if (messageError?.code !== "23505") {
            if (messageError) throw messageError;
            messageId = message?.id ?? null;
          }
        }

        const { error: updateError } = await supabase
          .from("scrape_jobs")
          .update({
            status: "complete",
            completed_at: new Date().toISOString(),
            response_status: response.status,
            content_hash: contentHash,
            extracted_title: extracted.title || null,
            extracted_text: extracted.text,
            metadata: {
              final_url: finalUrl.toString(),
              content_type: contentType,
              description: extracted.description,
              links: extracted.links,
              response_bytes: new TextEncoder().encode(raw).byteLength,
              changed,
              hash_changed: hashChanged,
              change_percentage: changePercentage,
              change_threshold: changeThreshold,
              first_run: firstRun,
              message_created: Boolean(messageId),
            },
            message_id: messageId,
            claimed_by: null,
            claimed_at: null,
            error_message: null,
          })
          .eq("id", job.id);
        if (updateError) throw updateError;
        if (job.source_connector_id) {
          await supabase
            .from("source_connectors")
            .update({
              status: "active",
              last_sync_at: new Date().toISOString(),
              last_error: null,
            })
            .eq("id", job.source_connector_id);
        }
        results.push({
          id: job.id,
          status: "complete",
          changed,
          changePercentage,
          messageId,
        });
      } catch (error) {
        await failJob(supabase, job, error);
        if (job.source_connector_id) {
          await supabase
            .from("source_connectors")
            .update({
              status: "error",
              last_error:
                error instanceof Error ? error.message : "Unknown scrape error",
            })
            .eq("id", job.source_connector_id);
        }
        results.push({
          id: job.id,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown scrape error",
        });
      }
    }

    return jsonResponse(200, {
      ok: true,
      claimed: claimedJobs.length,
      completed: results.filter((result) => result.status === "complete").length,
      results,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("scrape_worker_error", error);
    return jsonResponse(500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected scrape error",
    });
  }
});
