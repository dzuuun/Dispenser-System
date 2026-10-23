export function createAdminApi({ baseUrl, fetchImpl = (...args) => fetch(...args), onToken = () => {}, onExpired = () => {} }) {
  let accessToken = "";
  let generation = 0;
  let ended = false;
  let refreshing = null;
  let refreshController = null;
  const raw = (path, options = {}) => fetchImpl(`${baseUrl}${path}`, {
    credentials: "same-origin", cache: "no-store", ...options,
  });
  const clearSession = (notify = false) => {
    const hadSession = Boolean(accessToken);
    generation += 1;
    accessToken = "";
    ended = true;
    refreshController?.abort();
    refreshController = null;
    refreshing = null;
    if (notify && hadSession) onExpired();
  };
  const refreshSession = () => {
    if (ended) return Promise.resolve(null);
    if (refreshing) return refreshing;
    const sessionGeneration = generation;
    const controller = new AbortController();
    refreshController = controller;
    const pending = (async () => {
      const response = await raw("/auth/refresh", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      });
      if (generation !== sessionGeneration) return null;
      if ([204, 401, 403].includes(response.status)) {
        clearSession(true);
        return null;
      }
      if (!response.ok) throw Object.assign(new Error("Unable to renew your administrator session. Please try again."), { status: response.status });
      const session = await response.json();
      if (generation !== sessionGeneration) return null;
      if (typeof session?.accessToken !== "string" || !session.accessToken) {
        clearSession(true);
        return null;
      }
      accessToken = session.accessToken;
      onToken(accessToken);
      return accessToken;
    })();
    refreshing = pending;
    // Do not let one aborted table request cancel a refresh needed by others.
    pending.then(() => {}, () => {}).finally(() => {
      if (refreshing === pending) {
        refreshing = null;
        refreshController = null;
      }
    });
    return pending;
  };
  return {
    getAccessToken: () => accessToken,
    startSession(token) {
      clearSession();
      ended = false;
      accessToken = token;
      onToken(token);
    },
    restoreSession() {
      ended = false;
      return refreshSession();
    },
    async logout() {
      const pending = refreshing;
      clearSession();
      // Finish cancellation before clearing the cookie, so a late refresh
      // cannot sign the administrator back in after an intentional sign-out.
      if (pending) await pending.catch(() => {});
      return raw("/auth/logout", { method: "POST" });
    },
    async fetch(path, options = {}) {
      const headers = new Headers(options.headers);
      const protectedPath = /^\/admin(?:\/|$|\?)/.test(path) || path === "/auth/me";
      if (!protectedPath || (!accessToken && !headers.has("Authorization")))
        return raw(path, options);
      if (ended) throw Object.assign(new Error("Please sign in again."), { status: 401 });
      const sessionGeneration = generation;
      const checkRequest = () => {
        options.signal?.throwIfAborted();
        if (generation !== sessionGeneration)
          throw new DOMException("Administrator session changed.", "AbortError");
      };
      const send = (token) => {
        checkRequest();
        const nextHeaders = new Headers(headers);
        if (token) nextHeaders.set("Authorization", `Bearer ${token}`);
        return raw(path, { ...options, headers: nextHeaders });
      };
      const tokenUsed = accessToken || headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      let response = await send(tokenUsed);
      checkRequest();
      if (response.status !== 401) return response;
      // Another request may have already refreshed while this 401 was in flight.
      const nextToken = accessToken && accessToken !== tokenUsed
        ? accessToken : await refreshSession();
      if (!nextToken) return response;
      checkRequest();
      response = await send(nextToken);
      checkRequest();
      if (response.status === 401) clearSession(true);
      return response;
    },
  };
}
