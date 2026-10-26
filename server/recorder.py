"""CSV recording of every received report plus the main command fields."""

import csv
import datetime
import os
import time

import icd

COMMAND_COLUMNS = [
    "enable_disable_motor",
    "gimbals_mode",
    "yaw_rate",
    "pitch_rate",
    "yaw_angle_position",
    "pitch_angle_position",
]


class Recorder:
    def __init__(self, folder):
        self.folder = folder
        self._file = None
        self._writer = None
        self.path = None
        self.rows = 0
        self._last_flush = 0.0

    @property
    def active(self):
        return self._file is not None

    def start(self):
        if self.active:
            return self.path
        os.makedirs(self.folder, exist_ok=True)
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        self.path = os.path.join(self.folder, f"pop_{stamp}.csv")
        self._file = open(self.path, "w", newline="", encoding="utf-8")
        self._writer = csv.writer(self._file)
        self._writer.writerow(
            ["pc_time"] + icd.REPORT_FIELD_NAMES + [f"cmd_{c}" for c in COMMAND_COLUMNS]
        )
        self.rows = 0
        return self.path

    def stop(self):
        if not self.active:
            return
        self._file.close()
        self._file = None
        self._writer = None

    def write(self, report, command):
        if not self.active:
            return
        now = time.time()
        row = [f"{now:.4f}"]
        row += [report[name] for name in icd.REPORT_FIELD_NAMES]
        row += [command.get(c) for c in COMMAND_COLUMNS]
        self._writer.writerow(row)
        self.rows += 1
        if now - self._last_flush > 1.0:
            self._file.flush()
            self._last_flush = now
