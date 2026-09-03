(function () {
  'use strict';

  (async () => {
    await import(
      /* @vite-ignore */
      chrome.runtime.getURL("assets/content.js.f2f36233.js")
    );
  })().catch(console.error);

})();
