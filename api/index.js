/**
 * Vercel entry point.
 *
 * Vercel runs one function per request and calls this exported handler — it
 * never starts a listening server, which is why the old server.js could not
 * work here. vercel.json rewrites every /api/* path to this file.
 */
module.exports = require('../lib/api');
