global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;

if (process.env.OLLAMA_LIVE_READY !== '1') {
  global.fetch = jest.fn();
}
