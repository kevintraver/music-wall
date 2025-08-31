const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const port = process.env.PORT || 3000;

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${port}`);
    console.log('💡 Make sure to also run: npm run ws (in another terminal)');
    console.log('🔌 WebSocket server needed for real-time album updates');
  });

  // Set up global function to communicate with WebSocket server
  global.sendWebSocketUpdate = (data) => {
    // Send HTTP request to WebSocket server
    const http = require('http');
    const WS_HTTP_PORT = 3003; // WebSocket HTTP server port

    const postData = JSON.stringify(data);
    const options = {
      hostname: 'localhost',
      port: WS_HTTP_PORT,
      path: '/update',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('✅ WebSocket update sent successfully');
        } else {
          console.error('❌ Failed to send WebSocket update:', body);
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Error sending WebSocket update:', error.message);
    });

    req.write(postData);
    req.end();
  };
});