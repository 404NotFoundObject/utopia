#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
静态文件服务器（跨平台）
- 支持 HTTP Range 请求（大文件分块加载）
- 多线程并发
- 脚本所在目录自动作为网站根目录
- 自定义端口
- 端口冲突自动 +1 重试
- Termux 环境自动获取唤醒锁（PC 上自动跳过）
"""

import http.server
import socketserver
import os
import re
import sys
import threading
import time
import signal
import urllib.request
import platform

# ---------- 基础配置 ----------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PORT = 8080
HEARTBEAT = True
HEARTBEAT_INTERVAL = 60

# 判断是否 Termux 环境
IS_TERMUX = 'com.termux' in os.environ.get('PREFIX', '') or 'termux' in platform.release().lower()
WAKE_LOCK = IS_TERMUX  # 只在 Termux 上启用


class RangeRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        if not os.path.exists(path):
            self.send_error(404, "File not found")
            return None
        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(403, "Forbidden")
            return None

        fs = os.fstat(f.fileno())
        size = fs.st_size
        start, end = 0, size - 1

        range_header = self.headers.get('Range')
        if range_header:
            m = re.match(r'bytes=(\d+)-(\d*)', range_header)
            if m:
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
                if start >= size:
                    self.send_error(416, "Requested Range Not Satisfiable")
                    f.close()
                    return None
                end = min(end, size - 1)
                self.send_response(206)
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        else:
            self.send_response(200)

        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        f.seek(start)
        return f

    def guess_type(self, path):
        if path.endswith('.onnx'):
            return 'application/octet-stream'
        return super().guess_type(path)

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionResetError, BrokenPipeError):
            pass

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (ConnectionResetError, BrokenPipeError):
            pass


def acquire_wake_lock():
    if not WAKE_LOCK:
        return
    try:
        os.system('termux-wake-lock >/dev/null 2>&1')
        print("[保活] termux-wake-lock 已获取")
    except Exception:
        pass


def release_wake_lock():
    if not WAKE_LOCK:
        return
    try:
        os.system('termux-wake-unlock >/dev/null 2>&1')
    except Exception:
        pass


def keep_alive_ping(url, interval, stop_event):
    while not stop_event.is_set():
        try:
            urllib.request.urlopen(url, timeout=5)
        except Exception:
            pass
        if stop_event.wait(interval):
            break


def parse_port():
    if len(sys.argv) > 1:
        try:
            return int(sys.argv[1])
        except ValueError:
            print(f"端口参数无效：{sys.argv[1]}，使用默认端口 {DEFAULT_PORT}")
    return DEFAULT_PORT


def bind_server(port, max_try=10):
    for i in range(max_try):
        try:
            httpd = socketserver.ThreadingTCPServer(("", port), RangeRequestHandler)
            return httpd, port
        except OSError as e:
            print(f"端口 {port} 不可用（{e}），尝试 {port + 1} ...")
            port += 1
    raise RuntimeError(f"连续 {max_try} 个端口都被占用")


def main():
    port = parse_port()
    acquire_wake_lock()
    httpd, port = bind_server(port)
    httpd.daemon_threads = True
    httpd.allow_reuse_address = True

    print("=" * 50)
    print(f"网站根目录: {BASE_DIR}")
    print(f"本机访问:   http://localhost:{port}")
    print(f"局域网访问: http://<本机IP>:{port}")
    print("按 Ctrl+C 停止服务")
    print("=" * 50)

    stop_event = threading.Event()
    if HEARTBEAT:
        t = threading.Thread(
            target=keep_alive_ping,
            args=(f'http://127.0.0.1:{port}/', HEARTBEAT_INTERVAL, stop_event),
            daemon=True,
        )
        t.start()

    def shutdown(signum, frame):
        print("\n正在关闭服务...")
        stop_event.set()
        httpd.shutdown()
        release_wake_lock()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    try:
        signal.signal(signal.SIGTERM, shutdown)
    except Exception:
        pass  # Windows 上 SIGTERM 支持有限

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        shutdown(None, None)
    finally:
        httpd.server_close()


if __name__ == '__main__':
    main()