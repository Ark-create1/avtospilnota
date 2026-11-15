"""Локальний сервер сайту для розробки: те саме, що `python -m http.server`, але браузер НЕ кешує файли.
Без цього після заміни style.css чи main.js браузер міг показувати стару копію, і сайт виглядав зламаним.
Запуск: py -3.12 serve.py 5500"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
    print(f"Site on http://127.0.0.1:{port}/ (без кешу)")
    ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
