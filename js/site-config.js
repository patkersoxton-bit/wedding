/*
 * Site phase switch — the one place to move the site between launch stages.
 * Loaded as a blocking <script> in <head> so the right content shows on
 * first paint (no flash of the wrong phase).
 *
 *   1 = Save the date: Home / Venue / Travel / RSVP tabs; the RSVP page only
 *       says "RSVP opens with your invitation" (no lookup form).
 *   2 = Invitations out: RSVP lookup + response flow is live.
 *
 * Markup opts in with .phase-1-only / .phase-2-only (see css/site.css).
 * The pre-invite address collector (address.html) is independent of this:
 * it is never linked from the site and works in any phase.
 */
(function () {
  'use strict';
  var SITE_PHASE = 1;

  window.PJ_SITE = Object.freeze({ phase: SITE_PHASE });
  document.documentElement.setAttribute('data-phase', String(SITE_PHASE));
})();
