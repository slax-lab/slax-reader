import http.server
import os
import subprocess
import sys
import threading
import time
import urllib.parse

failures = []

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.headers.get('Cookie') or self.headers.get('Authorization'):
            failures.append('Credential header reached media fixture')
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
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
    env = dict(os.environ, SLAX_MEDIA_HOST='http://127.0.0.1:%s' % server.server_port)
    result = subprocess.run([sys.argv[1]], env=env, timeout=60)
    if failures:
        raise RuntimeError('; '.join(failures))
    sys.exit(result.returncode)
finally:
    server.shutdown()
    server.server_close()
