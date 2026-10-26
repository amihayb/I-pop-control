# IAI POP Control

Control panel for the POP gimbal (Elmo drive, binary UDP protocol per the
BLM / Elmo ICD, V19). The ICD document itself is not included in this repository.

It has two parts:

- **Python program** (`server/`): talks to the Elmo over UDP. It sends the
  178-byte command 30 times per second and reads the 206-byte report.
- **Web page** (`web/`): the interface you see in Chrome. It talks to the
  Python program over `localhost`.

The browser cannot send UDP itself, so the Python program must be running
while you use the page.

---

## 1. One-time setup

Open a terminal (PowerShell) and run:

```powershell
cd c:\Github\I-pop-control
pip install -r requirements.txt
```

This installs `aiohttp`, the only extra Python package needed (web server and WebSocket).

## 2. Network setup (real Elmo)

| Item | Value (in `config.json`) |
|------|--------------------------|
| PC (this computer) | `192.168.2.5`, UDP port `5003` |
| Elmo | `192.168.2.6`, UDP port `5003` |

The PC's network card must have IP **192.168.2.5**. If it doesn't, the GUI log
shows `Cannot open UDP 192.168.2.5:5003`. Either set that IP in Windows, or
change `network.local_ip` in `config.json` (`"0.0.0.0"` means "any IP of this PC").

## 3. Run

```powershell
cd c:\Github\I-pop-control
python server\main.py
```

Chrome opens at **http://localhost:8080** automatically. If it doesn't, open that address yourself.
To stop the program, click the terminal and press **Ctrl+C**.

## 4. Using the GUI

1. Check that the top-right badge shows **SERVER OK**.
2. Turn on **Connection**. The PC starts sending at 30 Hz. The first command is always
   `DISABLE_ALL_MOTORS` + `GIMBALS_OFF`. The badge next to TX/RX shows **REPORT OK**
   when the Elmo answers, or **NO REPORT** if it doesn't.
3. Choose **Gimbals: 2 or 4**. 4 also shows the coarse motors and their telemetry.
4. **Motors -> Enable All**. Wait for **MOTORS ENABLED**: the Elmo echoed the
   enable and `MotorSF_DEBUG` = 2.
5. Choose a **Gimbals Mode**, or use **Movement Control**:
   - **Set Rate** switches to `RATE_MODE` and sends the yaw/pitch rates (±200 °/s).
   - **Go to Position** switches to `POSITION` and sends yaw (0-360°) and pitch (-180..180°).
   - **Jog**: in Rate mode it changes the rate by 1 or 5 °/s. In any other mode it moves
     the position by 1° or 5°. The house button zeroes the rates, or goes to 0°, 0°.
6. **STOP sign** sends `GIMBALS_OFF` + `DISABLE_ALL_MOTORS` + rates 0.

If you send a mode before the motors are confirmed enabled, a warning asks you to confirm.

Other panels:

- **Telemetry**: every value in the Elmo report.
- **Faults**: SR status, MF fault bits (red = bit set), failure bit maps, cancelled protections.
- **Log** (terminal icon): events. Turn on **Raw packets** to also see the hex bytes of
  every 30th packet (change `gui.raw_log_every_n` in `config.json`).
- **Record CSV**: saves every report to `recordings\pop_<date>_<time>.csv`.

### Behaviour to know

- Turning **Connection** off sends one `DISABLE_ALL_MOTORS` + `GIMBALS_OFF` and stops sending.
- Closing the browser tab does **not** stop anything. Python keeps sending the last command.
  Reopen the page to continue.
- Stopping the Python program (Ctrl+C) also sends `DISABLE_ALL_MOTORS` + `GIMBALS_OFF` first.

## 5. Test without hardware (simulator)

Use two terminals:

```powershell
# terminal 1 - fake Elmo
cd c:\Github\I-pop-control
python tools\fake_elmo.py
```

```powershell
# terminal 2 - the GUI server, pointed at the fake Elmo
cd c:\Github\I-pop-control
python server\main.py --sim
```

The fake Elmo echoes enable/mode, reports `MotorSF_DEBUG` = 2, and moves the angles
in rate / position mode. Add `--fault` to make it report an MF fault on Yaw fine.

## 6. Configuration (`config.json`)

| Key | Meaning |
|-----|---------|
| `network` | PC and Elmo IP / port |
| `send_rate_hz` | Command rate (default 30) |
| `report_timeout_ms` | Show NO REPORT after this long without a report |
| `web.port` | Page address port (default 8080) |
| `gui.default_gimbal_count` | 2 or 4 on first start (the GUI remembers your last choice) |
| `limits` | Rate and angle limits (enforced in the page and in Python) |
| `enums` | Names of all value lists (modes, motor commands, busy, angle limit...). Edit the names here |
| `command_defaults` | Values sent for command fields that have no GUI control yet (track error, protections, gyro bias, spares...) |

After editing `config.json`, restart the Python program.

## Project structure

```
I-pop-control/
├── config.json          settings (network, rate, value lists, defaults)
├── requirements.txt     Python packages
├── server/
│   ├── main.py          start here: web server + WebSocket + glue
│   ├── udp_link.py      UDP socket, 30 Hz send loop, report reception
│   ├── icd.py           byte layout of command (178 B) and report (206 B)
│   └── recorder.py      CSV recording
├── web/
│   ├── index.html       page layout (sidebar, log)
│   ├── app.js           GUI logic (commands, handshake, live updates)
│   ├── panelUI.js       Movement / Telemetry / Faults panels
│   ├── popLink.js       WebSocket connection to the Python program
│   └── StyleSheet.css   styles (based on rp-gimbal-control)
├── tools/
│   └── fake_elmo.py     Elmo simulator for testing
└── images/ fonts/ vendor/   logos, icons, SweetAlert2
```

## ICD notes (choices made)

- Header: sync 100, opcode 1, counter starts at 0 and wraps at 255, `Time_Stamp` = 0.
- SR status bytes (85-88) are decoded as in the Arkolis tool: bits 0-3 power-drive state,
  bit 4 servo enabled, bit 5 current limit, bit 6 STO1 active, bit 7 STO diagnostics failed.
- Value lists follow ICD V19 and can be renamed in `config.json`.
