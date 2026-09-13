/* Passcode gate. The shell itself holds nothing private — every
   personal record comes from /api, which 401s without the cookie —
   so this is the front door, not the lock. The lock is server-side.
   One entry per device: the cookie lasts a year, which is what makes
   this survive a cold start on the home screen. */
(function(){
"use strict";

var shown = false;

function css(){
  if (document.getElementById("gate-css")) return;
  var s = document.createElement("style");
  s.id = "gate-css";
  s.textContent = [
    ".gate{position:fixed;inset:0;z-index:200;background:var(--ground,#E7E8E4);",
      "display:flex;align-items:center;justify-content:center;padding:24px;",
      "padding-bottom:calc(24px + env(safe-area-inset-bottom))}",
    ".gate-box{width:100%;max-width:340px;display:flex;flex-direction:column;gap:14px}",
    ".gate-box h2{margin:0;font-family:Archivo,Helvetica Neue,Arial,sans-serif;",
      "font-variation-settings:'wdth' 112,'wght' 800;font-size:26px;line-height:1;",
      "letter-spacing:-.015em;text-transform:uppercase;color:var(--ink,#1A201E)}",
    ".gate-box p{margin:0;font-size:14.5px;color:var(--ink-2,#4C5551);line-height:1.45}",
    ".gate-box input{width:100%;box-sizing:border-box;background:var(--surface,#fff);",
      "color:var(--ink,#1A201E);border:1px solid var(--line,#CDD0C8);border-radius:3px;",
      "padding:11px 12px;font-family:IBM Plex Mono,ui-monospace,monospace;font-size:16px}",
    ".gate-box button{appearance:none;cursor:pointer;border-radius:3px;padding:11px 14px;",
      "background:var(--accent,#1F6F5C);border:1px solid var(--accent,#1F6F5C);",
      "color:var(--on-accent,#fff);font-family:Archivo,Helvetica Neue,Arial,sans-serif;",
      "font-variation-settings:'wdth' 86,'wght' 700;font-size:11.5px;letter-spacing:.08em;",
      "text-transform:uppercase}",
    ".gate-box button:disabled{opacity:.5;cursor:not-allowed}",
    ".gate-err{color:var(--brick,#A6402F);font-size:13.5px;min-height:1.3em}"
  ].join("");
  document.head.appendChild(s);
}

function show(){
  if (shown) return;
  shown = true;
  css();

  var el = document.createElement("div");
  el.className = "gate";
  el.innerHTML =
    '<form class="gate-box" autocomplete="on">' +
      '<h2>The Weekend Board</h2>' +
      '<p>Enter the passcode to load your picks, posters and plans. This device stays signed in.</p>' +
      '<input type="password" id="gate-pass" name="password" autocomplete="current-password" ' +
        'inputmode="text" placeholder="Passcode" aria-label="Passcode">' +
      '<button type="submit" id="gate-go">Unlock</button>' +
      '<span class="gate-err" id="gate-err" role="alert"></span>' +
    '</form>';
  document.body.appendChild(el);

  var input = el.querySelector("#gate-pass");
  var btn = el.querySelector("#gate-go");
  var err = el.querySelector("#gate-err");
  setTimeout(function(){ try { input.focus(); } catch(e){} }, 60);

  el.querySelector("form").addEventListener("submit", function(ev){
    ev.preventDefault();
    var v = input.value.trim();
    if (!v) return;
    btn.disabled = true; err.textContent = "";
    fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ passcode: v })
    }).then(function(r){
      if (r.ok) { location.reload(); return; }
      return r.json().catch(function(){ return {}; }).then(function(j){
        err.textContent = j.error || "That didn't work.";
        btn.disabled = false;
        input.select();
      });
    }).catch(function(){
      err.textContent = "Couldn't reach the server. Check your connection.";
      btn.disabled = false;
    });
  });
}

window.addEventListener("board:unauthenticated", show);

fetch("/api/session", { credentials: "same-origin" })
  .then(function(r){ return r.json(); })
  .then(function(j){ if (!j || !j.authed) show(); })
  .catch(function(){ /* offline: let the cached board show what it has */ });
})();
