"""Offline-local browser app. Opened on 127.0.0.1 only; no cloud upload."""
from __future__ import annotations
import argparse
import hashlib
import json
import mimetypes
import os
import socket
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from engine import decode_image, detect_cells, make_preview, previous_match, export_archive, EXTENSIONS

ROOT=Path(__file__).resolve().parent
# Optional local-only history; excluded from the GitHub distribution.
HISTORY_FILE = ROOT / 'previous_data.json'
PREVIOUS = json.loads(HISTORY_FILE.read_text(encoding='utf-8')) if HISTORY_FILE.is_file() else {}
IMAGES={}
MAX_BYTES=90*1024*1024


class Handler(BaseHTTPRequestHandler):
    server_version='CellCountLocal/1.0'

    def log_message(self, fmt, *args):
        if '/api/ping' not in fmt: super().log_message(fmt,*args)

    def send_data(self, payload, status=200, content_type='application/json',filename=None):
        if isinstance(payload,(dict,list)):
            payload=json.dumps(payload,ensure_ascii=False).encode('utf-8')
        if isinstance(payload,str): payload=payload.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type',content_type + ('; charset=utf-8' if content_type.startswith(('application/json','text/','application/javascript')) else ''))
        self.send_header('Content-Length',str(len(payload)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Access-Control-Allow-Origin','') if False else None
        if filename:self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
        self.end_headers()
        try:self.wfile.write(payload)
        except (BrokenPipeError,ConnectionResetError):pass

    def fail(self, msg, code=400):
        self.send_data({'error':str(msg)},status=code)

    def do_GET(self):
        try:
            path=urlparse(self.path).path
            if path=='/api/ping':return self.send_data({'ok':True})
            if path.startswith('/api/image/'):
                ident=path.split('/')[-1]
                data=IMAGES.get(ident)
                if data is None:return self.fail('画像が見つかりません。',404)
                return self.send_data(data['preview'],content_type='image/jpeg')
            static_map={'/':'static/index.html','/index.html':'static/index.html',
                        '/style.css':'static/style.css','/app.js':'static/app.js'}
            fn=static_map.get(path)
            if not fn:return self.fail('Not found',404)
            mime={'/':'text/html','/index.html':'text/html','/style.css':'text/css','/app.js':'application/javascript'}[path]
            return self.send_data((ROOT/fn).read_bytes(),content_type=mime)
        except Exception as e:
            self.fail(e,500)

    def read_body(self,limit=MAX_BYTES):
        n=int(self.headers.get('Content-Length',-1))
        if not(0<=n<=limit):raise ValueError(f'送信データが大きすぎます（上限{limit//1024//1024} MB）。')
        return self.rfile.read(n)

    def do_POST(self):
        try:
            parsed=urlparse(self.path);path=parsed.path
            if path=='/api/upload':
                if len(IMAGES)>=16:raise ValueError('一度に読み込める画像は16枚までです。')
                q=parse_qs(parsed.query)
                name=Path((q.get('name') or ['image.tif'])[0]).name
                if not name or Path(name).suffix.lower() not in EXTENSIONS:
                    raise ValueError('TIFF/PNG/JPEG/BMP/WebP画像を選択してください。')
                blob=self.read_body()
                if not blob:raise ValueError('画像ファイルが空です。')
                sha=hashlib.sha256(blob).hexdigest()
                existing_id=next((k for k,meta in IMAGES.items() if meta['sha256']==sha),None)
                if existing_id is not None:
                    meta=IMAGES[existing_id]
                    return self.send_data(dict(id=existing_id,name=meta['name'],
                        width=meta['img'].shape[1],height=meta['img'].shape[0],
                        sha256=sha,url=f'/api/image/{existing_id}',
                        previous=previous_match(meta['name'],sha,PREVIOUS)))
                img=decode_image(blob)
                h,w=img.shape[:2]
                ident=uuid.uuid4().hex
                preview=make_preview(img)
                IMAGES[ident]=dict(name=name,sha256=sha,img=img,preview=preview)
                known=previous_match(name,sha,PREVIOUS)
                return self.send_data(dict(id=ident,name=name,width=w,height=h,sha256=sha,
                                           url=f'/api/image/{ident}',previous=known))
            if path=='/api/reset':
                IMAGES.clear()
                return self.send_data({'ok':True})
            data=json.loads(self.read_body(limit=8*1024*1024).decode('utf-8'))
            if path=='/api/detect':
                obj=IMAGES.get(data.get('imageId'))
                if obj is None:raise ValueError('画像がありません。先にアップロードしてください。')
                points=detect_cells(obj['img'],data['roi'],data['letter'],
                    data.get('mode','purple'),data.get('threshold',18),
                    data.get('minArea',55),data.get('maxArea',2000),bool(data.get('estimateMulti',False)),data.get('thickSides'))
                return self.send_data({'points':points,'count':sum(int(p['mult']) for p in points if p['included'])})
            if path=='/api/export':
                b=export_archive(data,IMAGES)
                return self.send_data(b,content_type='application/zip',filename='Hemocytometer_results.zip')
            return self.fail('Not found',404)
        except Exception as e:
            self.fail(e)


def find_port(start=8765):
    for p in range(start,start+25):
        with socket.socket() as s:
            try:s.bind(('127.0.0.1',p))
            except OSError:continue
            return p
    raise RuntimeError('利用できるローカルポートが見つかりません。')


def main():
    parser=argparse.ArgumentParser(description='Cell counting local GUI')
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--no-browser',action='store_true')
    args=parser.parse_args()
    port=find_port(args.port)
    httpd=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    httpd.daemon_threads=True
    url=f'http://127.0.0.1:{port}/'
    print('\n'+'='*64)
    print(' 細胞計数盤カウンター - ブラウザ版')
    print(' '+url)
    print(' 終了するときは、この画面で Ctrl+C を押してください。')
    print(' 画像は外部サービスへアップロードされません。')
    print('='*64+'\n',flush=True)
    if not args.no_browser:
        threading.Timer(0.8,lambda: webbrowser.open(url)).start()
    try:httpd.serve_forever(poll_interval=.2)
    except KeyboardInterrupt:print('\n終了します。')
    finally:httpd.server_close()


if __name__=='__main__':main()
