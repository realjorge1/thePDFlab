/**
 * Global polyfill shim
 * Loaded before any other module via app/_layout.tsx
 */

// Provide a minimal crypto.getRandomValues polyfill for libraries that need it
// (e.g. uuid, crypto-js) when running in environments that lack Web Crypto.
if (typeof global.crypto === "undefined") {
  global.crypto = {};
}

if (typeof global.crypto.getRandomValues === "undefined") {
  global.crypto.getRandomValues = function (array) {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
    return array;
  };
}

// Base64 helpers (needed by some libraries on Android/Hermes)
if (typeof global.atob === "undefined") {
  global.atob = function (input) {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    let str = String(input).replace(/=+$/, "");
    let output = "";
    for (
      let bc = 0, bs, buffer, idx = 0;
      (buffer = str.charAt(idx++));
      ~buffer && ((bs = bc % 4 ? bs * 64 + buffer : buffer), bc++ % 4)
        ? (output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6))))
        : 0
    ) {
      buffer = chars.indexOf(buffer);
    }
    return output;
  };
}

if (typeof global.btoa === "undefined") {
  global.btoa = function (input) {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    let str = String(input);
    let output = "";
    for (
      let block, charCode, idx = 0, map = chars;
      str.charAt(idx | 0) || ((map = "="), idx % 1);
      output += map.charAt(63 & (block >> (8 - (idx % 1) * 8)))
    ) {
      charCode = str.charCodeAt((idx += 3 / 4));
      block = (block << 8) | charCode;
    }
    return output;
  };
}
