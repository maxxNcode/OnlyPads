/* Runs BEFORE the stylesheet paints, so a saved LIGHT choice never flashes dark.
   Dark is the default and lives in :root, so having no attribute is the dark state.
   External rather than inline because the CSP is script-src 'self' — an inline
   script is blocked silently and this would simply never run. */
/* ==========================================================================
   Extracted from an inline <script> block in index.html.

   WHY THIS IS A SEPARATE FILE: the CSP is `script-src 'self'` with no
   'unsafe-inline', so an inline script is BLOCKED by the browser — silently,
   with no JS error, and the page simply never runs its own code. Measured on
   the live deployment: the coin page sat on "Loading this coin..." forever.
   Keeping 'unsafe-inline' out of the CSP is worth one extra file.
   ========================================================================== */
/* Runs before the stylesheet paints, so a saved LIGHT choice never flashes dark.
   Dark is the default and lives in :root, so having no attribute is the dark state. */
(function () {
  try {
    var t = localStorage.getItem('onlypad-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
}());
