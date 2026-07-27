import { supabase } from "./supabase";

type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  details?: unknown;
};

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function sessionToken(): Promise<string> {
  if (!supabase) throw new ApiError("Supabase nie jest skonfigurowany.", 500);
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new ApiError(error.message, 401);
  if (!data.session?.access_token) {
    throw new ApiError("Sesja wygasła. Zaloguj się ponownie.", 401);
  }
  return data.session.access_token;
}

async function request<T>(
  path: string,
  options: RequestInit & { organizationId?: string } = {},
): Promise<T> {
  const token = await sessionToken();
  const headers = new Headers(options.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("accept", "application/json");
  if (options.body) headers.set("content-type", "application/json");
  if (options.organizationId) {
    headers.set("x-organization-id", options.organizationId);
  }

  const response = await fetch(`/api/${path.replace(/^\//, "")}`, {
    ...options,
    headers,
  });
  const payload = (await response.json().catch(() => ({
    ok: false,
    error: "Serwer zwrócił nieprawidłową odpowiedź.",
  }))) as ApiEnvelope<T>;

  if (!response.ok || !payload.ok || payload.data === undefined) {
    throw new ApiError(
      payload.error ?? `Żądanie nie powiodło się (${response.status}).`,
      response.status,
      payload.details,
    );
  }
  return payload.data;
}

export const api = {
  get<T>(path: string, organizationId?: string) {
    return request<T>(path, { organizationId });
  },
  post<T>(path: string, body: unknown, organizationId?: string) {
    return request<T>(path, {
      method: "POST",
      organizationId,
      body: JSON.stringify(body),
    });
  },
  patch<T>(path: string, body: unknown, organizationId?: string) {
    return request<T>(path, {
      method: "PATCH",
      organizationId,
      body: JSON.stringify(body),
    });
  },
  delete<T>(path: string, organizationId?: string) {
    return request<T>(path, {
      method: "DELETE",
      organizationId,
    });
  },
};
