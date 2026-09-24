/* Shell cache. The board's own data comes from /api, which is never
   cached: a stale pick or a stale spotted record would be worse than
   an empty one. The shell is cached so the board opens underground. */
var VERSION = "wb-10";
var SHELL = [
  "/", "/claude-shim.js", "/gate.js", "/board-data.js", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/apple-touch-icon.png"
];

/* Scripts that must not go stale. VERSION is bumped by hand, so anything
   served cache-first stays frozen on an installed home-screen app until
   someone remembers to change that string. For the shim that is untenable:
   it is the compatibility layer between the board and /api, so a shim left
   behind by a deploy presents as a board bug.

   Plain network-first would fix that and break something else — these are
   the scripts the board needs to open underground, and waiting out a dead
   connection before falling back to the cache is exactly what the cache is
   here to prevent. So: race the network against a cached copy, and let the
   response update the cache either way. Online, the new shim lands now.
   On a slow or absent connection the cached one paints immediately and the
   new one lands on the next open — a deploy behind, never frozen. */
var NETWORK_FIRST = ["/board-data.js", "/claude-shim.js", "/gate.js"];
var NET_WAIT_MS = 2500;

function offline() {
  return new Response("Offline and nothing cached yet.",
    { status: 503, headers: { "content-type": "text/plain" } });
}

/* Fetch, and put a good response in the cache under `key`. */
function fetchAndStore(req, key) {
  return fetch(req).then(function(r){
    if (r && r.ok) {
      var copy = r.clone();
      caches.open(VERSION).then(function(c){ c.put(key, copy); });
    }
    return r;
  });
}

self.addEventListener("install", function(e){
  e.waitUntil(
    caches.open(VERSION)
      .then(function(c){ return c.addAll(SHELL); })
      .then(function(){ return self.skipWaiting(); })
      .catch(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== VERSION; })
                            .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  var mine = url.origin === location.origin;
  if (mine && url.pathname.indexOf("/api/") === 0) return;

  /* Navigations: network first, the cached shell as the fallback. Every
     navigation resolves to the one shell document. */
  if (req.mode === "navigate") {
    e.respondWith(
      fetchAndStore(req, "/").catch(function(){
        return caches.match("/").then(function(m){ return m || offline(); });
      })
    );
    return;
  }

  if (mine && NETWORK_FIRST.indexOf(url.pathname) >= 0) {
    /* Both of these have to be called while the event is still
       dispatching, so the fetch starts here rather than inside the
       cache lookup. waitUntil keeps the worker alive long enough for
       the cache to be written even when the race hands back the copy
       we already had. */
    var net = fetchAndStore(req, req);
    e.waitUntil(net.catch(function(){}));
    e.respondWith(
      caches.match(req).then(function(hit){
        /* Nothing cached: the network is the only answer there is. */
        if (!hit) return net.catch(offline);
        return Promise.race([
          net.catch(function(){ return hit; }),
          new Promise(function(res){ setTimeout(function(){ res(hit); }, NET_WAIT_MS); })
        ]);
      })
    );
    return;
  }

  // Everything else, including webfonts: cache first, refresh behind.
  e.respondWith(
    caches.match(req).then(function(hit){
      var net = fetch(req).then(function(r){
        if (r && (r.ok || r.type === "opaque")) {
          var copy = r.clone();
          caches.open(VERSION).then(function(c){ c.put(req, copy); });
        }
        return r;
      }).catch(function(){ return hit; });
      return hit || net;
    })
  );
});
