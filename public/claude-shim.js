/* ============================================================
   claude-shim.js
   Reimplements the three claude.ai artifact runtime capabilities
   (db, assets, sample) against this app's own API, so the board
   code below runs unmodified.

   Surface reproduced, exactly as the board uses it:
     window.claude.use("db")      -> { doc(path), collection(path) }
        DocRef: get() set(obj) delete() onSnapshot(cb, errCb)
        ColRef: get() doc(id) onSnapshot(cb, errCb)
        DocSnap:   { exists, data(), metadata:{hasPendingWrites} }
        QuerySnap: { docs:[{id, data()}], metadata:{hasPendingWrites} }
     window.claude.use("assets")  -> { upload(file) -> {id, url} }
     window.claude.use("sample")  -> { limits(), json(prompt, opts) }

   Two differences from the artifact host, both benign:
   - Snapshot bodies are NOT frozen here, so thaw() is a no-op.
     It is left in place on purpose.
   - onSnapshot polls instead of streaming. The board already
     refetches on focus and visibilitychange, so this is backup.
   ============================================================ */
(function(){
"use strict";

var POLL_MS = 30000;

function api(path, body, opts){
  opts = opts || {};
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    signal: opts.signal,
    body: JSON.stringify(body || {})
  }).then(function(r){
    if (r.status === 401) {
      window.dispatchEvent(new CustomEvent("board:unauthenticated"));
      throw { code: "permission_denied", message: "not signed in" };
    }
    return r.json().then(function(j){
      if (!r.ok) throw { code: (j && j.code) || "http_" + r.status,
                         message: (j && j.error) || ("HTTP " + r.status) };
      return j;
    }, function(){
      throw { code: "bad_response", message: "HTTP " + r.status };
    });
  });
}

var NO_PENDING = { hasPendingWrites: false };
function docSnap(id, data){
  return { id: id, exists: !!data, metadata: NO_PENDING,
           data: function(){ return data || {}; } };
}

/* poll a reader until unsubscribed; fire cb on every successful read */
function poller(read, cb, errCb){
  var dead = false;
  function tick(){
    if (dead) return;
    if (document.hidden) return;
    read().then(function(v){ if (!dead) cb(v); },
               function(e){ if (!dead && errCb) errCb(e); });
  }
  var iv = setInterval(tick, POLL_MS);
  return function(){ dead = true; clearInterval(iv); };
}

function makeDoc(path){
  var read = function(){
    return api("/api/db", { op: "get", path: path })
      .then(function(j){ return docSnap(j.id, j.data); });
  };
  return {
    get: read,
    set: function(obj){ return api("/api/db", { op: "set", path: path, data: obj }); },
    delete: function(){ return api("/api/db", { op: "delete", path: path }); },
    onSnapshot: function(cb, errCb){ return poller(read, cb, errCb); }
  };
}

function makeCollection(path){
  var read = function(){
    return api("/api/db", { op: "list", path: path }).then(function(j){
      return {
        metadata: NO_PENDING,
        docs: (j.docs || []).map(function(d){ return docSnap(d.id, d.data); })
      };
    });
  };
  return {
    get: read,
    doc: function(id){ return makeDoc(path + "/" + id); },
    onSnapshot: function(cb, errCb){ return poller(read, cb, errCb); }
  };
}

var DB = {
  doc: makeDoc,
  collection: makeCollection
};

/* Posters are sent as raw bytes, not multipart: nothing to parse
   server-side, and the downscale keeps every upload well inside the
   serverless request body limit. */
var ASSETS = {
  upload: function(file){
    return shrink(file).then(function(b){
      return fetch("/api/upload", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/octet-stream",
                   "x-photo-type": b.type || "image/jpeg" },
        body: b
      });
    }).then(function(r){
      if (r.status === 401) {
        window.dispatchEvent(new CustomEvent("board:unauthenticated"));
        throw { code: "permission_denied" };
      }
      if (!r.ok) throw { code: "upload_failed" };
      return r.json();
    });
  }
};

/* Redraw to <=1600px JPEG. The board normalizes too, but a file
   already in an accepted type and under its own 4MB ceiling passes
   through untouched, and 4MB of base64 overflows the request limit. */
var MAX_EDGE = 1600, SHRINK_OVER = 1200000;
function shrink(file){
  if (!file || file.size <= SHRINK_OVER) return Promise.resolve(file);
  return new Promise(function(res){
    var url, img = new Image();
    var done = function(v){ try { URL.revokeObjectURL(url); } catch(e){} res(v || file); };
    img.onerror = function(){ done(null); };
    img.onload = function(){
      try {
        var w = img.naturalWidth, h = img.naturalHeight;
        var sc = Math.min(1, MAX_EDGE / Math.max(w, h));
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w * sc));
        c.height = Math.max(1, Math.round(h * sc));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function(b){ done(b); }, "image/jpeg", 0.82);
      } catch(e){ done(null); }
    };
    try { url = URL.createObjectURL(file); img.src = url; } catch(e){ done(null); }
  });
}

/* Mirrors what the artifact viewer reported when image support was
   present. Kept deliberately loose: the board only checks that
   limits().images exists, and narrowing accept to these exact types
   greys out HEIC in the iOS picker (see v7 note in the board code). */
var SAMPLE = {
  limits: function(){
    return Promise.resolve({
      images: {
        mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
        maxBytes: 4 * 1024 * 1024,
        maxCount: 1
      }
    });
  },
  json: function(prompt, opts){
    opts = opts || {};
    var file = opts.images;
    if (Array.isArray(file)) file = file[0];
    if (!file) return Promise.reject({ code: "no_image" });
    return shrink(file).then(blobToDataUrl).then(function(dataUrl){
      var m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
      if (!m) throw { code: "bad_image" };
      return api("/api/read-poster",
        { prompt: prompt, mediaType: m[1], data: m[2] },
        { signal: opts.signal });
    }).then(function(j){ return j.result; });
  }
};

function blobToDataUrl(b){
  return new Promise(function(res, rej){
    var fr = new FileReader();
    fr.onload = function(){ res(fr.result); };
    fr.onerror = function(){ rej({ code: "read_failed" }); };
    fr.readAsDataURL(b);
  });
}

var NS = { db: DB, assets: ASSETS, sample: SAMPLE };

window.claude = {
  use: function(name){
    return Promise.resolve(NS[name] || null);
  }
};
})();
