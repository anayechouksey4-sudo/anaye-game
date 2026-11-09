/* SquadHQ owner's console (admin.html). Plain script, no dependencies, no build step.
 *
 * Talks to the relay's admin API (/admin/api/ on the relay's https origin):
 *   POST login {key, idToken?} → {session, expiresAt, maxExpiresAt, mode, warning?, lastLockout?}
 *   GET stats · GET rooms · GET audit · POST rooms/:code/close · POST rooms/:code/remove {memberId}
 *   POST announce {text, minutes} · POST announce/clear · POST settings {newRoomsAllowed} · POST logout
 *
 * Safety rules this file keeps:
 *   - every string that comes from the relay or from Google is shown with textContent (never as markup);
 *   - the session lives in sessionStorage (this tab only); the admin key is never stored anywhere and the
 *     field is emptied after each attempt; the Google ID token stays in memory and is dropped after login;
 *   - nothing is sent anywhere but the relay the owner picked (and Google's sign-in script when configured).
 */
(function () {
  'use strict';

  var CONFIG = window.SQUADHQ_ADMIN_CONFIG || {};
  var STORE_KEY = 'squadhq.console.session.v1';
  var POLL_MS = 5000;
  var REQUEST_TIMEOUT_MS = 30000;
  /** The free hosting plan sleeps: the first request can take most of a minute while it wakes up. */
  var WAKE_TIMEOUT_MS = 90000;
  var ARM_MS = 4000;
  /** A second tap sooner than this after arming is ignored (a bounce, not a decision). */
  var ARM_MIN_GAP_MS = 350;
  var ANNOUNCE_MAX = 120;
  /** The relay's sliding session length: a fresh login's expiresAt is this long after the relay's "now". */
  var SESSION_IDLE_MS = 30 * 60000;
  var SESSION_RE = /^[A-Za-z0-9_-]{43}$/;
  var CLIENT_ID_RE = /^[A-Za-z0-9._-]{1,200}$/;
  var JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  var ROOM_CODE_RE = /^[A-Z]{4}$/;
  var MEMBER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
  var LOOPBACK = { localhost: true, '127.0.0.1': true, '[::1]': true };
  var CONTROL_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

  var $ = function (id) {
    return document.getElementById(id);
  };

  // ── Never inside a frame ───────────────────────────────────────────────────
  // (A <meta> policy cannot forbid framing, so the page refuses to run in one.)
  var framed = true;
  try {
    framed = window.top !== window.self;
  } catch (e) {
    framed = true;
  }
  if (framed) {
    $('framed').hidden = false;
    return;
  }

  // ── Elements ───────────────────────────────────────────────────────────────
  var ui = {
    loginView: $('login-view'),
    loginForm: $('login-form'),
    relayBox: $('relay-box'),
    relayHost: $('relay-host'),
    relayStatus: $('relay-status'),
    relayInput: $('relay-input'),
    relayUse: $('relay-use'),
    relayReset: $('relay-reset'),
    googleBox: $('google-box'),
    googleButton: $('google-button'),
    googleSigned: $('google-signed'),
    googleName: $('google-name'),
    googleSwitch: $('google-switch'),
    googleNote: $('google-note'),
    keyStep: $('key-step'),
    keyInput: $('key-input'),
    loginButton: $('login-button'),
    loginError: $('login-error'),
    loginInfo: $('login-info'),

    dashView: $('dash-view'),
    dashRelay: $('dash-relay'),
    dashMode: $('dash-mode'),
    dashSession: $('dash-session'),
    logoutButton: $('logout-button'),
    notices: $('dash-notices'),
    nOnline: $('n-online'),
    nInRooms: $('n-inrooms'),
    nRaces: $('n-races'),
    nPeak: $('n-peak'),
    minis: $('minis'),
    liveState: $('live-state'),
    refreshButton: $('refresh-button'),
    statsNote: $('stats-note'),
    roomsCount: $('rooms-count'),
    roomsEmpty: $('rooms-empty'),
    roomsList: $('rooms-list'),
    countriesList: $('countries-list'),
    countriesEmpty: $('countries-empty'),
    mapsList: $('maps-list'),
    mapsEmpty: $('maps-empty'),
    carsList: $('cars-list'),
    carsEmpty: $('cars-empty'),
    announceCurrent: $('announce-current'),
    announceCurrentText: $('announce-current-text'),
    announceCurrentLeft: $('announce-current-left'),
    announceClear: $('announce-clear'),
    announceForm: $('announce-form'),
    announceText: $('announce-text'),
    announceCount: $('announce-count'),
    announceSend: $('announce-send'),
    newRoomsSwitch: $('newrooms-switch'),
    newRoomsLabel: $('newrooms-label'),
    relayFacts: $('relay-facts'),
    labelsBox: $('labels-box'),
    labelsList: $('labels-list'),
    auditBox: $('audit-box'),
    auditList: $('audit-list'),
    auditEmpty: $('audit-empty'),
    toast: $('toast'),
  };
  ui.mapsList.classList.add('bars--maps');
  ui.carsList.classList.add('bars--cars');

  // ── State ──────────────────────────────────────────────────────────────────
  var state = {
    /** http(s) origin of the relay the login form talks to. */
    relay: '',
    /** {token, relay, expiresAt, maxExpiresAt, mode, warning, lastLockout, offsetMs} while logged in. */
    session: null,
    /** Relay clock minus this device's clock (from stats.now), so relay times convert to local ones. */
    offsetMs: 0,
    pollTimer: 0,
    expiryTimer: 0,
    tickTimer: 0,
    inflight: false,
    lastOkAt: 0,
    stats: null,
    newRoomsAllowed: true,
    settingsBusy: false,
    announce: null,
    armed: null,
    loginBusy: false,
    retryUntil: 0,
    retryTimer: 0,
    retryMessage: '',
    idToken: null,
    googleExp: 0,
    googleReady: false,
    googleLoading: false,
    lastCspBlock: '',
    toastTimer: 0,
    labelsShown: '',
  };

  // ── Small helpers ──────────────────────────────────────────────────────────

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function num(value) {
    return typeof value === 'number' && isFinite(value) ? value : null;
  }

  function fmtInt(value) {
    var n = num(value);
    return n === null ? '—' : Math.round(n).toLocaleString('en-US');
  }

  function str(value, max) {
    if (typeof value !== 'string') return '';
    var cleaned = value.replace(CONTROL_RE, ' ');
    var chars = Array.from(cleaned);
    return chars.length > (max || 200) ? chars.slice(0, max || 200).join('') + '…' : cleaned;
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function fmtClock(totalSec) {
    var s = Math.max(0, Math.ceil(totalSec));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return h > 0 ? h + ':' + pad(m) + ':' + pad(sec) : m + ':' + pad(sec);
  }

  function fmtDuration(totalSec) {
    var s = num(totalSec);
    if (s === null) return '—';
    s = Math.max(0, Math.floor(s));
    if (s < 60) return s + ' S';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' MIN';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' H ' + (m % 60) + ' MIN';
    return Math.floor(h / 24) + ' D ' + (h % 24) + ' H';
  }

  function fmtAge(ageSec) {
    var s = num(ageSec);
    if (s === null) return '';
    if (s < 60) return 'JUST OPENED';
    return fmtDuration(s) + ' OLD';
  }

  /** A relay timestamp (ms) as this device's local time. */
  function localTime(relayMs, withSeconds) {
    var n = num(relayMs);
    if (n === null) return '—';
    var d = new Date(n - state.offsetMs);
    var today = new Date();
    var time = pad(d.getHours()) + ':' + pad(d.getMinutes()) + (withSeconds ? ':' + pad(d.getSeconds()) : '');
    var sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    return sameDay ? time : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + time;
  }

  function fmtMb(bytes) {
    var n = num(bytes);
    return n === null ? '—' : (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0) + ' MB';
  }

  function relayNow() {
    return Date.now() + state.offsetMs;
  }

  function hostOf(origin) {
    try {
      return new URL(origin).host;
    } catch (e) {
      return '';
    }
  }

  function upperId(id) {
    return str(id, 40).replace(/[_-]+/g, ' ').toUpperCase();
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /**
   * The relay address the owner typed → its http(s) origin. wss:// and ws:// map to https:// and http://;
   * plain http is only for a relay on this computer (the key must never cross the network unencrypted).
   */
  function normalizeRelay(input) {
    var text = String(input === undefined || input === null ? '' : input).trim();
    if (!text) return { error: 'Type the relay address.' };
    var hasScheme = SCHEME_RE.test(text);
    var url;
    try {
      url = new URL(hasScheme ? text : 'https://' + text);
    } catch (e) {
      return { error: 'That relay address is not a web address.' };
    }
    var loopback = LOOPBACK[url.hostname] === true;
    var protocol = url.protocol;
    if (!hasScheme && loopback) protocol = 'http:';
    if (protocol === 'wss:') protocol = 'https:';
    else if (protocol === 'ws:') protocol = 'http:';
    if (protocol !== 'https:' && protocol !== 'http:') return { error: 'Use an https:// (or wss://) relay address.' };
    if (url.username || url.password) return { error: 'Leave any user name or password out of the relay address.' };
    if (protocol === 'http:' && !loopback) return { error: 'The relay address must use https (plain http only for a relay on this computer).' };
    return { origin: protocol + '//' + url.host };
  }

  // ── Session storage (this tab only) ────────────────────────────────────────

  function validLockout(value) {
    if (!isObject(value)) return null;
    var at = num(value.at);
    var until = num(value.until);
    var failures = num(value.failures);
    return at !== null && until !== null && failures !== null ? { at: at, until: until, failures: failures } : null;
  }

  function loadStored() {
    var raw = null;
    try {
      raw = window.sessionStorage.getItem(STORE_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;
    try {
      var s = JSON.parse(raw);
      if (!isObject(s) || typeof s.token !== 'string' || !SESSION_RE.test(s.token)) return null;
      var relay = normalizeRelay(s.relay);
      if (!relay.origin || relay.origin !== s.relay) return null;
      return {
        token: s.token,
        relay: relay.origin,
        expiresAt: num(s.expiresAt) || 0,
        maxExpiresAt: num(s.maxExpiresAt) || 0,
        mode: s.mode === 'two-factor' ? 'two-factor' : 'key-only',
        warning: typeof s.warning === 'string' ? str(s.warning, 300) : null,
        lastLockout: validLockout(s.lastLockout),
        offsetMs: num(s.offsetMs) || 0,
      };
    } catch (e) {
      return null;
    }
  }

  function saveStored() {
    if (!state.session) return;
    try {
      window.sessionStorage.setItem(STORE_KEY, JSON.stringify(state.session));
    } catch (e) {
      /* storage blocked: the session lasts until this page reloads */
    }
  }

  function clearStored() {
    try {
      window.sessionStorage.removeItem(STORE_KEY);
    } catch (e) {
      /* nothing stored */
    }
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────

  document.addEventListener('securitypolicyviolation', function (event) {
    if (event.effectiveDirective === 'connect-src' || event.violatedDirective === 'connect-src') state.lastCspBlock = String(event.blockedURI || '');
  });

  /** One admin API call. Never throws: status 0 = no answer (network, timeout or this page's policy). */
  function request(origin, path, options) {
    var opts = options || {};
    var headers = {};
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    var body;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, opts.timeoutMs || REQUEST_TIMEOUT_MS);
    state.lastCspBlock = '';
    return fetch(origin + '/admin/api/' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: body,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return null;
          })
          .then(function (data) {
            return {
              status: res.status,
              data: isObject(data) ? data : {},
              expiresAt: Number(res.headers.get('X-Session-Expires-At')) || 0,
              retryAfter: Number(res.headers.get('Retry-After')) || 0,
            };
          });
      })
      .catch(function (err) {
        // The policy-violation event arrives as its own task: give it a moment before reading it.
        return sleep(30).then(function () {
          return {
            status: 0,
            data: {},
            expiresAt: 0,
            retryAfter: 0,
            timedOut: !!(err && err.name === 'AbortError'),
            blockedByPolicy: state.lastCspBlock !== '',
          };
        });
      })
      .then(function (result) {
        clearTimeout(timer);
        return result;
      });
  }

  /** An authenticated call with the current session; slides the local expiry from X-Session-Expires-At. */
  function authed(path, options) {
    var session = state.session;
    if (!session) return Promise.resolve({ status: 401, data: {}, expiresAt: 0, retryAfter: 0 });
    var opts = options || {};
    return request(session.relay, path, {
      method: opts.method,
      body: opts.body,
      token: session.token,
      timeoutMs: opts.timeoutMs,
    }).then(function (r) {
      if (state.session === session && r.expiresAt > 0) {
        session.expiresAt = r.expiresAt;
        saveStored();
        scheduleExpiry();
      }
      return r;
    });
  }

  function noAnswerText(r, host) {
    if (r.blockedByPolicy) return 'This copy of the console may only talk to its own relay (' + (hostOf(CONFIG.relay) || 'none set') + ').';
    if (r.timedOut) return 'The relay did not answer in time. It may still be waking up: try again in a minute.';
    return 'Cannot reach the relay at ' + host + '. Check the address and your connection.';
  }

  // ── Views ──────────────────────────────────────────────────────────────────

  function showView(name) {
    ui.loginView.hidden = name !== 'login';
    ui.dashView.hidden = name !== 'dash';
    document.title = name === 'dash' ? 'SquadHQ Console · live' : 'SquadHQ Console';
  }

  function showLoginError(text) {
    ui.loginError.textContent = text;
    ui.loginError.hidden = !text;
  }

  function showLoginInfo(text) {
    ui.loginInfo.textContent = text;
    ui.loginInfo.hidden = !text;
  }

  function setRelay(origin) {
    if (origin !== state.relay) resetRetry();
    state.relay = origin;
    ui.relayInput.value = origin;
    ui.relayHost.textContent = hostOf(origin) || 'NOT SET';
  }

  function showLogin(message, isError) {
    stopDashboard();
    showView('login');
    showLoginError(isError ? message || '' : '');
    showLoginInfo(isError ? '' : message || '');
    setupGoogle();
    pingHealth();
    try {
      ui.keyInput.focus({ preventScroll: true });
    } catch (e) {
      ui.keyInput.focus();
    }
  }

  // ── Relay health (also wakes a sleeping relay before the owner logs in) ───

  var healthSeq = 0;
  function pingHealth() {
    var seq = ++healthSeq;
    var origin = state.relay;
    ui.relayStatus.classList.remove('is-ok', 'is-bad');
    if (!origin) {
      ui.relayStatus.textContent = '';
      return;
    }
    ui.relayStatus.textContent = 'CHECKING…';
    var slow = setTimeout(function () {
      if (seq === healthSeq) ui.relayStatus.textContent = 'WAKING UP…';
    }, 2500);
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, WAKE_TIMEOUT_MS);
    fetch(origin + '/health', {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) {
        return res.ok;
      })
      .catch(function () {
        return false;
      })
      .then(function (ok) {
        clearTimeout(slow);
        clearTimeout(timer);
        if (seq !== healthSeq) return;
        ui.relayStatus.textContent = ok ? 'ONLINE' : 'NOT ANSWERING';
        ui.relayStatus.classList.toggle('is-ok', ok);
        ui.relayStatus.classList.toggle('is-bad', !ok);
      });
  }

  function useTypedRelay() {
    var result = normalizeRelay(ui.relayInput.value);
    if (!result.origin) {
      showLoginError(result.error);
      return null;
    }
    showLoginError('');
    setRelay(result.origin);
    return result.origin;
  }

  // ── Google sign-in (only when a client id is configured) ──────────────────

  var googleClientId = typeof CONFIG.googleClientId === 'string' && CLIENT_ID_RE.test(CONFIG.googleClientId) ? CONFIG.googleClientId : '';

  function setupGoogle() {
    if (!googleClientId) {
      ui.googleBox.hidden = true;
      ui.keyStep.hidden = true;
      return;
    }
    ui.googleBox.hidden = false;
    ui.keyStep.hidden = false;
    showGoogleSignedOut();
    if (state.googleReady) {
      renderGoogleButton();
      return;
    }
    if (state.googleLoading) return;
    state.googleLoading = true;
    var script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = function () {
      state.googleLoading = false;
      var id = window.google && window.google.accounts && window.google.accounts.id;
      if (!id || typeof id.initialize !== 'function') {
        ui.googleNote.textContent = 'Google sign-in did not start. Reload the page to try again.';
        return;
      }
      id.initialize({
        client_id: googleClientId,
        callback: onGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
        context: 'signin',
        ux_mode: 'popup',
        itp_support: true,
      });
      state.googleReady = true;
      renderGoogleButton();
    };
    script.onerror = function () {
      state.googleLoading = false;
      ui.googleNote.textContent = 'Google sign-in could not load (offline or blocked). A relay in key-only mode still lets you in with the key.';
    };
    document.head.appendChild(script);
  }

  function renderGoogleButton() {
    if (!state.googleReady || ui.googleButton.hidden) return;
    clear(ui.googleButton);
    var width = Math.floor(ui.googleButton.getBoundingClientRect().width) || 300;
    window.google.accounts.id.renderButton(ui.googleButton, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
      logo_alignment: 'left',
      width: Math.max(200, Math.min(400, width)),
    });
  }

  function decodeJwtPayload(token) {
    try {
      var part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (part.length % 4) part += '=';
      var binary = atob(part);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var claims = JSON.parse(new TextDecoder().decode(bytes));
      return isObject(claims) ? claims : null;
    } catch (e) {
      return null;
    }
  }

  /** Google hands back an ID token: kept in memory for the login request only (the relay verifies it). */
  function onGoogleCredential(response) {
    var token = response && typeof response.credential === 'string' ? response.credential : '';
    if (!JWT_RE.test(token) || token.length > 4096) {
      ui.googleNote.textContent = 'Google did not return a usable sign-in. Try again.';
      return;
    }
    var claims = decodeJwtPayload(token) || {};
    state.idToken = token;
    state.googleExp = (num(claims.exp) || 0) * 1000;
    // Only the first name is shown (never the email address).
    ui.googleName.textContent = str(claims.given_name, 16).trim() || 'GOOGLE ACCOUNT';
    ui.googleButton.hidden = true;
    ui.googleSigned.hidden = false;
    ui.googleNote.textContent = 'Now type the admin key. The relay accepts the owner\'s account only.';
    showLoginError('');
    ui.keyInput.focus();
  }

  function showGoogleSignedOut() {
    state.idToken = null;
    state.googleExp = 0;
    ui.googleName.textContent = '';
    ui.googleSigned.hidden = true;
    ui.googleButton.hidden = false;
    ui.googleNote.textContent = 'Sign in with the owner\'s Google account first: the relay checks it and the key.';
  }

  function forgetGoogle() {
    showGoogleSignedOut();
    try {
      if (state.googleReady) window.google.accounts.id.disableAutoSelect();
    } catch (e) {
      /* not loaded */
    }
  }

  // ── Login ──────────────────────────────────────────────────────────────────

  function setLoginBusy(busy) {
    state.loginBusy = busy;
    ui.loginButton.disabled = busy || Date.now() < state.retryUntil;
    ui.loginButton.textContent = busy ? 'LOGGING IN…' : 'LOG IN';
    ui.relayUse.disabled = busy;
    ui.relayReset.disabled = busy;
  }

  function resetRetry() {
    state.retryUntil = 0;
    state.retryMessage = '';
    if (state.retryTimer) clearInterval(state.retryTimer);
    state.retryTimer = 0;
    if (!state.loginBusy) {
      ui.loginButton.disabled = false;
      ui.loginButton.textContent = 'LOG IN';
    }
  }

  function startRetryCountdown(seconds, message) {
    state.retryUntil = Date.now() + Math.max(1, seconds) * 1000;
    state.retryMessage = message;
    if (state.retryTimer) clearInterval(state.retryTimer);
    var tick = function () {
      var left = (state.retryUntil - Date.now()) / 1000;
      if (left <= 0) {
        resetRetry();
        showLoginError('');
        showLoginInfo('You can try again now.');
        return;
      }
      ui.loginButton.disabled = true;
      ui.loginButton.textContent = 'WAIT ' + fmtClock(left);
      showLoginError(state.retryMessage + ' Try again in ' + fmtClock(left) + '.');
    };
    state.retryTimer = setInterval(tick, 1000);
    tick();
  }

  function onLoginSubmit(event) {
    event.preventDefault();
    if (state.loginBusy || Date.now() < state.retryUntil) return;
    showLoginInfo('');
    var origin = useTypedRelay();
    if (!origin) return;
    var key = ui.keyInput.value;
    if (!key) {
      showLoginError('Type the admin key.');
      ui.keyInput.focus();
      return;
    }
    if (state.idToken && state.googleExp && state.googleExp < Date.now() + 30000) {
      forgetGoogle();
      renderGoogleButton();
      showLoginError('Your Google sign-in has expired. Sign in with Google again, then log in.');
      return;
    }
    var body = { key: key };
    key = '';
    if (state.idToken) body.idToken = state.idToken;
    setLoginBusy(true);
    showLoginError('');
    var slow = setTimeout(function () {
      showLoginInfo('Waking the relay up… the free plan can take up to a minute.');
    }, 3500);
    var host = hostOf(origin);
    request(origin, 'login', { method: 'POST', body: body, timeoutMs: WAKE_TIMEOUT_MS }).then(function (r) {
      body = null;
      clearTimeout(slow);
      setLoginBusy(false);
      showLoginInfo('');
      // The key never stays on the page once the relay has answered.
      if (r.status !== 0) ui.keyInput.value = '';
      handleLoginResult(r, origin, host);
    });
  }

  function handleLoginResult(r, origin, host) {
    var d = r.data;
    if (r.status === 200) {
      if (typeof d.session !== 'string' || !SESSION_RE.test(d.session)) {
        showLoginError('The relay answered with something that is not a session. Is this the right relay?');
        return;
      }
      var expiresAt = num(d.expiresAt);
      state.session = {
        token: d.session,
        relay: origin,
        // This device's clock may be off: estimate the relay's from the fresh session (refined by every stats.now).
        offsetMs: expiresAt !== null ? expiresAt - SESSION_IDLE_MS - Date.now() : 0,
        expiresAt: expiresAt !== null ? expiresAt : Date.now() + SESSION_IDLE_MS,
        maxExpiresAt: num(d.maxExpiresAt) || 0,
        mode: d.mode === 'two-factor' ? 'two-factor' : 'key-only',
        warning: typeof d.warning === 'string' ? str(d.warning, 300) : null,
        lastLockout: validLockout(d.lastLockout),
      };
      // The Google token has done its job; the relay session replaces it.
      showGoogleSignedOut();
      saveStored();
      enterDashboard();
      return;
    }
    if (r.status === 401) {
      if (!googleClientId) showLoginError('Wrong key (or the relay also wants a Google sign-in this page is not set up for). 5 wrong tries block this network for 15 minutes.');
      else if (state.idToken) showLoginError('Not accepted: the key is wrong, or this Google account is not on the owner list. Both must match.');
      else showLoginError('Not accepted. If this relay uses two-factor login, sign in with Google first, then type the key.');
      ui.keyInput.focus();
      return;
    }
    if (r.status === 429) {
      var seconds = num(d.retryAfterSec) || r.retryAfter || 60;
      if (d.error === 'admin locked') {
        startRetryCountdown(seconds, 'The console is locked for everyone after 20 wrong tries in an hour. You will see when it happened after you log in.');
      } else {
        startRetryCountdown(seconds, 'Too many wrong tries from this network.');
      }
      return;
    }
    if (r.status === 503) {
      showLoginError('The console is not set up on this relay: the owner sets ADMIN_KEY (24 characters or more) in the relay\'s environment settings.');
      return;
    }
    if (r.status === 403) {
      if (d.error === 'https required') showLoginError('This relay accepts the console over https only.');
      else showLoginError('This relay does not accept the console from this page\'s address.');
      return;
    }
    if (r.status === 0) {
      showLoginError(noAnswerText(r, host));
      return;
    }
    if (r.status === 400 || r.status === 413 || r.status === 415) {
      showLoginError('The relay refused the request (' + (str(d.error, 60) || 'bad request') + '). It counts as a failed try.');
      return;
    }
    showLoginError('Unexpected answer from the relay (HTTP ' + r.status + ').');
  }

  // ── Dashboard lifecycle ────────────────────────────────────────────────────

  function enterDashboard() {
    showView('dash');
    resetDashboard();
    state.offsetMs = state.session ? state.session.offsetMs || 0 : 0;
    renderHeader();
    renderNotices();
    scheduleExpiry();
    if (!state.session) return;
    if (state.tickTimer) clearInterval(state.tickTimer);
    state.tickTimer = setInterval(tick, 1000);
    tick();
    refreshNow();
  }

  function stopDashboard() {
    clearTimeout(state.pollTimer);
    clearTimeout(state.expiryTimer);
    if (state.tickTimer) clearInterval(state.tickTimer);
    state.pollTimer = 0;
    state.expiryTimer = 0;
    state.tickTimer = 0;
    disarm();
  }

  /** Ends the session on this device (the relay was told already, or no longer knows it). */
  function endSession(message, isError) {
    state.session = null;
    clearStored();
    stopDashboard();
    resetDashboard();
    forgetGoogle();
    hideToast();
    showLogin(message, isError);
  }

  function expire(message) {
    endSession(message || 'Your session has ended (it expired or was logged out). Log in again.', false);
  }

  function logout() {
    var session = state.session;
    if (!session) return;
    ui.logoutButton.disabled = true;
    request(session.relay, 'logout', { method: 'POST', token: session.token, timeoutMs: 10000 }).then(function (r) {
      ui.logoutButton.disabled = false;
      if (state.session !== session) return;
      if (r.status === 200 || r.status === 401) endSession('Logged out.', false);
      else endSession('Logged out on this device. The relay could not be told, so it forgets the session 30 minutes after its last use.', false);
    });
  }

  function localExpiry() {
    return state.session ? state.session.expiresAt - state.offsetMs : 0;
  }

  /** Auto-logout when the sliding session runs out (re-checked at least once a minute: timers sleep in hidden tabs). */
  function scheduleExpiry() {
    clearTimeout(state.expiryTimer);
    state.expiryTimer = 0;
    if (!state.session) return;
    var left = localExpiry() - Date.now();
    if (left <= 0) {
      expire('Your session expired after 30 minutes without use (or 12 hours in all). Log in again.');
      return;
    }
    state.expiryTimer = setTimeout(scheduleExpiry, Math.min(left + 200, 60000));
  }

  function schedulePoll(delay) {
    clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(pollTick, delay);
  }

  function pollTick() {
    if (!state.session) return;
    if (document.visibilityState === 'hidden') return; // resumes on visibilitychange
    refresh().then(function () {
      if (state.session) schedulePoll(POLL_MS);
    });
  }

  function refreshNow() {
    clearTimeout(state.pollTimer);
    pollTick();
  }

  function refresh() {
    var session = state.session;
    if (!session || state.inflight) return Promise.resolve();
    state.inflight = true;
    var wantAudit = ui.auditBox.open;
    var sentAt = Date.now();
    var calls = [authed('stats'), authed('rooms'), wantAudit ? authed('audit') : Promise.resolve(null)];
    return Promise.all(calls)
      .then(function (results) {
        if (state.session !== session) return;
        var stats = results[0];
        var rooms = results[1];
        var audit = results[2];
        if (stats.status === 401 || rooms.status === 401 || (audit && audit.status === 401)) {
          expire('Your session has ended (it expired, was logged out, or the relay restarted). Log in again.');
          return;
        }
        if (stats.status === 200) {
          var relayMs = num(stats.data.now);
          if (relayMs !== null) {
            state.offsetMs = relayMs - Math.round((sentAt + Date.now()) / 2);
            session.offsetMs = state.offsetMs;
            saveStored();
          }
          renderStats(stats.data);
        }
        if (rooms.status === 200) renderRooms(rooms.data);
        if (audit && audit.status === 200) renderAudit(audit.data);
        var ok = stats.status === 200 && rooms.status === 200;
        if (ok) state.lastOkAt = Date.now();
        setLive(ok, ok ? '' : stats.status === 0 ? noAnswerText(stats, hostOf(session.relay)) : 'HTTP ' + stats.status);
        scheduleExpiry();
      })
      .then(
        function () {
          state.inflight = false;
        },
        function () {
          state.inflight = false;
        },
      );
  }

  function setLive(ok, problem) {
    ui.liveState.classList.toggle('is-ok', ok);
    ui.liveState.classList.toggle('is-bad', !ok);
    var last = state.lastOkAt ? pad(new Date(state.lastOkAt).getHours()) + ':' + pad(new Date(state.lastOkAt).getMinutes()) + ':' + pad(new Date(state.lastOkAt).getSeconds()) : '';
    ui.liveState.textContent = ok ? 'LIVE · UPDATED ' + last + ' · EVERY 5 S' : 'NOT UPDATING' + (last ? ' (LAST ' + last + ')' : '') + ': ' + problem;
  }

  /** Once a second: the session clock and the banner's time left. */
  function tick() {
    if (!state.session) return;
    var left = (localExpiry() - Date.now()) / 1000;
    ui.dashSession.textContent = 'SESSION ' + fmtClock(left);
    renderAnnounceLeft();
  }

  // ── Rendering: header and notices ──────────────────────────────────────────

  function renderHeader() {
    var s = state.session;
    if (!s) return;
    ui.dashRelay.textContent = hostOf(s.relay);
    ui.dashMode.textContent = s.mode === 'two-factor' ? 'TWO-FACTOR' : 'KEY ONLY';
    ui.dashMode.className = 'chip ' + (s.mode === 'two-factor' ? 'chip--ok' : 'chip--warn');
  }

  function noticeNode(spec) {
    var p = el('div', 'notice' + (spec.kind ? ' notice--' + spec.kind : ''));
    p.setAttribute('role', spec.kind === 'error' ? 'alert' : 'status');
    var span = el('span');
    span.appendChild(el('b', null, spec.title));
    span.appendChild(document.createTextNode(' ' + spec.text));
    p.appendChild(span);
    if (spec.dismiss) {
      var close = el('button', 'btn btn--ghost btn--small', 'OK');
      close.type = 'button';
      close.setAttribute('aria-label', 'Dismiss: ' + spec.title);
      close.addEventListener('click', spec.dismiss);
      p.appendChild(close);
    }
    return p;
  }

  /** Rebuilt only when the wording changes, so a dismiss button is never swapped out under a finger. */
  function renderNotices() {
    var s = state.session;
    var specs = [];
    if (s) {
      var admin = state.stats && isObject(state.stats.admin) ? state.stats.admin : {};
      var warning = s.warning || (typeof admin.warning === 'string' ? str(admin.warning, 300) : '');
      if (s.mode !== 'two-factor' && warning) specs.push({ kind: 'warn', title: 'KEY-ONLY LOGIN.', text: warning });
      if (s.lastLockout) {
        var lo = s.lastLockout;
        specs.push({
          kind: 'error',
          title: 'LOGIN WAS LOCKED.',
          text: fmtInt(lo.failures) + ' failed logins in an hour locked the console for everyone from ' + localTime(lo.at) + ' to ' + localTime(lo.until) + '. If that was not you, choose a new ADMIN_KEY.',
          dismiss: function () {
            if (!state.session) return;
            state.session.lastLockout = null;
            saveStored();
            renderNotices();
          },
        });
      }
      var lockedUntil = num(admin.lockedUntil);
      if (lockedUntil !== null && lockedUntil > relayNow()) {
        specs.push({ kind: 'error', title: 'LOGIN IS LOCKED', text: 'for everyone until ' + localTime(lockedUntil) + ' after too many failed logins. This session keeps working.' });
      }
    }
    var signature = JSON.stringify(specs);
    if (signature === ui.notices.dataset.sig) return;
    ui.notices.dataset.sig = signature;
    clear(ui.notices);
    for (var i = 0; i < specs.length; i++) ui.notices.appendChild(noticeNode(specs[i]));
  }

  // ── Rendering: keyed lists (buttons survive the 5-second refresh) ─────────

  function reconcile(parent, items, keyOf, create, update) {
    var existing = Object.create(null);
    var child = parent.firstElementChild;
    while (child) {
      existing[child.dataset.key] = child;
      child = child.nextElementSibling;
    }
    var prev = null;
    for (var i = 0; i < items.length; i++) {
      var key = keyOf(items[i]);
      var node = key in existing ? existing[key] : null;
      if (node) delete existing[key];
      else {
        node = create(items[i]);
        node.dataset.key = key;
      }
      update(node, items[i]);
      var want = prev ? prev.nextElementSibling : parent.firstElementChild;
      if (node !== want) parent.insertBefore(node, want);
      prev = node;
    }
    Object.keys(existing).forEach(function (k) {
      if (state.armed && existing[k].contains(state.armed.button)) disarm();
      parent.removeChild(existing[k]);
    });
  }

  function setText(node, text) {
    var value = String(text);
    if (node.textContent !== value) node.textContent = value;
  }

  // ── Rendering: stats ───────────────────────────────────────────────────────

  var MINI_DEFS = [
    ['signedIn', 'SIGNED IN', function (d) { return d.online && d.online.signedIn; }],
    ['rooms', 'ROOMS OPEN', function (d) { return d.rooms && d.rooms.total; }],
    ['away', 'AWAY (SEAT KEPT)', function (d) { return d.rooms && d.rooms.away; }],
    ['sessionsToday', 'SESSIONS TODAY', function (d) { return d.sessions && d.sessions.today; }],
    ['racesToday', 'RACES DONE TODAY', function (d) { return d.races && d.races.finishedToday; }],
    ['peakAll', 'PEAK SINCE START', function (d) { return d.peak && d.peak.sinceStart; }],
    ['dashboards', 'DASHBOARDS', function (d) { return d.online && d.online.dashboards; }],
    ['sioRooms', 'SIGNED-IN ROOMS', function (d) { return d.rooms && d.rooms.signedInOnly; }],
  ];

  var LABEL_NAMES = {
    'online.players': 'PLAYERS ONLINE',
    'online.dashboards': 'DASHBOARDS',
    'online.observers': 'OTHER CONNECTIONS',
    'online.signedIn': 'SIGNED IN',
    'rooms.playersInRooms': 'IN ROOMS',
    'rooms.racesRunning': 'RACES RUNNING',
    'peak.today': 'PEAK TODAY',
    'peak.sinceStart': 'PEAK SINCE START',
    'sessions.today': 'SESSIONS TODAY',
    'sessions.sinceStart': 'SESSIONS SINCE START',
    'races.finishedToday': 'RACES DONE TODAY',
    countries: 'COUNTRIES',
  };

  function renderStats(d) {
    state.stats = d;
    var online = isObject(d.online) ? d.online : {};
    var rooms = isObject(d.rooms) ? d.rooms : {};
    var peak = isObject(d.peak) ? d.peak : {};
    setText(ui.nOnline, fmtInt(online.players));
    setText(ui.nInRooms, fmtInt(rooms.playersInRooms));
    setText(ui.nRaces, fmtInt(rooms.racesRunning));
    setText(ui.nPeak, fmtInt(peak.today));

    reconcile(
      ui.minis,
      MINI_DEFS,
      function (def) {
        return def[0];
      },
      function (def) {
        var li = el('li', 'mini');
        li.appendChild(el('b', null, '—'));
        li.appendChild(el('span', null, def[1]));
        return li;
      },
      function (li, def) {
        setText(li.firstChild, fmtInt(def[2](d)));
      },
    );

    setText(ui.statsNote, str(d.note, 400) || 'Counts reset when the relay restarts; offline players are not counted.');

    renderCountries(d);
    renderBars(ui.mapsList, ui.mapsEmpty, d.maps, num(d.mapsOther) || 0, 'OTHER MAPS');
    renderBars(ui.carsList, ui.carsEmpty, d.cars, num(d.carsOther) || 0, 'OTHER CARS');
    if (isObject(d.settings)) renderSettings(d.settings);
    renderAnnounce(d.announce);
    renderRelayFacts(d);
    renderLabels(d.labels);
    renderNotices();
  }

  function flagHue(code) {
    return ((code.charCodeAt(0) - 65) * 37 + (code.charCodeAt(1) - 65) * 11) % 360;
  }

  function barNode() {
    var li = el('li', 'bar');
    var flag = el('span', 'flag');
    flag.setAttribute('aria-hidden', 'true');
    var body = el('span', 'bar__body');
    var name = el('span', 'bar__name');
    var track = el('span', 'bar__track');
    var fill = el('span', 'bar__fill');
    track.appendChild(fill);
    body.appendChild(name);
    body.appendChild(track);
    var n = el('b', 'bar__n');
    li.appendChild(flag);
    li.appendChild(body);
    li.appendChild(n);
    li._refs = { flag: flag, name: name, fill: fill, n: n };
    return li;
  }

  function renderCountries(d) {
    var rows = [];
    var list = Array.isArray(d.countries) ? d.countries : [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!isObject(c) || typeof c.code !== 'string' || !/^[A-Z]{2}$/.test(c.code)) continue;
      rows.push({ key: c.code, code: c.code, name: str(c.name, 60) || c.code, players: num(c.players) || 0 });
    }
    var other = num(d.countriesOther) || 0;
    var unknown = num(d.countriesUnknown) || 0;
    if (other > 0) rows.push({ key: '~other', code: '+', name: 'OTHER COUNTRIES', players: other, muted: true });
    if (unknown > 0) rows.push({ key: '~unknown', code: '??', name: 'UNKNOWN (NO TIME ZONE SENT)', players: unknown, muted: true });
    var max = rows.reduce(function (m, r) {
      return Math.max(m, r.players);
    }, 0);
    ui.countriesEmpty.hidden = rows.length > 0;
    reconcile(
      ui.countriesList,
      rows,
      function (r) {
        return r.key;
      },
      barNode,
      function (li, r) {
        var refs = li._refs;
        setText(refs.flag, r.code);
        refs.flag.classList.toggle('flag--none', !!r.muted);
        if (!r.muted) refs.flag.style.setProperty('--h', String(flagHue(r.code)));
        setText(refs.name, r.name);
        li.title = r.muted ? r.name : r.code + ' · ' + r.name;
        li.classList.toggle('is-muted', !!r.muted);
        refs.fill.style.setProperty('--w', (max > 0 ? Math.round((r.players / max) * 100) : 0) + '%');
        setText(refs.n, fmtInt(r.players));
      },
    );
  }

  function renderBars(list, empty, entries, other, otherLabel) {
    var rows = [];
    var items = Array.isArray(entries) ? entries : [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!isObject(it) || typeof it.id !== 'string' || !it.id) continue;
      rows.push({ key: 'id:' + it.id, name: upperId(it.id), players: num(it.players) || 0 });
    }
    if (other > 0) rows.push({ key: '~other', name: otherLabel, players: other, muted: true });
    var max = rows.reduce(function (m, r) {
      return Math.max(m, r.players);
    }, 0);
    empty.hidden = rows.length > 0;
    reconcile(
      list,
      rows,
      function (r) {
        return r.key;
      },
      function () {
        var li = barNode();
        li._refs.flag.remove();
        return li;
      },
      function (li, r) {
        setText(li._refs.name, r.name);
        li.classList.toggle('is-muted', !!r.muted);
        li._refs.fill.style.setProperty('--w', (max > 0 ? Math.round((r.players / max) * 100) : 0) + '%');
        setText(li._refs.n, fmtInt(r.players));
      },
    );
  }

  function renderRelayFacts(d) {
    var admin = isObject(d.admin) ? d.admin : {};
    var memory = isObject(d.memory) ? d.memory : {};
    var peak = isObject(d.peak) ? d.peak : {};
    var sessions = isObject(d.sessions) ? d.sessions : {};
    var races = isObject(d.races) ? d.races : {};
    var lastLockout = validLockout(admin.lastLockout);
    var lockedUntil = num(admin.lockedUntil);
    var facts = [
      ['UP FOR', fmtDuration(d.uptimeSec)],
      ['STARTED', localTime(d.startedAt)],
      ['VERSION', str(d.version, 64) || 'unknown'],
      ['MEMORY', fmtMb(memory.rss) + ' (HEAP ' + fmtMb(memory.heapUsed) + ' / ' + fmtMb(memory.heapTotal) + ')'],
      ['PLAYER SIGN-IN', d.signIn === true ? 'GOOGLE ON' : 'OFF'],
      ['CONSOLE LOGIN', admin.mode === 'two-factor' ? 'TWO-FACTOR' : 'KEY ONLY'],
      ['CONSOLE SESSIONS', fmtInt(admin.sessions)],
      ['FAILED LOGINS (1 H)', fmtInt(admin.failedLoginsLastHour)],
      ['BLOCKED TRIES', fmtInt(admin.blockedAttempts)],
      ['LOGIN LOCK', lockedUntil !== null && lockedUntil > relayNow() ? 'UNTIL ' + localTime(lockedUntil) : 'NOT LOCKED'],
      ['LAST LOCKOUT', lastLockout ? localTime(lastLockout.at) + ' → ' + localTime(lastLockout.until) + ' (' + fmtInt(lastLockout.failures) + ' FAILS)' : 'NONE'],
      ['PEAK SINCE START', fmtInt(peak.sinceStart) + (num(peak.sinceStartAt) !== null ? ' AT ' + localTime(peak.sinceStartAt) : '')],
      ['SESSIONS SINCE START', fmtInt(sessions.sinceStart)],
      ['RACES SINCE START', fmtInt(races.finishedSinceStart)],
      ['TODAY (UTC)', str(peak.day, 12) || '—'],
    ];
    reconcile(
      ui.relayFacts,
      facts,
      function (f) {
        return f[0];
      },
      function (f) {
        var wrap = el('div', 'facts__row');
        wrap.appendChild(el('dt', null, f[0]));
        wrap.appendChild(el('dd'));
        return wrap;
      },
      function (wrap, f) {
        setText(wrap.lastChild, f[1]);
      },
    );
  }

  function renderLabels(labels) {
    if (!isObject(labels)) return;
    var keys = Object.keys(labels).filter(function (k) {
      return typeof labels[k] === 'string';
    });
    var signature = keys
      .map(function (k) {
        return k + '=' + labels[k];
      })
      .join('\n');
    if (signature === state.labelsShown) return;
    state.labelsShown = signature;
    clear(ui.labelsList);
    for (var i = 0; i < keys.length && i < 40; i++) {
      ui.labelsList.appendChild(el('dt', null, LABEL_NAMES[keys[i]] || str(keys[i], 40).toUpperCase()));
      ui.labelsList.appendChild(el('dd', null, str(labels[keys[i]], 300)));
    }
  }

  // ── Rendering: rooms ───────────────────────────────────────────────────────

  function renderRooms(d) {
    var list = Array.isArray(d.rooms) ? d.rooms : [];
    var rooms = list.filter(function (r) {
      return isObject(r) && typeof r.code === 'string' && ROOM_CODE_RE.test(r.code);
    });
    setText(ui.roomsCount, String(rooms.length));
    ui.roomsEmpty.hidden = rooms.length > 0;
    reconcile(
      ui.roomsList,
      rooms,
      function (r) {
        return r.code;
      },
      createRoomCard,
      updateRoomCard,
    );
    if (isObject(d.settings)) renderSettings(d.settings);
  }

  function createRoomCard(room) {
    var code = room.code;
    var card = el('article', 'room');
    card.setAttribute('aria-label', 'Room ' + code);
    var head = el('header', 'room__head');
    var codeEl = el('b', 'room__code', code);
    var phase = el('span', 'phase');
    var lock = el('span', 'tag tag--lock', 'SIGNED-IN ONLY');
    var meta = el('span', 'room__meta');
    head.appendChild(codeEl);
    head.appendChild(phase);
    head.appendChild(lock);
    head.appendChild(meta);
    var members = el('ul', 'members');
    var close = el('button', 'btn btn--danger', 'CLOSE ROOM');
    close.type = 'button';
    close.addEventListener('click', function () {
      armOrRun('close:' + code, close, 'TAP AGAIN TO CLOSE ' + code, function () {
        closeRoom(code, close);
      });
    });
    card.appendChild(head);
    card.appendChild(members);
    card.appendChild(close);
    card._refs = { phase: phase, lock: lock, meta: meta, members: members, close: close };
    return card;
  }

  function updateRoomCard(card, room) {
    var refs = card._refs;
    var phase = typeof room.phase === 'string' && /^(lobby|countdown|racing|results)$/.test(room.phase) ? room.phase : 'lobby';
    setText(refs.phase, phase.toUpperCase());
    refs.phase.className = 'phase phase--' + phase;
    refs.lock.hidden = room.signedInOnly !== true;
    var players = num(room.players);
    var size = num(room.size);
    var bits = [fmtInt(players) + (size !== null ? ' / ' + fmtInt(size) : '') + ' PLAYERS'];
    bits.push(typeof room.map === 'string' && room.map ? upperId(room.map) : 'NO MAP YET');
    var age = fmtAge(room.ageSec);
    if (age) bits.push(age);
    setText(refs.meta, bits.join(' · '));
    var members = (Array.isArray(room.members) ? room.members : []).filter(function (m) {
      return isObject(m) && typeof m.id === 'string' && MEMBER_ID_RE.test(m.id);
    });
    reconcile(
      refs.members,
      members,
      function (m) {
        return m.id;
      },
      function (m) {
        return createMemberRow(room.code, m.id);
      },
      updateMemberRow,
    );
  }

  function createMemberRow(code, memberId) {
    var li = el('li', 'member');
    var flag = el('span', 'flag');
    var who = el('span', 'member__who');
    var name = el('b', 'member__name');
    var tags = el('span', 'member__tags');
    who.appendChild(name);
    who.appendChild(tags);
    var remove = el('button', 'btn btn--danger btn--small', 'REMOVE');
    remove.type = 'button';
    remove.addEventListener('click', function () {
      armOrRun('remove:' + code + ':' + memberId, remove, 'TAP AGAIN', function () {
        removePlayer(code, memberId, li._name || 'the player', remove);
      });
    });
    li.appendChild(flag);
    li.appendChild(who);
    li.appendChild(remove);
    li._refs = { flag: flag, name: name, tags: tags, remove: remove };
    return li;
  }

  function updateMemberRow(li, m) {
    var refs = li._refs;
    var name = str(m.name, 40) || 'PLAYER';
    li._name = name;
    setText(refs.name, name);
    var country = typeof m.country === 'string' && /^[A-Z]{2}$/.test(m.country) ? m.country : '';
    setText(refs.flag, country || '··');
    refs.flag.classList.toggle('flag--none', !country);
    refs.flag.title = country ? 'Country (from the time zone): ' + country : 'Country unknown';
    if (country) refs.flag.style.setProperty('--h', String(flagHue(country)));
    if (!(state.armed && state.armed.button === refs.remove)) refs.remove.setAttribute('aria-label', 'Remove ' + name);
    var tagList = [];
    if (m.host === true) tagList.push(['HOST', 'tag tag--host']);
    if (m.verified === true) tagList.push(['✓ ' + (str(m.givenName, 16) || 'SIGNED IN'), 'tag tag--ok']);
    if (typeof m.car === 'string' && m.car) tagList.push([upperId(m.car), 'tag']);
    if (m.away === true) tagList.push(['AWAY', 'tag tag--away']);
    var signature = JSON.stringify(tagList);
    if (refs.tags.dataset.sig !== signature) {
      refs.tags.dataset.sig = signature;
      clear(refs.tags);
      for (var i = 0; i < tagList.length; i++) refs.tags.appendChild(el('span', tagList[i][1], tagList[i][0]));
    }
  }

  // ── Rendering: settings, announce, audit ───────────────────────────────────

  function renderSettings(settings) {
    if (typeof settings.newRoomsAllowed !== 'boolean' || state.settingsBusy) return;
    state.newRoomsAllowed = settings.newRoomsAllowed;
    ui.newRoomsSwitch.setAttribute('aria-checked', settings.newRoomsAllowed ? 'true' : 'false');
    setText(ui.newRoomsLabel, settings.newRoomsAllowed ? 'ON · ANYONE CAN OPEN A ROOM' : 'OFF · NEW ROOMS PAUSED');
  }

  function renderAnnounce(announce) {
    if (isObject(announce) && typeof announce.text === 'string' && num(announce.until) !== null) {
      state.announce = { id: str(announce.id, 40), text: str(announce.text, 200), until: announce.until };
    } else {
      state.announce = null;
    }
    ui.announceCurrent.hidden = !state.announce;
    if (state.announce) setText(ui.announceCurrentText, state.announce.text);
    renderAnnounceLeft();
  }

  function renderAnnounceLeft() {
    if (!state.announce) return;
    var left = (state.announce.until - relayNow()) / 1000;
    if (left <= 0) {
      state.announce = null;
      ui.announceCurrent.hidden = true;
      return;
    }
    setText(ui.announceCurrentLeft, fmtClock(left) + ' LEFT');
  }

  var AUDIT_NAMES = {
    login: 'LOGIN',
    logout: 'LOGOUT',
    lockout: 'LOCKOUT',
    'close-room': 'CLOSE ROOM',
    'remove-player': 'REMOVE PLAYER',
    announce: 'ANNOUNCE',
    'announce-clear': 'HIDE BANNER',
    settings: 'NEW ROOMS',
  };

  function renderAudit(d) {
    var entries = Array.isArray(d.entries) ? d.entries.slice(0, 200) : [];
    ui.auditEmpty.hidden = entries.length > 0;
    clear(ui.auditList);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!isObject(e)) continue;
      var li = el('li', e.ok === true ? '' : 'is-fail');
      li.appendChild(el('span', 'audit__time', localTime(e.at, true)));
      var action = typeof e.action === 'string' ? e.action : '';
      li.appendChild(el('span', 'audit__action', AUDIT_NAMES[action] || str(action, 40).toUpperCase() || '—'));
      li.appendChild(el('span', 'audit__ok', e.ok === true ? 'OK' : 'FAILED'));
      if (typeof e.detail === 'string' && e.detail) li.appendChild(el('span', 'audit__detail', str(e.detail, 300)));
      if (typeof e.ipHash === 'string' && e.ipHash) li.appendChild(el('span', 'audit__ip', 'FROM #' + str(e.ipHash, 16)));
      ui.auditList.appendChild(li);
    }
  }

  function resetDashboard() {
    [ui.nOnline, ui.nInRooms, ui.nRaces, ui.nPeak].forEach(function (n) {
      n.textContent = '—';
    });
    [ui.minis, ui.roomsList, ui.countriesList, ui.mapsList, ui.carsList, ui.relayFacts, ui.labelsList, ui.auditList, ui.notices].forEach(clear);
    ui.notices.dataset.sig = '';
    ui.roomsCount.textContent = '';
    ui.roomsEmpty.hidden = true;
    ui.countriesEmpty.hidden = true;
    ui.mapsEmpty.hidden = true;
    ui.carsEmpty.hidden = true;
    ui.auditEmpty.hidden = true;
    ui.announceCurrent.hidden = true;
    ui.announceCurrentText.textContent = '';
    ui.announceText.value = '';
    updateAnnounceCount();
    ui.statsNote.textContent = '';
    ui.dashSession.textContent = '';
    ui.liveState.className = 'live';
    ui.liveState.textContent = 'CONNECTING…';
    ui.auditBox.open = false;
    state.stats = null;
    state.announce = null;
    state.labelsShown = '';
    state.lastOkAt = 0;
    state.offsetMs = 0;
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Two taps: the first arms the button for 4 s, the second (not a bounce) runs the action. */
  function armOrRun(key, button, armedLabel, run) {
    var now = Date.now();
    var armed = state.armed;
    if (armed && armed.key === key && now < armed.until) {
      if (now - armed.at < ARM_MIN_GAP_MS) return;
      disarm();
      run();
      return;
    }
    disarm();
    state.armed = { key: key, button: button, at: now, until: now + ARM_MS, label: button.textContent, aria: button.getAttribute('aria-label') };
    button.classList.add('is-armed');
    button.textContent = armedLabel;
    button.setAttribute('aria-label', armedLabel);
    state.armed.timer = setTimeout(disarm, ARM_MS);
  }

  function disarm() {
    var armed = state.armed;
    if (!armed) return;
    state.armed = null;
    clearTimeout(armed.timer);
    armed.button.classList.remove('is-armed');
    armed.button.textContent = armed.label;
    if (armed.aria) armed.button.setAttribute('aria-label', armed.aria);
    else armed.button.removeAttribute('aria-label');
  }

  function hideToast() {
    clearTimeout(state.toastTimer);
    ui.toast.hidden = true;
  }

  function toast(text, kind) {
    clearTimeout(state.toastTimer);
    ui.toast.textContent = text;
    ui.toast.className = 'toast' + (kind ? ' is-' + kind : '');
    ui.toast.hidden = false;
    state.toastTimer = setTimeout(hideToast, kind === 'error' ? 8000 : 5000);
  }

  /** Shared handling for an action's answer. Returns true when the caller should stop. */
  function actionFailed(r, what) {
    if (r.status === 401) {
      expire('Your session has ended. Log in again, then ' + what + '.');
      return true;
    }
    if (r.status === 200) return false;
    if (r.status === 0) toast(noAnswerText(r, hostOf(state.session ? state.session.relay : '')), 'error');
    else if (r.status === 400) toast('The relay refused it: ' + (str(r.data.detail, 160) || str(r.data.error, 60) || 'bad request') + '.', 'error');
    else if (r.status === 404) toast(str(r.data.error, 60) === 'no such player' ? 'That player has already left.' : 'That room is already gone.', 'warn');
    else toast('The relay answered HTTP ' + r.status + (r.data.error ? ' (' + str(r.data.error, 60) + ')' : '') + '.', 'error');
    return true;
  }

  function closeRoom(code, button) {
    button.disabled = true;
    authed('rooms/' + code + '/close', { method: 'POST' }).then(function (r) {
      button.disabled = false;
      if (actionFailed(r, 'close the room')) {
        refreshNow();
        return;
      }
      var n = num(r.data.members) || 0;
      toast('Room ' + code + ' closed. ' + n + ' player' + (n === 1 ? '' : 's') + ' sent back to the menu.', 'ok');
      refreshNow();
    });
  }

  function removePlayer(code, memberId, name, button) {
    button.disabled = true;
    authed('rooms/' + code + '/remove', { method: 'POST', body: { memberId: memberId } }).then(function (r) {
      button.disabled = false;
      if (actionFailed(r, 'remove the player')) {
        refreshNow();
        return;
      }
      toast('Removed ' + name + ' from room ' + code + (r.data.roomClosed === true ? ' (the room closed: nobody was left).' : '. They cannot rejoin it.'), 'ok');
      refreshNow();
    });
  }

  function announceTextValue() {
    return ui.announceText.value.normalize('NFKC').replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
  }

  function updateAnnounceCount() {
    var n = Array.from(announceTextValue()).length;
    ui.announceCount.textContent = n + '/' + ANNOUNCE_MAX;
    ui.announceCount.classList.toggle('is-over', n > ANNOUNCE_MAX);
    ui.announceSend.disabled = n === 0 || n > ANNOUNCE_MAX;
  }

  function onAnnounceSubmit(event) {
    event.preventDefault();
    var text = announceTextValue();
    var length = Array.from(text).length;
    if (length === 0 || length > ANNOUNCE_MAX) {
      toast('The banner needs 1 to ' + ANNOUNCE_MAX + ' characters.', 'warn');
      return;
    }
    var checked = ui.announceForm.querySelector('input[name="minutes"]:checked');
    var minutes = checked ? Number(checked.value) : 5;
    ui.announceSend.disabled = true;
    authed('announce', { method: 'POST', body: { text: text, minutes: minutes } }).then(function (r) {
      updateAnnounceCount();
      if (actionFailed(r, 'send the banner')) return;
      ui.announceText.value = '';
      updateAnnounceCount();
      renderAnnounce(r.data.announce);
      toast('Banner sent to every game for ' + minutes + ' min.', 'ok');
      refreshNow();
    });
  }

  function onAnnounceClear() {
    ui.announceClear.disabled = true;
    authed('announce/clear', { method: 'POST' }).then(function (r) {
      ui.announceClear.disabled = false;
      if (actionFailed(r, 'hide the banner')) return;
      renderAnnounce(null);
      toast(r.data.cleared === true ? 'Banner hidden in every game.' : 'No banner was showing.', 'ok');
      refreshNow();
    });
  }

  function onNewRoomsToggle() {
    if (state.settingsBusy) return;
    var next = !state.newRoomsAllowed;
    state.settingsBusy = true;
    ui.newRoomsSwitch.disabled = true;
    authed('settings', { method: 'POST', body: { newRoomsAllowed: next } }).then(function (r) {
      state.settingsBusy = false;
      ui.newRoomsSwitch.disabled = false;
      if (actionFailed(r, 'change new rooms')) return;
      if (isObject(r.data.settings)) renderSettings(r.data.settings);
      toast(next ? 'New rooms are ON again.' : 'New rooms are OFF: anyone who tries gets "New rooms are paused by the owner".', next ? 'ok' : 'warn');
      refreshNow();
    });
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  ui.loginForm.addEventListener('submit', onLoginSubmit);
  ui.relayUse.addEventListener('click', function () {
    if (useTypedRelay()) {
      ui.relayBox.open = false;
      pingHealth();
    }
  });
  ui.relayReset.addEventListener('click', function () {
    var def = normalizeRelay(CONFIG.relay);
    setRelay(def.origin || '');
    showLoginError('');
    ui.relayBox.open = !def.origin;
    pingHealth();
  });
  ui.relayInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      ui.relayUse.click();
    }
  });
  ui.googleSwitch.addEventListener('click', function () {
    forgetGoogle();
    renderGoogleButton();
  });
  ui.logoutButton.addEventListener('click', logout);
  ui.refreshButton.addEventListener('click', refreshNow);
  ui.announceForm.addEventListener('submit', onAnnounceSubmit);
  ui.announceText.addEventListener('input', updateAnnounceCount);
  ui.announceClear.addEventListener('click', onAnnounceClear);
  ui.newRoomsSwitch.addEventListener('click', onNewRoomsToggle);
  ui.auditBox.addEventListener('toggle', function () {
    if (ui.auditBox.open && state.session) refreshNow();
  });
  document.addEventListener('visibilitychange', function () {
    if (!state.session) return;
    if (document.visibilityState === 'visible') {
      scheduleExpiry();
      if (state.session) refreshNow();
    } else {
      clearTimeout(state.pollTimer);
    }
  });
  window.addEventListener('pageshow', function () {
    if (state.session) scheduleExpiry();
  });
  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!ui.loginView.hidden && !ui.googleBox.hidden) renderGoogleButton();
    }, 250);
  });

  // ── Start ──────────────────────────────────────────────────────────────────

  var configured = normalizeRelay(CONFIG.relay);
  setRelay(configured.origin || '');
  updateAnnounceCount();
  var stored = loadStored();
  if (stored) {
    state.session = stored;
    setRelay(stored.relay);
    enterDashboard();
  } else {
    if (!configured.origin) ui.relayBox.open = true;
    showLogin('', false);
  }
})();
