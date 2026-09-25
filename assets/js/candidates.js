/* ==========================================================================
   OnlyPads — the creator candidates
   ============================================================================

   THE IDEA

   OnlyPads is a coin whose creator reward is paid to one OnlyFans creator. Ten
   are shortlisted; one is selected and announced. This file is that shortlist.

   ---------------------------------------------------------------------------
   WHY THE SLOTS ARE EMPTY, AND WHY THAT IS NOT UNFINISHED WORK
   ---------------------------------------------------------------------------
   Ten real creators' handles cannot be shipped here until each of them has agreed
   to be named. Publishing a real person's handle as a candidate for a payout they
   have not accepted uses their name and likeness without consent, and it reads to
   anyone who sees the page as though they are already involved.

   This project has already been bitten by the same class of mistake: the board
   shipped twelve INVENTED creator handles, and the effect was that a reader could
   not tell a real creator from a made-up one. Inventing ten more here would be
   worse, because these would look like real OnlyFans accounts being lined up for
   real money.

   So the structure ships complete and the names ship empty. Fill `handle` in as
   each creator confirms, and the tile flips from "To be confirmed" to a real
   nominee with no code change.

   ---------------------------------------------------------------------------
   TO FILL IN
   ---------------------------------------------------------------------------
     handle    the @name, no leading @
     name      display name, optional — falls back to the handle
     audience  a follower count as a string, optional
     note      one short line, optional

   Then set `status` to 'announced' and `winner` to the handle that won. The
   section switches to the announced state on its own.
   ========================================================================== */
(function (root) {
  'use strict';

  root.ONLYPAD = root.ONLYPAD || {};

  root.ONLYPAD.candidates = {
    /* 'pending' while the shortlist is open, 'announced' once one has won. */
    status: 'pending',
    winner: null,

    /* Ten slots. `handle: null` renders as "To be confirmed". */
    nominees: [
      { handle: null, name: null, audience: null, note: null },
      { handle: null, name: null, audience: null, note: null },
      { handle: null, name: null, audience: null, note: null },
      { handle: null, name: null, audience: null, note: null },
      { handle: null, name: null, audience: null, note: null },
      { handle: null, name: null, audience: null, note: null },
      { handle: null, name: null, audience: null, note: null },
      { handle: null, name: null, audience: null, note: null },
      { handle: null, name: null, audience: null, note: null },
      { handle: null, name: null, audience: null, note: null }
    ]
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
