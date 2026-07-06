// HTML-escape a value before interpolating it into an innerHTML template.
// Guest-writable fields (dietary notes, meal preference) flow back into both
// the RSVP page and the admin dashboard, so every DB value rendered via
// innerHTML must pass through this — otherwise a guest could store markup
// that executes in a planner's authenticated admin session.
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
