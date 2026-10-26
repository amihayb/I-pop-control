"""
Fake Elmo for testing IAI POP Control without hardware.

Listens for 178-byte commands and answers each one with a 206-byte report:
echoes motor enable / gimbals mode, reports MotorSF_DEBUG = 2, and moves the
LOS angles in RATE_MODE (integrates the rate) and POSITION (slews to target).

Run:   python tools\\fake_elmo.py
Then:  python server\\main.py --sim
"""

import argparse
import os
import random
import socket
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))
import icd  # noqa: E402

RATE_MODE = 1
POSITION = 2
SLEW_DEG_S = 30.0


def wrap360(a):
    return a % 360.0


def step_toward(cur, target, max_step, circular):
    diff = target - cur
    if circular:
        diff = (diff + 180.0) % 360.0 - 180.0
    diff = max(-max_step, min(max_step, diff))
    return cur + diff


def main():
    p = argparse.ArgumentParser(description="Fake Elmo UDP simulator")
    p.add_argument("--ip", default="127.0.0.1")
    p.add_argument("--port", type=int, default=5004)
    p.add_argument("--fault", action="store_true", help="set an MF fault bit (underVoltageErr) on yaw fine")
    args = p.parse_args()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((args.ip, args.port))
    sock.settimeout(0.5)
    print(f"Fake Elmo listening on {args.ip}:{args.port}  (Ctrl+C to quit)", flush=True)

    yaw = 0.0
    pitch = 0.0
    yaw_rate = pitch_rate = 0.0
    counter = 0
    last_t = time.monotonic()
    start = last_t
    received = 0

    while True:
        try:
            data, addr = sock.recvfrom(2048)
        except (socket.timeout, ConnectionResetError):
            continue
        except KeyboardInterrupt:
            break
        if len(data) != icd.COMMAND_LENGTH or data[0] != icd.SYNC_WORD:
            print(f"ignored packet len={len(data)} from {addr}", flush=True)
            continue
        cmd = icd.parse_command(data)
        received += 1

        now = time.monotonic()
        dt = now - last_t
        last_t = now

        motor = cmd["enable_disable_motor"]
        enabled = motor != 0
        mode = cmd["gimbals_mode"] if enabled else 0

        if mode == RATE_MODE:
            yaw_rate, pitch_rate = cmd["yaw_rate"], cmd["pitch_rate"]
            yaw = wrap360(yaw + yaw_rate * dt)
            pitch = max(-180.0, min(180.0, pitch + pitch_rate * dt))
        elif mode == POSITION:
            ny = step_toward(yaw, cmd["yaw_angle_position"], SLEW_DEG_S * dt, True)
            np_ = step_toward(pitch, cmd["pitch_angle_position"], SLEW_DEG_S * dt, False)
            yaw_rate = (ny - yaw) / dt if dt > 0 else 0.0
            pitch_rate = (np_ - pitch) / dt if dt > 0 else 0.0
            yaw, pitch = wrap360(ny), np_
        else:
            yaw_rate = pitch_rate = 0.0

        sr = (1 << 4) if enabled else 0  # power OK, servo enabled bit
        noise = lambda s: random.gauss(0.0, s)  # noqa: E731
        report = {
            "time_stamp": int((now - start) * 1000),
            "enable_disable_motor": motor,
            "gimbals_mode": mode,
            "special_command": cmd["special_command"],
            "yaw_rate": yaw_rate,
            "pitch_rate": pitch_rate,
            "track_error_time_tag": cmd["track_error_time_tag"],
            "gmcu_measure_angle_timer": int(((now - start) % 1.0) * 1e6),
            "camera_sync_timer": int(((now - start) % (1 / 30)) * 1e6),
            "yaw_los_angle": yaw,
            "pitch_los_angle": pitch,
            "yaw_fine_angle": yaw + noise(0.01),
            "pitch_fine_angle": pitch + noise(0.01),
            "yaw_coarse_angle": yaw,
            "pitch_coarse_angle": pitch,
            "yaw_fine_current": (0.3 + abs(yaw_rate) * 0.01 + noise(0.02)) if enabled else 0.0,
            "pitch_fine_current": (0.4 + abs(pitch_rate) * 0.01 + noise(0.02)) if enabled else 0.0,
            "yaw_fine_temperature": 38,
            "pitch_fine_temperature": 40,
            "yaw_coarse_temperature": 35,
            "pitch_coarse_temperature": 36,
            "yaw_fine_sr": sr,
            "pitch_fine_sr": sr,
            "yaw_coarse_sr": sr,
            "pitch_coarse_sr": sr,
            "yaw_fine_mf": (1 << 12) if args.fault else 0,
            "cancel_protect_yaw_echo": cmd["cancel_protect_yaw"],
            "cancel_protect_pi_echo": cmd["cancel_protect_pi"],
            "cancelled_yaw_protections": cmd["cancelled_yaw_protections"],
            "cancelled_pi_protections": cmd["cancelled_pi_protections"],
            "motor_sf_debug": 2,
            "control_sw_number": 1234,
            "control_sw_version": 10019,
            "control_sw_project": 1000,
            "gyro_x": noise(0.002),
            "gyro_y": noise(0.002),
            "gyro_z": noise(0.002),
            "counter_1pps": float(int(now - start)),
            "gyro_temperature": 41.5,
        }
        sock.sendto(icd.build_report(report, counter), addr)
        counter = (counter + 1) & 0xFF

        if received % 300 == 1:
            print(f"rx {received} cmds  motor={motor} mode={mode}  yaw={yaw:.2f} pitch={pitch:.2f}", flush=True)


if __name__ == "__main__":
    main()
