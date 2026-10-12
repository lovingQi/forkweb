import http from 'http';
import crypto from 'crypto';

const port = Number(process.env.MOCK_CALLBACK_PORT || 19091);
const secret = process.env.FORKWEB_CALLBACK_SECRET || '';
const fail = process.env.MOCK_FAIL === '1';

function signaturesMatch(actual: string, expected: string): boolean {
  const actualBuf = Buffer.from(actual);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const timestamp = String(req.headers['x-forkweb-timestamp'] || '');
    const signature = String(req.headers['x-forkweb-signature'] || '');
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
    const verified = signaturesMatch(signature, expected);
    console.log(`[mock] event=${req.headers['x-forkweb-event']} delivery=${req.headers['x-forkweb-delivery']} verified=${verified}`);
    console.log(body);
    if (!verified) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('bad signature');
      return;
    }
    if (fail) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('fail');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ succeed: true }));
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock] callback receiver listening on http://127.0.0.1:${port} fail=${fail}`);
});
