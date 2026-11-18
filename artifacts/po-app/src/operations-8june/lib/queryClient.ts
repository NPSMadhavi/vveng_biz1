import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = await res.text();
    let errorData;
    try {
      errorData = JSON.parse(text);
    } catch {
      errorData = { message: text || res.statusText };
    }
    
    if (!(res.status === 503 && errorData.temporary)) {
      console.error(`API Error ${res.status}:`, errorData);
    }
    
    // Clean up authentication error messages
    if (res.status === 401) {
      throw new Error("Incorrect credentials");
    }
    
    // Clean up registration error messages
    if (res.status === 400 && errorData.message?.includes("already")) {
      throw new Error("Email address is already registered");
    }

    // Handle standardized API error responses
    if (errorData.success === false && errorData.message) {
      throw new Error(errorData.message);
    }
    
    // For 500 errors, provide more context
    if (res.status === 503 && errorData.temporary) {
      throw new Error(errorData.error || "API is restarting. Try again in a moment.");
    }

    if (res.status === 500) {
      throw new Error(errorData.message || errorData.error || "Internal server error. Please check server logs.");
    }
    
    // Express default 404 pages come back as HTML — show a clear message instead
    if (res.status === 404 && (text.includes("<!DOCTYPE") || text.includes("<html"))) {
      throw new Error(`API route not found (${res.url}). Restart the backend with: npm run dev`);
    }

    throw new Error(errorData.message || errorData.error || `HTTP ${res.status}: ${res.statusText}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

/** Parse API responses that may be wrapped as { success, message, data } or raw objects */
export function parseApiResponse<T>(json: unknown): T {
  if (json && typeof json === 'object' && 'success' in json) {
    const response = json as { success?: boolean; message?: string; data?: T };
    if (response.success === false) {
      throw new Error(response.message || 'Request failed');
    }
    if (response.data !== undefined) {
      return response.data;
    }
  }
  return json as T;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Build URL from queryKey - properly handle the first element as base URL
    const baseUrl = queryKey[0] as string;
    
    // If there are additional segments, join them properly
    let url = baseUrl;
    if (queryKey.length > 1) {
      const params = queryKey.slice(1);
      // Handle different types of params (numbers, strings, etc.)
      const paramString = params.map(p => String(p)).join('/');
      url = `${baseUrl}/${paramString}`;
    }
    
    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    const data = await res.json();
    return parseApiResponse(data);
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      // PERFORMANCE: 5min cache for frequently used data
      staleTime: 1000 * 60 * 5,  // 5 minutes
      gcTime: 1000 * 60 * 10,   // 10 minutes garbage collection
      retry: (failureCount, error) => {
        if (failureCount >= 4) return false;
        const message = error instanceof Error ? error.message : "";
        if (/401|403|400|404|500|Incorrect credentials|already registered/i.test(message)) return false;
        return /API is restarting|Failed to fetch|NetworkError|Load failed|ECONNREFUSED/i.test(message);
      },
      retryDelay: (attemptIndex) => Math.min(400 * 2 ** attemptIndex, 4000),
    },
    mutations: {
      retry: false,
      onError: (error) => {
        console.error("Mutation error:", error);
      }
    },
  },
});
