"""
IAI POP Control - server.

Talks to the Elmo over UDP (udp_link.py) and serves the web GUI on localhost.
The browser and this program talk over a WebSocket at /ws using JSON messages.

Run from the project folder:   python server\\main.py
"""

import argparse
import asyncio
import json
import math
import os
import sys
import webbrowser

from aiohttp import web, WSMsgType

import icd
from recorder import Recorder
from udp_link import ElmoLink, safe_fields

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_config(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def clean(value):
    """JSON cannot carry NaN / Infinity; send them as null."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


class PopServer:
    def __init__(self, cfg):
        self.cfg = cfg
        self.clients = set()
        self.latest_report = None
        self.raw_log = False
        self._raw_n = max(1, int(cfg["gui"].get("raw_log_every_n", 30)))
        self._raw_counts = {"TX": 0, "RX": 0}
        self.recorder = Recorder(os.path.join(ROOT, cfg.get("recordings_folder", "recordings")))
        self.link = ElmoLink(cfg, self._on_report, self.event, self._on_packet)

    # ------------------------------------------------------------ outgoing

    def broadcast(self, msg):
        if not self.clients:
            return
        text = json.dumps(msg)
        for ws in list(self.clients):
            if not ws.closed:
                asyncio.ensure_future(ws.send_str(text))

    def event(self, text):
        print(text, flush=True)
        self.broadcast({"type": "event", "text": text})

    def _on_report(self, report, raw):
        self.latest_report = report
        self.recorder.write(report, self.link.command)

    def _on_packet(self, direction, raw):
        if not self.raw_log:
            return
        self._raw_counts[direction] += 1
        if (self._raw_counts[direction] - 1) % self._raw_n:
            return
        self.broadcast({"type": "raw", "dir": direction, "len": len(raw), "hex": raw.hex(" ")})

    def tick_message(self):
        report = None
        if self.latest_report is not None:
            report = {k: clean(v) for k, v in self.latest_report.items()}
        return {
            "type": "tick",
            "status": self.link.status(),
            "report": report,
            "recording": {
                "active": self.recorder.active,
                "path": self.recorder.path,
                "rows": self.recorder.rows,
            },
        }

    async def tick_loop(self):
        period = 1.0 / float(self.cfg["gui"].get("ui_update_hz", 10))
        while True:
            await asyncio.sleep(period)
            if not self.link.running:
                self.latest_report = None
            self.broadcast(self.tick_message())

    # ------------------------------------------------------------ incoming

    def _clamp_fields(self, fields):
        lim = self.cfg["limits"]
        r = float(lim["rate_deg_s"])
        bounds = {
            "yaw_rate": (-r, r),
            "pitch_rate": (-r, r),
            "yaw_angle_position": (lim["yaw_min_deg"], lim["yaw_max_deg"]),
            "pitch_angle_position": (lim["pitch_min_deg"], lim["pitch_max_deg"]),
        }
        out = dict(fields)
        for name, (lo, hi) in bounds.items():
            if name in out:
                out[name] = min(max(float(out[name]), lo), hi)
        return out

    async def handle_message(self, msg):
        kind = msg.get("type")
        if kind == "connect":
            try:
                await self.link.start()
            except OSError as e:
                self.event(str(e))
        elif kind == "disconnect":
            await self.link.stop()
        elif kind == "set":
            try:
                self.link.update(self._clamp_fields(msg.get("fields", {})))
            except (KeyError, ValueError, TypeError) as e:
                self.event(f"Command rejected: {e}")
        elif kind == "estop":
            self.link.update(safe_fields())
            self.event("EMERGENCY STOP: GIMBALS_OFF + DISABLE_ALL_MOTORS + rates 0")
        elif kind == "record":
            if msg.get("on"):
                path = self.recorder.start()
                self.event(f"Recording to {path}")
            else:
                self.recorder.stop()
                self.event(f"Recording stopped ({self.recorder.rows} rows)")
        elif kind == "rawlog":
            self.raw_log = bool(msg.get("on"))
            self._raw_counts = {"TX": 0, "RX": 0}
        else:
            self.event(f"Unknown GUI message: {kind}")

    async def ws_handler(self, request):
        ws = web.WebSocketResponse(heartbeat=10)
        await ws.prepare(request)
        self.clients.add(ws)
        await ws.send_str(json.dumps(self.hello_message()))
        try:
            async for m in ws:
                if m.type == WSMsgType.TEXT:
                    try:
                        await self.handle_message(json.loads(m.data))
                    except json.JSONDecodeError:
                        self.event("Bad JSON from GUI")
                    except Exception as e:
                        self.event(f"Server error: {type(e).__name__}: {e}")
        finally:
            self.clients.discard(ws)
        return ws

    def hello_message(self):
        return {
            "type": "hello",
            "config": {
                "network": self.cfg["network"],
                "send_rate_hz": self.cfg["send_rate_hz"],
                "report_timeout_ms": self.cfg.get("report_timeout_ms", 500),
                "gui": self.cfg["gui"],
                "limits": self.cfg["limits"],
                "enums": self.cfg["enums"],
            },
            "bits": {
                "fault": icd.FAULT_BITS,
                "failure_elmo_1": icd.FAILURE_ELMO_1_BITS,
                "generic_8": icd.GENERIC_8_BITS,
            },
            "raw_log": self.raw_log,
        }

    # ------------------------------------------------------------ app

    async def index(self, request):
        return web.FileResponse(os.path.join(ROOT, "web", "index.html"))

    def make_app(self):
        app = web.Application()
        app.router.add_get("/", self.index)
        app.router.add_get("/ws", self.ws_handler)
        app.router.add_static("/static", os.path.join(ROOT, "web"))
        for folder in ("images", "fonts", "vendor"):
            app.router.add_static(f"/{folder}", os.path.join(ROOT, folder))

        async def on_startup(app):
            app["tick"] = asyncio.create_task(self.tick_loop())

        async def on_cleanup(app):
            app["tick"].cancel()
            await self.link.stop()
            self.recorder.stop()

        app.on_startup.append(on_startup)
        app.on_cleanup.append(on_cleanup)
        return app


def main():
    parser = argparse.ArgumentParser(description="IAI POP Control server")
    parser.add_argument("--config", default=os.path.join(ROOT, "config.json"))
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser")
    parser.add_argument("--sim", action="store_true",
                        help="talk to tools/fake_elmo.py on 127.0.0.1:5004 instead of the real Elmo")
    args = parser.parse_args()

    cfg = load_config(args.config)
    if args.sim:
        cfg["network"] = {"local_ip": "127.0.0.1", "local_port": 5003,
                          "elmo_ip": "127.0.0.1", "elmo_port": 5004}
        print("SIMULATION: using fake Elmo at 127.0.0.1:5004", flush=True)
    server = PopServer(cfg)
    host, port = cfg["web"]["host"], int(cfg["web"]["port"])
    url = f"http://localhost:{port}" if host in ("127.0.0.1", "0.0.0.0") else f"http://{host}:{port}"

    print(f"IAI POP Control - open {url} in Chrome  (Ctrl+C to quit)", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    web.run_app(server.make_app(), host=host, port=port, print=None)


if __name__ == "__main__":
    sys.exit(main())
