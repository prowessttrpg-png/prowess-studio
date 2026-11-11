import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { pipeline } from "node:stream/promises";

const prefix = "/__prowess_desktop";
const authCookie = "prowess_desktop";
const tokenPattern = /^[a-f0-9]{64}$/;
const hopHeaders = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
  "trailer", "transfer-encoding", "upgrade", "authorization", "x-prowess-desktop-backend", "x-prowess-control"]);
const token = () => randomBytes(32).toString("hex");

function matches(actual, expected) {
  return typeof actual === "string" && tokenPattern.test(actual) &&
    timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function send(response, status, type, body) {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(body);
}

const plain = (response, status, body) => send(response, status, "text/plain; charset=utf-8", body);

function html(response, title, body, script) {
  const hash = createHash("sha256").update(script).digest("base64");
  response.setHeader("Content-Security-Policy",
    "default-src 'none'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; script-src 'sha256-" + hash + "'");
  send(response, 200, "text/html; charset=utf-8", '<!doctype html><html lang="en"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>' + title + '</title>' +
    '<style>body{font:17px system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1rem;color:#24303f}' +
    'button,input{font:inherit;margin:.4rem .4rem .4rem 0}a{color:#18528f}p{line-height:1.6}</style>' +
    '<main>' + body + '</main><script>' + script + '</script></html>');
}

const bootstrapScript = `
const code = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
fetch("${prefix}/session", {method:"POST", body:code}).then((response) => {
  if (!response.ok) throw new Error("Open Prowess Studio again from its shortcut.");
  return response.text();
}).then((target) => location.replace(target), (error) => {
  document.getElementById("message").textContent = error.message;
});
`;

const manageScript = `
const status = document.getElementById("status");
const message = document.getElementById("message");
async function refresh() {
  const response = await fetch("${prefix}/status");
  if (!response.ok) return;
  const result = await response.json();
  status.textContent = result.message;
  for (const button of document.querySelectorAll("[data-ready]")) button.disabled = !result.ready;
  for (const button of document.querySelectorAll("[data-setup]")) {
    button.hidden = !result.firstRun || button.dataset.setup === "demo" && !result.demo;
  }
  if (location.pathname.endsWith("/waiting") && result.ready) location.replace("/");
}
async function action(name, body) {
  message.textContent = "Working…";
  try {
    const response = await fetch("${prefix}/" + name, {method:"POST", body});
    const text = await response.text();
    message.textContent = text;
    await refresh();
  } catch {
    message.textContent = "Open Prowess Studio from its shortcut to see the current status.";
  }
}
document.getElementById("quit").onclick = () => action("quit");
document.getElementById("restore").onclick = () => {
  const file = document.getElementById("backup-file").files[0];
  if (file && confirm("Restore this backup and replace the current workspace? A recovery backup will be made first.")) {
    action("restore", file);
  }
};
for (const button of document.querySelectorAll("[data-setup]")) {
  button.onclick = () => action("setup", button.dataset.setup);
}
refresh();
setInterval(refresh, 1000);
`;

const dashboard = '<h1>Prowess Studio</h1><p id="status" role="status">Connecting…</p>' +
  '<p><a href="/">Open Studio</a> · <a href="' + prefix + '/backup">Back up local workspace</a> · ' +
  '<a href="' + prefix + '/diagnostics">Download diagnostics</a></p>' +
  '<p><button data-setup="empty" hidden>Start with an empty workspace</button>' +
  '<button data-setup="demo" hidden>Demo — sample rules</button></p>' +
  '<p><label for="backup-file">Workspace backup</label> <input id="backup-file" type="file" accept=".prowess-backup">' +
  '<button id="restore" data-ready disabled>Restore local workspace</button></p>' +
  '<button id="quit">Quit Studio</button><p id="message" role="status"></p>';

export async function readBody(request, limit) {
  let size = 0;
  const buffers = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("The request is larger than this operation supports.");
    buffers.push(chunk);
  }
  return Buffer.concat(buffers, size);
}

export async function createDesktopGateway({ controlToken, backendToken, status, setup, backup, restore, diagnostics, quit }) {
  const sessions = new Set();
  const launches = new Map();
  let backend;
  const active = new Map();
  let origin;
  const server = http.createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) plain(response, 500, "The operation failed. Check the launcher status.");
      else response.destroy();
    });
  });
  server.requestTimeout = 60_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  origin = "http://127.0.0.1:" + port;
  const host = new URL(origin).host;

  function issueLaunch(manage = false) {
    const now = Date.now();
    for (const [key, value] of launches) if (value.until < now) launches.delete(key);
    if (launches.size >= 32) launches.delete(launches.keys().next().value);
    const key = token();
    launches.set(key, { until: now + 120_000, manage });
    return origin + prefix + "/launch#" + key;
  }

  async function handle(request, response) {
    if (request.headers.host !== host) return plain(response, 403, "Forbidden");
    const url = new URL(request.url, origin);
    if (url.origin !== origin) return plain(response, 403, "Forbidden");
    const read = request.method === "GET" || request.method === "HEAD";
    const suppliedOrigin = request.headers.origin;
    const fetchSite = request.headers["sec-fetch-site"];
    if (suppliedOrigin && suppliedOrigin !== origin || fetchSite && !["same-origin", "none"].includes(fetchSite)) {
      return plain(response, 403, "Forbidden");
    }

    if (url.pathname === prefix + "/control" && request.method === "POST") {
      if (suppliedOrigin || fetchSite || !matches(request.headers["x-prowess-control"], controlToken)) {
        return plain(response, 403, "Forbidden");
      }
      const command = (await readBody(request, 32)).toString();
      if (command === "open" || command === "manage") return plain(response, 200, issueLaunch(command === "manage"));
      if (command === "quit") {
        plain(response, 200, "Closing Studio.");
        quit();
        return;
      }
      return plain(response, 400, "Unknown launcher command");
    }
    if (!read && suppliedOrigin !== origin) return plain(response, 403, "Forbidden");

    if (url.pathname === prefix + "/launch" && request.method === "GET") {
      return html(response, "Opening Prowess Studio", '<p id="message">Opening Prowess Studio…</p>', bootstrapScript);
    }
    if (url.pathname === prefix + "/session" && request.method === "POST") {
      const key = (await readBody(request, 64)).toString();
      const launch = launches.get(key);
      launches.delete(key);
      if (!launch || launch.until < Date.now()) return plain(response, 403, "This launch link has expired.");
      const session = token();
      if (sessions.size >= 64) sessions.delete(sessions.values().next().value);
      sessions.add(session);
      response.setHeader("Set-Cookie", authCookie + "=" + session + "; HttpOnly; SameSite=Strict; Path=/");
      return plain(response, 200, prefix + (launch.manage ? "/manage" : "/waiting"));
    }

    const cookies = (request.headers.cookie ?? "").split(";").map((cookie) => cookie.trim());
    const session = cookies.find((cookie) => cookie.startsWith(authCookie + "="))?.slice(authCookie.length + 1);
    if (!sessions.has(session)) return plain(response, 401, "Open Prowess Studio from its shortcut.");

    if (url.pathname.startsWith(prefix + "/")) {
      const action = url.pathname.slice(prefix.length + 1);
      if (request.method === "GET") {
        if (action === "manage" || action === "waiting") return html(response, "Prowess Studio", dashboard, manageScript);
        if (action === "status") return send(response, 200, "application/json", JSON.stringify(status()));
        if (action === "diagnostics") {
          response.setHeader("Content-Disposition", 'attachment; filename="Prowess-diagnostics.json"');
          return send(response, 200, "application/json", JSON.stringify(diagnostics(), null, 2));
        }
        if (action === "backup") {
          const data = await backup();
          response.setHeader("Content-Disposition", 'attachment; filename="Prowess-Workspace.prowess-backup"');
          return send(response, 200, "application/octet-stream", data);
        }
      }
      if (request.method === "POST") {
        if (action === "setup") return plain(response, 200, await setup((await readBody(request, 16)).toString()));
        if (action === "restore") return plain(response, 200, await restore(request));
        if (action === "quit") {
          plain(response, 200, "Closing Studio.");
          quit();
          return;
        }
      }
      return plain(response, 404, "Not found");
    }

    const target = backend;
    if (!target) return plain(response, 503, "Studio is preparing. Use the launcher to check its status.");
    const headers = Object.fromEntries(Object.entries(request.headers)
      .filter(([name]) => !hopHeaders.has(name) && !name.startsWith("x-forwarded-")));
    headers.cookie = cookies.filter((cookie) => !cookie.startsWith(authCookie + "=")).join("; ");
    headers.host = host;
    headers["x-forwarded-host"] = host;
    headers["x-forwarded-port"] = String(port);
    headers["x-forwarded-proto"] = "http";
    headers["x-prowess-desktop-backend"] = backendToken;
    let upstream;
    const forwarding = new Promise((resolve) => {
      upstream = http.request({
        hostname: "127.0.0.1", port: target, method: request.method, path: url.pathname + url.search, headers,
      }, (incoming) => {
        const responseHeaders = Object.fromEntries(Object.entries(incoming.headers).filter(([name]) => !hopHeaders.has(name)));
        responseHeaders["cache-control"] = "no-store";
        responseHeaders["referrer-policy"] = "no-referrer";
        response.writeHead(incoming.statusCode ?? 502, responseHeaders);
        pipeline(incoming, response).then(resolve, resolve);
      });
      upstream.on("error", () => {
        if (!response.headersSent) plain(response, 502, "Studio is unavailable. Check the launcher status.");
        else response.destroy();
        resolve();
      });
      response.on("close", () => upstream.destroy());
      request.pipe(upstream);
    });
    active.set(forwarding, upstream);
    try { await forwarding; } finally { active.delete(forwarding); }
  }

  return {
    origin, issueLaunch,
    setBackend: (value) => { backend = value; },
    invalidateSessions: () => { sessions.clear(); launches.clear(); },
    async drain() {
      backend = undefined;
      const timeout = setTimeout(() => {
        for (const upstream of active.values()) upstream.destroy(new Error("Studio is closing."));
      }, 10_000);
      try { await Promise.all(active.keys()); }
      finally { clearTimeout(timeout); }
    },
    async close() {
      const timeout = setTimeout(() => server.closeAllConnections(), 3000);
      try { await new Promise((resolve) => server.close(resolve)); }
      finally { clearTimeout(timeout); }
    },
  };
}
