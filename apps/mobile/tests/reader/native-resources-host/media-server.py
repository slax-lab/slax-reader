import http.server
import json
import os
import subprocess
import sys
import threading
import time
import urllib.parse

failures = []
image_counts = {}
image_gates = {}
image_lock = threading.Lock()

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.headers.get('Cookie') or self.headers.get('Authorization'):
            failures.append('Credential header reached media fixture')
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        if parsed.path == '/image-counts':
            with image_lock:
                data = json.dumps(image_counts).encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path == '/release-image':
            with image_lock:
                image_gates.setdefault(query['key'][0], threading.Event()).set()
            self.send_response(200)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if parsed.path.startswith('/image-'):
            key = parsed.path.removeprefix('/image-')
            with image_lock:
                image_counts[key] = image_counts.get(key, 0) + 1
                gate = image_gates.setdefault(key, threading.Event()) if key.startswith('held-') else None
            if gate is not None:
                gate.wait(10)
            data = bytes(index % 251 for index in range(256 * 1024 + 7))
            self.send_response(200)
            if key != 'mime':
                self.send_header('Content-Type', 'text/html' if key == 'html' else 'image/png')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        mode = query.get('r', ['range'])[0].rsplit('/', 1)[-1]
        if parsed.path == '/protected':
            failures.append('Protected redirect reached media fixture')
            self.send_response(403)
            self.end_headers()
            return
        if mode == 'redirect':
            self.send_response(302)
            self.send_header('Location', 'http://localhost:%s/protected' % self.server.server_port)
            self.end_headers()
            return
        if mode == 'safe':
            self.send_response(302)
            self.send_header('Location', self.path.replace('%2Fsafe', '%2Frange').replace('/safe', '/range'))
            self.end_headers()
            return
        if self.headers.get('Range') != 'bytes=2-5':
            failures.append('Missing or altered Range request')
        if mode == 'unsatisfied':
            self.send_response(416)
            self.send_header('Content-Range', 'bytes */10')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        self.send_response(206)
        self.send_header('Content-Type', 'text/html' if mode == 'html' else 'video/' + (mode if mode in ('webm', 'ogg') else 'mp4'))
        self.send_header('Content-Length', '4')
        self.send_header('Content-Range', 'bytes 2-5/10')
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Set-Cookie', 'test=synthetic')
        self.end_headers()
        try:
            self.wfile.write(b'23')
            self.wfile.flush()
            if mode == 'slow':
                time.sleep(0.5)
            self.wfile.write(b'45')
        except (BrokenPipeError, ConnectionResetError):
            pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    home = os.path.join(os.path.dirname(sys.argv[1]), 'home')
    os.makedirs(home, exist_ok=True)
    env = dict(os.environ, HOME=home, CFFIXED_USER_HOME=home, SLAX_RESOURCE_TEST_HOME=home, SLAX_MEDIA_HOST='http://127.0.0.1:%s' % server.server_port)
    result = subprocess.run([sys.argv[1]], env=env, timeout=60)
    if failures:
        raise RuntimeError('; '.join(failures))
    sys.exit(result.returncode)
finally:
    server.shutdown()
    server.server_close()
