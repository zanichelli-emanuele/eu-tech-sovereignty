#!/usr/bin/env python3
"""Tiny static dev server that sends no-store headers, so the browser never serves a
stale CSS/JS cache while iterating. Usage: python3 serve.py [port]  (default 8000)."""
import http.server, socketserver, os, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()
    def log_message(self, *a):
        pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"serving {os.getcwd()} (no-store) on http://localhost:{PORT}")
    httpd.serve_forever()
