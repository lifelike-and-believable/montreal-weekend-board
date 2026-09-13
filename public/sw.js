/* Shell cache. The board's own data comes from /api, which is never
   cached: a stale pick or a stale spotted record would be worse than
   an empty one. The shell is cached so the board opens underground. */
var VERSION = "wb-1";
var SHELL = [
  "/", "/claude-shim.js", "/gate.js", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/apple-touch-icon.png"
];

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
  if (url.origin === location.origin && url.pathname.indexOf("/api/") === 0) return;

  // Navigations: network first so a redeploy lands, cache as the fallback.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function(r){
        var copy = r.clone();
        caches.open(VERSION).then(function(c){ c.put("/", copy); });
        return r;
      }).catch(function(){
        return caches.match("/").then(function(m){
          return m || new Response("Offline and nothing cached yet.",
            { status: 503, headers: { "content-type": "text/plain" } });
        });
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
