import { parseHTML } from "npm:linkedom@0.18.12";
import {
  adminClient,
  assertInternalRequest,
  boundedInteger,
  jsonResponse,
  sha256Hex,
} from "../_shared/runtime.ts";

const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_TEXT_LENGTH = 250_000;
const MAX_REDIRECTS = 3;

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
    (parts[0] === 192 && parts[1] === 168)
  );
}

function assertSafeUrl(rawUrl: string, allowedHosts: Set<string>): URL {
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
): Promise<{ response: Response; finalUrl: URL }> {
  let current = assertSafeUrl(rawUrl, allowedHosts);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        "user-agent": "MailFlow-Studio-Scraper/1.0",
        accept: "text/html,text/plain,application/json;q=0.8",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect did not contain a location");
      current = assertSafeUrl(new URL(location, current).toString(), allowedHosts);
      continue;
    }
    return { response, finalUrl: current };
  }

  throw new Error("Too many redirects");
}

function extractContent(raw: string, contentType: string) {
  if (contentType.includes("text/html")) {
    const { document } = parseHTML(raw);
    document
      .querySelectorAll("script,style,noscript,template,svg")
      .forEach((node) => node.remove());
    const title = document.querySelector("title")?.textContent?.trim() ?? "";
    const description =
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content")
        ?.trim() ?? "";
    const text = (document.body?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TEXT_LENGTH);
    const links = [...document.querySelectorAll("a[href]")]
      .map((anchor) => anchor.getAttribute("href"))
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

    const sourceIds = [
      ...new Set(
        (jobs ?? [])
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
    for (const job of jobs ?? []) {
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

        const { response, finalUrl } = await fetchAllowed(
          String(job.url),
          allowedHosts,
        );
        if (!response.ok) {
          throw new Error(`Remote server returned HTTP ${response.status}`);
        }
        const contentType = response.headers
          .get("content-type")
          ?.toLowerCase() ?? "";
        const raw = await readBoundedBody(response);
        const extracted = extractContent(raw, contentType);
        const contentHash = await sha256Hex(extracted.text);

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
            },
            claimed_by: null,
            claimed_at: null,
            error_message: null,
          })
          .eq("id", job.id);
        if (updateError) throw updateError;
        results.push({ id: job.id, status: "complete" });
      } catch (error) {
        await failJob(supabase, job, error);
        results.push({
          id: job.id,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown scrape error",
        });
      }
    }

    return jsonResponse(200, {
      ok: true,
      claimed: (jobs ?? []).length,
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
