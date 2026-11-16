/**
 * The login this tab is using.
 *
 * localStorage is shared by every tab, so signing in as another role in a
 * second tab overwrites it. Code outside React must read the token from
 * here, never from storage, or it sends that other tab's login - SCERT's
 * Result pages showed "Unauthorized role" when a District / BEO / School
 * login was opened in the same browser. AuthProvider keeps this in step.
 */
let currentAuth = null;

export function setCurrentAuth(auth) {
  currentAuth = auth || null;
}

/** The token of the login this tab is signed in with, or null. */
export function getCurrentToken() {
  return currentAuth?.token || null;
}
