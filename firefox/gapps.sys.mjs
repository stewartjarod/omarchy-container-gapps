// omarchy-container-gapps: turns a Firefox profile into the Mail and Calendar
// apps. Each Google account gets its own container and one pill-shaped tab.
//
// Loaded once per Firefox process by the autoconfig loader
// (system/omarchy-container-gapps.cfg), and only in the app profile.
//
// A window's role (mail or calendar) comes from the launcher, which opens
// "about:blank?gapps=<role>" either as the first window or as a tab in the
// running instance.

const { ContextualIdentityService: Containers } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs"
);

const { AppConstants } = ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs");
const { setInterval } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");

const HOME = Services.dirsvc.get("Home", Ci.nsIFile).path;
const CONFIG_HOME = Services.env.get("XDG_CONFIG_HOME") || PathUtils.join(HOME, ".config");
const STATE_HOME = Services.env.get("XDG_STATE_HOME") || PathUtils.join(HOME, ".local", "state");
const ACCOUNTS_FILE = PathUtils.join(CONFIG_HOME, "omarchy-container-gapps", "accounts");
const THEME_FILE = PathUtils.join(STATE_HOME, "omarchy", "current", "theme", "colors.toml");
const STYLESHEET = "resource://omarchy-gapps/gapps.css";
const POLL_MS = 2000;
const HTML_NS = "http://www.w3.org/1999/xhtml";
const SENTINEL = /^about:blank\?gapps=(mail|calendar|addons)(?:&(compose))?$/;
const ADDONS_PAGE = "https://addons.mozilla.org/firefox/addon/1password-x-password-manager/";

// Each container holds one signed-in account, so /u/0 is always the right
// one. Going through ServiceLogin skips Google's marketing page when the
// container isn't signed in yet, and pre-fills the email when there is one;
// when it is signed in, it redirects straight on.
function signedIn(account, target) {
  const params = new URLSearchParams({ continue: target });
  if (account.email) params.set("Email", account.email);
  return `https://accounts.google.com/ServiceLogin?${params}`;
}

const APPS = {
  mail: {
    title: "Mail",
    url: a => signedIn(a, "https://mail.google.com/mail/u/0/"),
  },
  calendar: {
    title: "Calendar",
    url: a => signedIn(a, "https://calendar.google.com/calendar/u/0/r"),
  },
};

// Pages that need the account's cookies, so they stay in the app when a
// mail or calendar opens them in a new tab. Everything else goes to the
// default browser.
const STAYS_IN_APP = [
  /^(mail|calendar|accounts|contacts)\.google\.com$/,
  /^addons\.mozilla\.org$/,
  /\.googleusercontent\.com$/,
];

const DEFAULT_COLORS = ["accent", "blue", "green", "magenta", "orange", "cyan", "yellow", "red"];
// Firefox's own container colors, only used so the container list in
// about:preferences looks sensible. The pills use the theme colors.
const CONTAINER_COLORS = { blue: "blue", cyan: "turquoise", green: "green", yellow: "yellow", orange: "orange", red: "red", magenta: "pink", accent: "purple" };

const state = {
  accounts: [],
  accountsText: null,
  theme: {},
  themeText: null,
  windows: new Map(), // role -> window
};

// Set omarchy-gapps.debug to true in about:config to log to gapps.log in the
// profile.
const LOG_FILE = PathUtils.join(PathUtils.profileDir, "gapps.log");
function report(e) {
  console.error("omarchy-container-gapps:", e);
  debug("error", e, e?.stack);
}

function debug(...parts) {
  if (!Services.prefs.getBoolPref("omarchy-gapps.debug", false)) return;
  IOUtils.writeUTF8(LOG_FILE, `${new Date().toISOString()} ${parts.join(" ")}\n`, { mode: "appendOrCreate" });
}

// --- Config and theme files ---------------------------------------------

async function readText(path) {
  try {
    return await IOUtils.readUTF8(path);
  } catch {
    return null;
  }
}

// Each non-comment line: <label> <apps> [email] [color]
// apps is "mail", "cal"/"calendar", or both joined with a comma.
function parseAccounts(text) {
  const accounts = [];
  for (const raw of (text || "").split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [label, apps = "mail,cal", ...rest] = line.split(/\s+/);
    const email = rest.find(word => word.includes("@")) || "";
    const color = rest.find(word => !word.includes("@")) || "";
    const roles = new Set(
      apps.split(",").map(app => (app.startsWith("cal") ? "calendar" : app)).filter(app => app in APPS)
    );
    accounts.push({ label, roles, email, color });
  }
  accounts.forEach((account, i) => (account.color ||= DEFAULT_COLORS[i % DEFAULT_COLORS.length]));
  return accounts;
}

function parseTheme(text) {
  const theme = {};
  for (const match of (text || "").matchAll(/^\s*([a-z0-9_]+)\s*=\s*"(#[0-9a-fA-F]{6})"/gm)) {
    theme[match[1].toLowerCase()] = match[2];
  }
  theme.mode = /^\s*mode\s*=\s*"light"/m.test(text || "") ? "light" : "dark";
  return theme;
}

function themeColor(name) {
  if (/^#[0-9a-f]{6}$/i.test(name)) return name;
  const t = state.theme;
  return t[name] || t[`color${{ red: 1, green: 2, yellow: 3, blue: 4, magenta: 5, cyan: 6 }[name]}`] || t.accent || "#7aa2f7";
}

function mix(a, b, amount) {
  const pa = a.match(/\w\w/g).map(h => parseInt(h, 16));
  const pb = b.match(/\w\w/g).map(h => parseInt(h, 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}

async function reloadFiles() {
  const [accountsText, themeText] = await Promise.all([readText(ACCOUNTS_FILE), readText(THEME_FILE)]);
  const themeChanged = themeText !== state.themeText;
  const accountsChanged = accountsText !== state.accountsText;
  state.themeText = themeText;
  state.accountsText = accountsText;
  if (themeChanged) {
    state.theme = parseTheme(themeText);
    Services.prefs.setIntPref("layout.css.prefers-color-scheme.content-override", state.theme.mode === "light" ? 1 : 0);
  }
  if (accountsChanged) {
    state.accounts = parseAccounts(accountsText);
    ensureContainers();
  }
  if (themeChanged || accountsChanged) {
    debug("reload", themeChanged ? "theme" : "", accountsChanged ? "accounts" : "", "windows", state.windows.size);
    for (const win of state.windows.values()) refreshWindow(win);
  }
}

// --- Extension buttons -----------------------------------------------------

// Extensions (1Password and the like) are installed by hand from
// addons.mozilla.org; see `omarchy-container-gapps addons`. Their toolbar
// buttons would land on the hidden nav bar, so move them to the pill strip.
function placeExtensionButton(win, addon) {
  if (addon.type !== "extension" || addon.isSystem || addon.isBuiltin) return;
  const widget = `${addon.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}-browser-action`;
  const { CustomizableUI } = win;
  if (CustomizableUI.getPlacementOfWidget(widget)?.area !== CustomizableUI.AREA_TABSTRIP) {
    CustomizableUI.addWidgetToArea(widget, CustomizableUI.AREA_TABSTRIP);
  }
}

async function placeExtensionButtons(win) {
  for (const addon of await AddonManager.getAddonsByTypes(["extension"])) placeExtensionButton(win, addon);
}

AddonManager.addAddonListener({
  onInstalled(addon) {
    const win = state.windows.values().next().value;
    if (win) placeExtensionButton(win, addon);
  },
});

// --- Containers ------------------------------------------------------------

function containerFor(account) {
  return Containers.getPublicIdentities().find(identity => identity.name === account.label);
}

function ensureContainers() {
  for (const account of state.accounts) {
    if (!containerFor(account)) {
      Containers.create(account.label, "circle", CONTAINER_COLORS[account.color] || "blue");
    }
  }
}

// --- Windows ---------------------------------------------------------------

function roleFromArgument(arg) {
  const match = typeof arg === "string" && arg.match(SENTINEL);
  return match ? { role: match[1], compose: !!match[2] } : null;
}

const systemPrincipal = () => Services.scriptSecurityManager.getSystemPrincipal();

function accountTabs(win) {
  return [...win.gBrowser.tabs].filter(tab => tab.hasAttribute("gapps-account"));
}

function selectedAccount(win) {
  const tab = win.gBrowser.selectedTab;
  return tab.getAttribute("gapps-account") || accountTabs(win)[0]?.getAttribute("gapps-account");
}

function updateTitle(win) {
  // Other tabs (attachments, the add-ons page) get the regular toolbar back,
  // which Firefox also needs to anchor its install and permission prompts.
  win.document.documentElement.toggleAttribute(
    "gapps-extra-tab",
    !win.gBrowser.selectedTab.hasAttribute("gapps-account") && !win.gBrowser.selectedTab.hasAttribute("gapps-empty")
  );
  const app = APPS[win.gappsRole];
  win.document.title = `${app.title} · ${selectedAccount(win) || "No accounts"}`;
}

function decorateTab(win, tab, account) {
  const doc = win.document;
  tab.setAttribute("gapps-account", account.label);
  tab.style.setProperty("--gapps-color", themeColor(account.color));
  tab.setAttribute("tooltiptext", account.email ? `${account.label} — ${account.email}` : account.label);
  let pill = tab.querySelector(".gapps-pill");
  if (!pill) {
    pill = doc.createElementNS(HTML_NS, "span");
    pill.className = "gapps-pill";
    for (const part of ["dot", "label", "count"]) {
      const span = doc.createElementNS(HTML_NS, "span");
      span.className = `gapps-${part}`;
      pill.append(span);
    }
    tab.querySelector(".tab-content").append(pill);
  }
  pill.querySelector(".gapps-label").textContent = account.label;
  updateCount(tab);
}

// Gmail puts the unread count in the page title: "Inbox (12) - you@x - Gmail".
function updateCount(tab) {
  const count = tab.querySelector(".gapps-count");
  if (!count) return;
  const match = tab.label.match(/\((\d[\d,]*)\)/);
  const text = match && match[1] !== "0" ? match[1] : "";
  if (count.textContent !== text) count.textContent = text;
  tab.toggleAttribute("gapps-unread", !!text);
}

function openAccountTab(win, account) {
  const container = containerFor(account);
  return win.gBrowser.addTab(APPS[win.gappsRole].url(account), {
    userContextId: container.userContextId,
    triggeringPrincipal: systemPrincipal(),
    skipAnimation: true,
  });
}

// Make the window's account tabs match the config: one tab per account, in
// config order, ahead of any other tabs.
function syncTabs(win) {
  const { gBrowser } = win;
  const wanted = state.accounts.filter(account => account.roles.has(win.gappsRole));
  const existing = new Map(accountTabs(win).map(tab => [tab.getAttribute("gapps-account"), tab]));

  wanted.forEach((account, index) => {
    let tab = existing.get(account.label);
    existing.delete(account.label);
    if (!tab) tab = openAccountTab(win, account);
    decorateTab(win, tab, account);
    if (tab._tPos !== index) gBrowser.moveTabTo(tab, { tabIndex: index });
  });

  for (const tab of existing.values()) {
    tab.removeAttribute("gapps-account");
    gBrowser.removeTab(tab, { animate: false });
  }

  if (!wanted.length && !gBrowser.tabs.some(tab => tab.hasAttribute("gapps-empty"))) {
    const tab = gBrowser.addTab(emptyPage(win.gappsRole), { triggeringPrincipal: systemPrincipal() });
    tab.setAttribute("gapps-empty", "true");
  } else if (wanted.length) {
    for (const tab of gBrowser.tabs.filter(tab => tab.hasAttribute("gapps-empty"))) {
      gBrowser.removeTab(tab, { animate: false });
    }
  }
}

function emptyPage(role) {
  const t = state.theme;
  const html = `<!doctype html><meta charset="utf-8"><title>No accounts</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:${t.background || "#111"};color:${t.foreground || "#ddd"};font:15px/1.6 system-ui">
<div style="max-width:34em"><h1 style="font-weight:600;font-size:20px">No ${APPS[role].title.toLowerCase()} accounts yet</h1>
<p>Add a line per Google account to <code>${ACCOUNTS_FILE}</code>, for example:</p>
<pre style="padding:12px 16px;border-radius:8px;background:${t.lighter_background || "#222"}">Personal   mail,cal   you@example.com
Work       mail,cal   you@example.org</pre>
<p>The window picks up the change within a couple of seconds.</p></div>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function applyTheme(win) {
  const t = state.theme;
  const bg = t.background || "#1a1b26";
  const fg = t.foreground || "#c0caf5";
  const accent = t.accent || themeColor("blue");
  const root = win.document.documentElement;
  const vars = {
    "--gapps-bg": bg,
    "--gapps-fg": fg,
    "--gapps-muted": t.dark_foreground || mix(fg, bg, 0.45),
    "--gapps-surface": t.lighter_background || mix(bg, fg, 0.08),
    "--gapps-hover": mix(bg, fg, 0.05),
    "--gapps-border": mix(bg, fg, 0.1),
    "--gapps-accent": accent,
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  root.setAttribute("gapps-mode", t.mode || "dark");
}

function refreshWindow(win) {
  applyTheme(win);
  syncTabs(win);
  updateTitle(win);
}

function cycleAccounts(win, step) {
  const tabs = accountTabs(win);
  if (!tabs.length) return;
  const current = tabs.indexOf(win.gBrowser.selectedTab);
  const next = current === -1 ? (step > 0 ? 0 : tabs.length - 1) : (current + step + tabs.length) % tabs.length;
  win.gBrowser.selectedTab = tabs[next];
}

// Alt+Left/Right switch accounts instead of going back/forward. reserved="true"
// makes Firefox handle the key before the page sees it.
function installKeys(win) {
  const doc = win.document;
  for (const id of ["goBackKb", "goForwardKb", "goBackKb2", "goForwardKb2"]) doc.getElementById(id)?.remove();
  const keyset = doc.createXULElement("keyset");
  keyset.id = "gapps-keyset";
  for (const [keycode, step] of [["VK_LEFT", -1], ["VK_RIGHT", 1]]) {
    const key = doc.createXULElement("key");
    key.setAttribute("keycode", keycode);
    key.setAttribute("modifiers", "alt");
    key.setAttribute("reserved", "true");
    key.setAttribute("oncommand", "void 0");
    key.addEventListener("command", () => cycleAccounts(win, step));
    keyset.append(key);
  }
  doc.getElementById("mainKeyset").after(keyset);
}

function addSideLabel(win) {
  const doc = win.document;
  const label = doc.createElementNS(HTML_NS, "div");
  label.id = "gapps-app-label";
  label.textContent = APPS[win.gappsRole].title;
  doc.getElementById("TabsToolbar-customization-target")?.append(label);
}

// --- Handing links to the default browser ----------------------------------

function realTarget(uri) {
  // Gmail sends outside links through https://www.google.com/url?q=<target>.
  if (/^(www\.)?google\.com$/.test(uri.host) && uri.filePath === "/url") {
    const q = new URLSearchParams(uri.query).get("q") || new URLSearchParams(uri.query).get("url");
    if (q) return q;
  }
  return uri.spec;
}

function staysInApp(url) {
  try {
    const host = new URL(url).hostname;
    return STAYS_IN_APP.some(pattern => pattern.test(host));
  } catch {
    return true;
  }
}

// Variables Firefox sets for itself; a Firefox started by the default browser
// handler must not inherit them, or it could attach to this profile.
const FIREFOX_ENV = [
  "XRE_PROFILE_PATH",
  "XRE_PROFILE_LOCAL_PATH",
  "XRE_PROFILE_NAME",
  "XRE_BINARY_PATH",
  "XRE_RESTARTED_BY_PROFILE_MANAGER",
  "XRE_START_OFFLINE",
  "MOZ_LAUNCHED_CHILD",
  "MOZ_APP_SILENT_START",
  "MOZ_APP_REMOTINGNAME",
  ...Array.from({ length: 16 }, (_, i) => `MOZ_CRASHREPORTER_RESTART_ARG_${i}`),
];

function openInDefaultBrowser(url) {
  const args = [...FIREFOX_ENV.flatMap(name => ["-u", name]), "xdg-open", url];
  const env = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  env.initWithPath("/usr/bin/env");
  const proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  proc.init(env);
  proc.runAsync(args, args.length);
}

function tabsProgressListener(win) {
  return {
    onLocationChange(browser, webProgress, request, location) {
      if (!webProgress.isTopLevel) return;
      const tab = win.gBrowser.getTabForBrowser(browser);
      debug("location", location.spec, "account", tab?.getAttribute("gapps-account"));
      if (!tab || tab.hasAttribute("gapps-account") || tab.hasAttribute("gapps-empty")) return;
      const spec = location.spec;

      const launch = roleFromArgument(spec);
      if (launch) {
        win.gBrowser.removeTab(tab, { animate: false });
        Services.tm.dispatchToMainThread(() => handleLaunch(launch, win));
        return;
      }

      if (!/^https?:/.test(spec)) return;
      const url = realTarget(location);
      debug("new tab", spec, "->", url, staysInApp(url) ? "stays" : "handoff");
      if (staysInApp(url)) return;
      openInDefaultBrowser(url);
      const opener = tab.openerTab;
      win.gBrowser.removeTab(tab, { animate: false });
      if (opener?.isConnected) win.gBrowser.selectedTab = opener;
    },
  };
}

// --- Launch requests -------------------------------------------------------

function compose(win) {
  const tab = win.gBrowser.selectedTab.hasAttribute("gapps-account") ? win.gBrowser.selectedTab : accountTabs(win)[0];
  if (!tab) return;
  win.gBrowser.selectedTab = tab;
  const uri = tab.linkedBrowser.currentURI;
  if (uri.host !== "mail.google.com") return;
  const target = uri.mutate().setRef("inbox?compose=new").finalize();
  tab.linkedBrowser.loadURI(target, { triggeringPrincipal: systemPrincipal() });
}

function handleLaunch({ role, compose: wantsCompose }, fromWin) {
  if (role === "addons") {
    const win = state.windows.get("mail") || state.windows.get("calendar") || fromWin;
    win.focus();
    win.gBrowser.selectedTab = win.gBrowser.addTab(ADDONS_PAGE, { triggeringPrincipal: systemPrincipal() });
    return;
  }
  const existing = state.windows.get(role);
  if (existing && !existing.closed) {
    existing.focus();
    if (wantsCompose) compose(existing);
    return;
  }
  fromWin.openDialog(
    AppConstants.BROWSER_CHROME_URL,
    "_blank",
    "chrome,all,dialog=no",
    `about:blank?gapps=${role}${wantsCompose ? "&compose" : ""}`
  );
}

function setUpWindow(win, launch) {
  const { gBrowser } = win;
  win.gappsRole = launch.role;
  state.windows.set(launch.role, win);
  win.document.documentElement.setAttribute("gapps-role", launch.role);
  win.windowUtils.loadSheetUsingURIString(STYLESHEET, win.windowUtils.AUTHOR_SHEET);

  // Account tabs can't be closed; their pills are the app.
  const removeTab = gBrowser.removeTab.bind(gBrowser);
  gBrowser.removeTab = (tab, options) => {
    if (tab.hasAttribute("gapps-account")) return;
    removeTab(tab, options);
  };

  gBrowser.getWindowTitleForBrowser = () => win.document.title;
  gBrowser.updateTitlebar = () => updateTitle(win);
  gBrowser.tabContainer.addEventListener("TabSelect", () => updateTitle(win));
  gBrowser.tabContainer.addEventListener("TabAttrModified", event => {
    if (event.detail.changed.includes("label")) updateCount(event.target);
  });
  gBrowser.addTabsProgressListener(tabsProgressListener(win));
  win.addEventListener("unload", () => {
    if (state.windows.get(launch.role) === win) state.windows.delete(launch.role);
  });

  installKeys(win);
  addSideLabel(win);
  placeExtensionButtons(win).catch(report);

  const placeholder = gBrowser.selectedTab;
  refreshWindow(win);
  const first = accountTabs(win)[0] || gBrowser.tabs.find(tab => tab.hasAttribute("gapps-empty"));
  if (first) {
    gBrowser.selectedTab = first;
    if (placeholder !== first) removeTab(placeholder, { animate: false });
  }
  if (launch.compose && first?.hasAttribute("gapps-account")) {
    // Gmail opens the compose window when it loads with this hash.
    const account = state.accounts.find(a => a.label === first.getAttribute("gapps-account"));
    const url = signedIn(account, "https://mail.google.com/mail/u/0/#inbox?compose=new");
    first.linkedBrowser.loadURI(Services.io.newURI(url), { triggeringPrincipal: systemPrincipal() });
  }
  updateTitle(win);
}

function onNewWindow(win) {
  const launch = roleFromArgument(win.arguments?.[0]);
  if (!launch) return; // popups (sign-in, print) and plain new windows
  if (launch.role === "addons") {
    // Asked for before any app window was open: make it a Mail window.
    setUpWindow(win, { role: "mail" });
    handleLaunch(launch, win);
    return;
  }

  const existing = state.windows.get(launch.role);
  if (existing && !existing.closed && existing !== win) {
    win.close();
    handleLaunch(launch, existing);
    return;
  }
  setUpWindow(win, launch);
}

// --- Start -----------------------------------------------------------------

const ready = reloadFiles();
Services.obs.addObserver(win => {
  ready.then(() => {
    try {
      onNewWindow(win);
    } catch (e) {
      report(e);
    }
  });
}, "browser-delayed-startup-finished");

// Timer.sys.mjs keeps its timers alive; a bare nsITimer held only by this
// module gets garbage-collected after a few ticks.
setInterval(() => reloadFiles().catch(report), POLL_MS);

export const loaded = true;
