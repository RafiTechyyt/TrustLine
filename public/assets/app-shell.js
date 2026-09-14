/* app-shell.js — registers the service worker and the install manifest hints.
 * Kept out of app.js so the reporter's code stays about reporting, and out of
 * index.html so nothing inline fights the CSP's script-src 'self'.
 */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((error) => {
    // A private window or a refused permission is not an app problem. The site
    // still works; it just cannot be installed or opened offline.
    console.warn("service worker unavailable:", error);
  });
}