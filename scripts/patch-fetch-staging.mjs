const AUTH_ORIGIN = "https://fair-flow-staging.web.app";
const _fetch = globalThis.fetch.bind(globalThis);

function needsReferer(url) {
  return /identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/.test(String(url || ""));
}

globalThis.fetch = (input, init = {}) => {
  const url = typeof input === "string" ? input : input && input.url;
  if (!needsReferer(url)) return _fetch(input, init);
  const headers = new Headers(
    init.headers || (typeof input !== "string" && input && input.headers) || undefined
  );
  headers.set("Referer", `${AUTH_ORIGIN}/`);
  headers.set("Origin", AUTH_ORIGIN);
  return _fetch(input, { ...init, headers });
};
