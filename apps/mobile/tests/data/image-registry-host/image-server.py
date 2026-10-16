import http.server
import gzip
import json
import os
import socket
import subprocess
import sys
import threading
import urllib.parse

counts = {}
gates = {}
failures = []
lock = threading.Lock()

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_):
        pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        key = parsed.path.strip('/')
        if key == 'counts':
            with lock:
                data = json.dumps(counts).encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if key == 'release':
            name = urllib.parse.parse_qs(parsed.query)['key'][0]
            with lock:
                gates.setdefault(name, threading.Event()).set()
            self.send_response(200)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if any(self.headers.get(name) for name in ['Cookie', 'Authorization', 'Referer']):
            failures.append('Credential leaked to image transport')
        if key == 'protected':
            failures.append('Forbidden redirect was followed')
        with lock:
            counts[key] = counts.get(key, 0) + 1
            gate = gates.setdefault(key, threading.Event()) if key.startswith(('held-', 'limit-')) else None
        if gate is not None:
            gate.wait(10)
        if key == 'redirect':
            self.send_response(302)
            self.send_header('Location', 'http://localhost:%s/protected' % self.server.server_port)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if key == 'gzip':
            data = gzip.compress(bytes(index % 251 for index in range(256 * 1024 + 7)))
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        status = 429 if key == 'rate' else 200
        size = 20 * 1024 * 1024 if key.startswith('budget-') else 256 * 1024 + 7
        if key in ['large', 'truncated', 'rate']:
            size = 20 * 1024 * 1024 + 1 if key == 'large' else 100 if key == 'truncated' else 1
        self.send_response(status)
        if key != 'mime':
            self.send_header('Content-Type', 'text/html' if key == 'html' else 'image/png')
        if key == 'rate':
            self.send_header('Retry-After', '17')
        self.send_header('Content-Length', str(size))
        self.end_headers()
        try:
            if key in ['large', 'truncated']:
                self.wfile.write(b'x')
                self.wfile.flush()
                self.connection.shutdown(socket.SHUT_RDWR)
                return
            if key == 'rate':
                self.wfile.write(b'x')
                return
            pattern = bytes(range(251)) * 263
            for offset in range(0, size, 65536):
                count = min(65536, size - offset)
                start = offset % 251
                self.wfile.write(pattern[start:start + count])
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    result = subprocess.run([sys.argv[1], 'http://127.0.0.1:%s' % server.server_port, sys.argv[2]], timeout=60)
    if failures:
        raise RuntimeError('; '.join(failures))
    sys.exit(result.returncode)
finally:
    server.shutdown()
    server.server_close()
