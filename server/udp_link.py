"""
UDP link to the Elmo: holds the current command, sends it at a fixed rate,
and hands every received report to a callback.
"""

import asyncio
import socket
import time

import icd


class _Protocol(asyncio.DatagramProtocol):
    def __init__(self, link):
        self.link = link

    def datagram_received(self, data, addr):
        self.link._on_datagram(data, addr)

    def error_received(self, exc):
        # Windows turns ICMP "port unreachable" (nobody listening at the Elmo address)
        # into ConnectionResetError on every send; the NO REPORT status already shows that.
        if isinstance(exc, ConnectionResetError):
            return
        self.link._event(f"UDP error: {exc}")


class ElmoLink:
    def __init__(self, cfg, on_report, on_event, on_packet):
        """
        on_report(report_dict, raw_bytes)  - called for each valid report
        on_event(text)                     - human readable status messages
        on_packet(direction, raw_bytes)    - every TX / RX packet ("TX" / "RX")
        """
        self.cfg = cfg
        self.net = cfg["network"]
        self.period = 1.0 / float(cfg["send_rate_hz"])
        # "per_command": counter changes only when the GUI sends a new command (like Arkolis).
        # "per_packet":  counter changes on every packet.
        self.counter_per_packet = cfg.get("message_counter", "per_command") == "per_packet"
        self.on_report = on_report
        self.on_event = on_event
        self.on_packet = on_packet

        self.transport = None
        self._task = None
        self.counter = 1
        self.command = {}
        self.reset_command()

        self.tx_count = 0
        self.rx_count = 0
        self.bad_count = 0
        self.last_rx_time = None

    # ------------------------------------------------------------ command state

    def reset_command(self):
        """Safe power-up command: motors disabled, gimbals off, zero rates."""
        cmd = {name: 0 for name in icd.COMMAND_FIELD_NAMES if name not in icd.HEADER_FIELDS}
        cmd.update(self.cfg.get("command_defaults", {}))
        cmd.update(safe_fields())
        self.command = cmd

    def update(self, fields):
        """Merge GUI changes into the command. Unknown and header fields are rejected."""
        bad = [k for k in fields if k not in self.command]
        if bad:
            raise KeyError(f"unknown command field(s): {', '.join(bad)}")
        self.command.update(fields)
        if not self.counter_per_packet:
            self.counter = (self.counter + 1) & 0xFF

    # ------------------------------------------------------------ connection

    @property
    def running(self):
        return self.transport is not None

    async def start(self):
        if self.running:
            return
        loop = asyncio.get_running_loop()
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.bind((self.net["local_ip"], int(self.net["local_port"])))
        except OSError as e:
            sock.close()
            raise OSError(
                f"Cannot open UDP {self.net['local_ip']}:{self.net['local_port']} ({e}). "
                "Check that this PC has that IP address, or change network.local_ip in config.json."
            ) from e
        sock.setblocking(False)

        self.transport, _ = await loop.create_datagram_endpoint(lambda: _Protocol(self), sock=sock)
        self.counter = 1
        self.tx_count = self.rx_count = self.bad_count = 0
        self.last_rx_time = None
        self.reset_command()
        self._task = asyncio.create_task(self._send_loop())
        self._event(
            f"UDP open {self.net['local_ip']}:{self.net['local_port']} -> "
            f"{self.net['elmo_ip']}:{self.net['elmo_port']} at {self.cfg['send_rate_hz']} Hz"
        )

    async def stop(self):
        if not self.running:
            return
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        # Leave the Elmo in a safe state before going quiet.
        self.update(safe_fields())
        self._send_once()
        self.transport.close()
        self.transport = None
        self._event("UDP closed (sent DISABLE_ALL_MOTORS + GIMBALS_OFF)")

    # ------------------------------------------------------------ TX / RX

    async def _send_loop(self):
        loop = asyncio.get_running_loop()
        next_t = loop.time()
        while True:
            self._send_once()
            next_t += self.period
            delay = next_t - loop.time()
            if delay < -self.period:  # fell far behind (e.g. PC was busy) - resync
                next_t = loop.time()
                delay = 0
            await asyncio.sleep(max(0.0, delay))

    def _send_once(self):
        data = icd.build_command(self.command, self.counter, time_stamp=0)
        try:
            self.transport.sendto(data, (self.net["elmo_ip"], int(self.net["elmo_port"])))
        except OSError as e:
            self._event(f"UDP send failed: {e}")
            return
        if self.counter_per_packet:
            self.counter = (self.counter + 1) & 0xFF
        self.tx_count += 1
        self.on_packet("TX", data)

    def _on_datagram(self, data, addr):
        self.on_packet("RX", data)
        try:
            report = icd.parse_report(data)
        except icd.ReportError as e:
            self.bad_count += 1
            self._event(f"Bad packet from {addr[0]}:{addr[1]}: {e}")
            return
        self.rx_count += 1
        self.last_rx_time = time.monotonic()
        self.on_report(report, data)

    def _event(self, text):
        self.on_event(text)

    # ------------------------------------------------------------ status

    def status(self):
        age_ms = None
        if self.last_rx_time is not None:
            age_ms = int((time.monotonic() - self.last_rx_time) * 1000)
        timeout = int(self.cfg.get("report_timeout_ms", 500))
        return {
            "connected": self.running,
            "tx_count": self.tx_count,
            "rx_count": self.rx_count,
            "bad_count": self.bad_count,
            "report_age_ms": age_ms,
            "report_ok": self.running and age_ms is not None and age_ms <= timeout,
            "command": {
                "enable_disable_motor": self.command["enable_disable_motor"],
                "gimbals_mode": self.command["gimbals_mode"],
                "yaw_rate": self.command["yaw_rate"],
                "pitch_rate": self.command["pitch_rate"],
                "yaw_angle_position": self.command["yaw_angle_position"],
                "pitch_angle_position": self.command["pitch_angle_position"],
            },
        }


def safe_fields():
    return {
        "enable_disable_motor": 0,  # DISABLE_ALL_MOTORS
        "gimbals_mode": 0,          # GIMBALS_OFF
        "yaw_rate": 0.0,
        "pitch_rate": 0.0,
    }
