/* The owner's console settings: public values only (never a key, a token or an email address).
   scripts/build-pages.mjs writes this file again for the published copy in docs/: `relay` becomes the https
   origin of its DEFAULT_RELAY and `googleClientId` the game's GOOGLE_CLIENT_ID (empty = no Google button). */
window.SQUADHQ_ADMIN_CONFIG = Object.freeze({
  relay: 'https://gamerfleet-relay.onrender.com',
  googleClientId: '',
});
