// Client-safe copy of the Cubism Core licensing links (the server-side
// live2dCore util must not be imported into the browser bundle). tests/
// live2dCore.test.ts keeps both in sync with live2d-core.lock.json.
export const LIVE2D_CORE_LICENSES = [
  'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html',
  'https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html',
] as const;
