from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
import socket,webbrowser,sys
root=Path(__file__).resolve().parent
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**k):super().__init__(*a,directory=str(root),**k)
 def log_message(self,format,*args):pass
 def end_headers(self):self.send_header('Cache-Control','no-cache');super().end_headers()
for port in range(8877,8897):
 try:server=ThreadingHTTPServer(('127.0.0.1',port),Handler);break
 except OSError:continue
else:raise SystemExit('No free local port found.')
url=f'http://127.0.0.1:{port}/index.html';print('Offline map:',url,flush=True);print('All map requests stay on your computer. Leave this window open; Ctrl+C to stop.',flush=True)
if '--no-browser' not in sys.argv:webbrowser.open(url)
try:server.serve_forever()
except KeyboardInterrupt:server.server_close()
