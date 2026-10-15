// Prefs for the omarchy-container-gapps app profile. Linked into the profile
// by the launcher; Firefox applies them on every start.

// Containers, without Firefox's container UI.
user_pref("privacy.userContext.enabled", true);
user_pref("privacy.userContext.ui.enabled", false);

// Start empty: the app opens its own tabs from the accounts file.
user_pref("browser.startup.page", 0);
user_pref("browser.startup.homepage", "about:blank");
user_pref("browser.newtabpage.enabled", false);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.startup.couldRestoreSession.count", -1);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("startup.homepage_welcome_url", "");
user_pref("startup.homepage_welcome_url.additional", "");

// Quiet first run.
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("browser.uitour.enabled", false);
user_pref("extensions.pocket.enabled", false);
user_pref("browser.ml.chat.enabled", false);

// Window behavior.
user_pref("browser.tabs.inTitlebar", 0);
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.warnOnQuit", false);
user_pref("browser.tabs.closeWindowWithLastTab", false);
user_pref("browser.tabs.hoverPreview.enabled", false);
user_pref("browser.tabs.groups.enabled", false);
user_pref("sidebar.revamp", false);
user_pref("sidebar.verticalTabs", false);
user_pref("ui.key.menuAccessKeyFocuses", false);
user_pref("browser.link.open_newwindow", 3);

// Passwords and passkeys come from a password manager extension such as
// 1Password, so Firefox's own prompts stay out of the way.
user_pref("signon.rememberSignons", false);
user_pref("signon.autofillForms", false);
user_pref("signon.generation.enabled", false);
user_pref("signon.firefoxRelay.feature", "disabled");
user_pref("security.webauthn.enable_conditional_mediation", false);
user_pref("extensions.formautofill.addresses.enabled", false);
user_pref("extensions.formautofill.creditCards.enabled", false);
