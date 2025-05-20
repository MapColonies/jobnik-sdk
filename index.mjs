import { RetryAgent, Agent } from 'undici';
import http from 'node:http';

const agent = new Agent({});

const RETRY_CONFIG = {
  MAX_RETRIES: 7,
  INITIAL_RETRY_DELAY_MS: 100,
  MAX_RETRY_DELAY_MS: 30000,
  RETRY_BACKOFF_FACTOR: 2,
  MAX_SAFE_RETRY_COUNT: 15,
  JITTER_MIN_FACTOR: 0.5,
};

const retryAgent = new RetryAgent(agent, {
  maxRetries: RETRY_CONFIG.MAX_RETRIES,
  retry: (err, context, cb) => {
    const attempt = typeof context.state.counter === 'number' ? context.state.counter : 0;
    const isMaxed = attempt >= RETRY_CONFIG.MAX_RETRIES;
    console.log('[Retry] Attempt', attempt, 'Error:', err && err.message);
    if (isMaxed) {
      console.log('[Retry] Max retries reached');
      cb(err);
      return;
    }
    const baseDelay = Math.min(
      RETRY_CONFIG.INITIAL_RETRY_DELAY_MS * Math.pow(RETRY_CONFIG.RETRY_BACKOFF_FACTOR, Math.min(attempt, RETRY_CONFIG.MAX_SAFE_RETRY_COUNT)),
      RETRY_CONFIG.MAX_RETRY_DELAY_MS
    );
    const jitterFactor = RETRY_CONFIG.JITTER_MIN_FACTOR + Math.random();
    const delay = Math.floor(baseDelay * jitterFactor);
    console.log('[Retry] Waiting', delay, 'ms before next attempt');
    setTimeout(() => cb(null), delay);
  },
});

const requestHandler = (req, res) => {
  console.log(`[Request] ${req.method} ${req.url}`);
  const BAD_GATEWAY_CODE = 502;
  res.statusCode = BAD_GATEWAY_CODE;
  res.end('Bad Gateway');
};

const PORT = 3000;
const server = http.createServer(requestHandler);
server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

const a = await retryAgent.request({
  method: 'GET',
  path: '/',
  origin: 'http://localhost:3000',
});

console.log('a', a);
