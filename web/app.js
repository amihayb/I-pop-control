// IAI POP Control — main application logic.
// Talks to the Python server through PopLink (popLink.js); panels are built in panelUI.js.

const APP = {
  cfg:          null,   // from server "hello": network, limits, enums, gui ...
  bits:         null,   // bit-name lists for fault / failure maps
  serverOnline: false,
  status:       null,   // link status + commanded values (every tick)
  report:       null,   // latest decoded Elmo report, or null
  gimbalCount:  2,
};

const $ = id => document.getElementById(id);
let link = null;
let _toggleHoldUntil = 0;   // ignore server sync of toggles right after a user click

// ==================== Enum helpers ====================

function enumList(name) {
  return (APP.cfg && APP.cfg.enums && APP.cfg.enums[name]) || [];
}

function enumName(list, value) {
  if (value === null || value === undefined) return '---';
  const e = enumList(list).find(x => x.value === value);
  return e ? e.name : String(value);
}

function enumValue(list, name, fallback) {
  const e = enumList(list).find(x => x.name === name);
  return e ? e.value : fallback;
}

const MODE_RATE     = () => enumValue('gimbals_mode', 'RATE_MODE', 1);
const MODE_POSITION = () => enumValue('gimbals_mode', 'POSITION', 2);

// ==================== Logging ====================

const LOG_MAX_CHARS = 200000;

function log(message) {
  console.log(message);
  const el = $('log');
  if (!el) return;
  const t = new Date().toTimeString().slice(0, 8);
  el.textContent += `[${t}] ${message}\n`;
  if (el.textContent.length > LOG_MAX_CHARS) {
    el.textContent = el.textContent.slice(-LOG_MAX_CHARS / 2);
  }
  el.scrollTop = el.scrollHeight;
}

function clearLog() {
  const el = $('log');
  if (el) el.textContent = '';
}

function toggleLog() {
  const section = $('log-section');
  const btn     = $('log-toggle-btn');
  if (!section) return;
  const hiding = section.style.display !== 'none';
  section.style.display = hiding ? 'none' : '';
  if (btn) btn.classList.toggle('log-hidden', hiding);
}

// ==================== Theme / About ====================

function updateThemeIcon(theme) {
  const icon = $('theme-icon');
  if (icon) icon.className = theme === 'light' ? 'fa fa-sun-o' : 'fa fa-moon-o';
}

function toggleTheme() {
  const html   = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  if (isDark) html.removeAttribute('data-theme');
  else        html.setAttribute('data-theme', 'dark');
  const theme = isDark ? 'light' : 'dark';
  localStorage.setItem('pop-theme', theme);
  updateThemeIcon(theme);
}

function about() {
  const n = APP.cfg ? APP.cfg.network : null;
  Swal.fire({
    title: 'IAI POP Control',
    html:  'Control panel for the POP gimbal (Elmo, binary UDP ICD).<br><br>'
         + (n ? `PC ${n.local_ip}:${n.local_port} &rarr; Elmo ${n.elmo_ip}:${n.elmo_port}<br>`
              + `Command rate ${APP.cfg.send_rate_hz} Hz` : 'Server offline')
         + '<br><br>For support, contact me:<br><br> Amihay Blau <br> Mail: '
         + '<a href="mailto:amihay@blaurobotics.co.il" style="text-decoration:none;">'
         + 'amihay@blaurobotics.co.il</a> <br> Phone: +972-54-6668902',
    icon: 'info',
  });
}

// ==================== Server connection ====================

function sendToServer(msg) {
  if (!link || !link.send(msg)) {
    log('Python server is offline — command not sent.');
    return false;
  }
  return true;
}

function sendSet(fields) {
  return sendToServer({ type: 'set', fields });
}

function onServerMessage(msg) {
  switch (msg.type) {
    case 'hello':
      APP.cfg  = msg.config;
      APP.bits = msg.bits;
      buildModeButtons();
      setGimbalCount(Number(localStorage.getItem('pop-gimbals')) || APP.cfg.gui.default_gimbal_count || 2);
      $('rawlog-toggle').checked = !!msg.raw_log;
      log(`Server ready. Elmo ${APP.cfg.network.elmo_ip}:${APP.cfg.network.elmo_port}, `
        + `${APP.cfg.send_rate_hz} Hz.`);
      break;
    case 'tick':
      APP.status = msg.status;
      APP.report = msg.report;
      onTick(msg);
      break;
    case 'event':
      log(msg.text);
      break;
    case 'raw':
      log(`${msg.dir} (${msg.len} B): ${msg.hex}`);
      break;
  }
}

function setServerOnline(online) {
  APP.serverOnline = online;
  const b = $('server-status');
  b.textContent = online ? 'SERVER OK' : 'SERVER OFFLINE';
  b.className   = `status-badge ${online ? 'ok' : 'err'}`;
  if (!online) {
    APP.status = null;
    APP.report = null;
    refreshUI();
    log('Lost connection to the Python server (is "python server\\main.py" running?). Retrying...');
  }
}

// ==================== Gimbal configuration (2 / 4) ====================

function setGimbalCount(n) {
  APP.gimbalCount = n === 4 ? 4 : 2;
  localStorage.setItem('pop-gimbals', String(APP.gimbalCount));
  document.body.classList.toggle('gimbals-2', APP.gimbalCount === 2);
  document.body.classList.toggle('gimbals-4', APP.gimbalCount === 4);
  $('btn-gimbals-2').classList.toggle('active-mode', APP.gimbalCount === 2);
  $('btn-gimbals-4').classList.toggle('active-mode', APP.gimbalCount === 4);
  refreshUI();
}

// ==================== Motors + handshake ====================

function isConnected() {
  return !!(APP.status && APP.status.connected);
}

function commanded(field) {
  return APP.status && APP.status.command ? APP.status.command[field] : null;
}

// Per ICD: motors count as enabled only after the Elmo echoes the enable value
// and reports MotorSF_DEBUG = 2.
function motorsConfirmed() {
  const r = APP.report;
  const c = commanded('enable_disable_motor');
  return !!r && c !== null
    && enumName('enable_disable_motor', c).startsWith('ENABLE')
    && r.enable_disable_motor === c
    && r.motor_sf_debug === 2;
}

async function confirmWarning(title, text) {
  const res = await Swal.fire({
    title, html: text, icon: 'warning',
    showCancelButton: true, confirmButtonText: 'Send anyway', cancelButtonText: 'Cancel',
  });
  return res.isConfirmed;
}

async function sendMotor(name) {
  if (!isConnected()) { log('Not connected.'); return; }
  const value = enumValue('enable_disable_motor', name, null);
  if (value === null) { log(`"${name}" is not in config.json enums.enable_disable_motor`); return; }

  if (name.startsWith('ENABLE') && (!APP.report || APP.report.motor_sf_debug !== 2)) {
    const ok = await confirmWarning('Elmo not ready for enable',
      `MotorSF_DEBUG is <b>${APP.report ? APP.report.motor_sf_debug : 'unknown'}</b> (ICD: send enable only when it is 2).`);
    if (!ok) return;
  }
  if (sendSet({ enable_disable_motor: value })) log(`Motors → ${name}`);
}

// Returns true if it is OK to send `modeValue` (warns when motors are not confirmed).
async function confirmModeChange(modeValue) {
  if (modeValue === enumValue('gimbals_mode', 'GIMBALS_OFF', 0)) return true;
  if (modeValue === commanded('gimbals_mode')) return true;
  if (motorsConfirmed()) return true;
  return confirmWarning('Motors not confirmed enabled',
    'The Elmo has not echoed an ENABLE command with MotorSF_DEBUG = 2.<br>'
    + `Send mode <b>${enumName('gimbals_mode', modeValue)}</b> anyway?`);
}

// ==================== Gimbals mode ====================

function buildModeButtons() {
  const box = $('mode-buttons');
  box.innerHTML = enumList('gimbals_mode').map(m =>
    `<button class="mode-btn conn-only" id="mode-btn-${m.value}" title="${m.value} = ${m.name}"
             onclick="setGimbalsMode(${m.value})">${m.name}</button>`).join('');
  refreshUI();
}

async function setGimbalsMode(value) {
  if (!isConnected()) { log('Not connected.'); return; }
  if (!(await confirmModeChange(value))) return;
  if (sendSet({ gimbals_mode: value })) log(`Gimbals mode → ${enumName('gimbals_mode', value)}`);
}

// ==================== Emergency stop ====================

function emergencyStop() {
  sendToServer({ type: 'estop' });
  ['rate-yaw', 'rate-pitch'].forEach(id => { const el = $(id); if (el) el.value = '0'; });
}

// ==================== Rate / Position ====================

function _num(id) {
  const el = $(id);
  return el ? (Number(el.value) || 0) : 0;
}

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function _limits() {
  return APP.cfg.limits;
}

async function setRate() {
  if (!isConnected()) { log('Not connected.'); return; }
  const lim = _limits();
  const yaw   = _clamp(_num('rate-yaw'),   -lim.rate_deg_s, lim.rate_deg_s);
  const pitch = _clamp(_num('rate-pitch'), -lim.rate_deg_s, lim.rate_deg_s);
  const mode  = MODE_RATE();
  if (!(await confirmModeChange(mode))) return;
  if (sendSet({ gimbals_mode: mode, yaw_rate: yaw, pitch_rate: pitch })) {
    log(`Rate → Yaw ${yaw} °/s  Pitch ${pitch} °/s`);
  }
}

function stopRate() {
  if (!isConnected()) return;
  ['rate-yaw', 'rate-pitch'].forEach(id => { const el = $(id); if (el) el.value = '0'; });
  if (sendSet({ yaw_rate: 0, pitch_rate: 0 })) log('Rate stopped (0 °/s)');
}

function _wrapYaw(v) {
  const lim = _limits();
  if (lim.yaw_min_deg === 0 && lim.yaw_max_deg === 360) return ((v % 360) + 360) % 360;
  return _clamp(v, lim.yaw_min_deg, lim.yaw_max_deg);
}

async function _sendPosition(yaw, pitch) {
  const lim = _limits();
  yaw   = _wrapYaw(yaw);
  pitch = _clamp(pitch, lim.pitch_min_deg, lim.pitch_max_deg);
  const ty = $('target-yaw');   if (ty) ty.value = yaw.toFixed(2);
  const tp = $('target-pitch'); if (tp) tp.value = pitch.toFixed(2);
  const mode = MODE_POSITION();
  if (!(await confirmModeChange(mode))) return;
  if (sendSet({ gimbals_mode: mode, yaw_angle_position: yaw, pitch_angle_position: pitch })) {
    log(`Position → Yaw ${yaw.toFixed(2)}°  Pitch ${pitch.toFixed(2)}°`);
  }
}

async function goToPosition() {
  if (!isConnected()) { log('Not connected.'); return; }
  await _sendPosition(_num('target-yaw'), _num('target-pitch'));
}

// ==================== Jog ====================
// Rate mode: change the commanded rate by delta °/s (no mode change).
// Any other mode: move the position target by delta ° in Position mode.

async function jogBoth(dYaw, dPitch) {
  if (!isConnected()) { log('Not connected.'); return; }
  if (commanded('gimbals_mode') === MODE_RATE()) {
    const r   = _limits().rate_deg_s;
    const yaw   = _clamp((commanded('yaw_rate')   || 0) + dYaw,   -r, r);
    const pitch = _clamp((commanded('pitch_rate') || 0) + dPitch, -r, r);
    const ry = $('rate-yaw');   if (ry) ry.value = yaw.toFixed(1);
    const rp = $('rate-pitch'); if (rp) rp.value = pitch.toFixed(1);
    if (sendSet({ yaw_rate: yaw, pitch_rate: pitch })) log(`Jog rate → Yaw ${yaw} °/s  Pitch ${pitch} °/s`);
    return;
  }
  await _sendPosition((commanded('yaw_angle_position') || 0) + dYaw,
                      (commanded('pitch_angle_position') || 0) + dPitch);
}

function jog(axis, delta) {
  return axis === 'yaw' ? jogBoth(delta, 0) : jogBoth(0, delta);
}

async function jogHome() {
  if (!isConnected()) { log('Not connected.'); return; }
  if (commanded('gimbals_mode') === MODE_RATE()) {
    stopRate();
    return;
  }
  await _sendPosition(0, 0);
}

function syncMovementInputs() {
  if (!APP.status) return;
  const set = (id, v) => { const el = $(id); if (el && v !== null && v !== undefined) el.value = Number(v).toFixed(2); };
  set('rate-yaw',     commanded('yaw_rate'));
  set('rate-pitch',   commanded('pitch_rate'));
  set('target-yaw',   commanded('yaw_angle_position'));
  set('target-pitch', commanded('pitch_angle_position'));
}

// ==================== UI update ====================

function _fmt(el, v) {
  if (v === null || v === undefined) return '---';
  if (el.dataset.enum) return enumName(el.dataset.enum, v);
  if (el.dataset.hex)  return '0x' + (v >>> 0).toString(16).toUpperCase().padStart(Number(el.dataset.hex), '0');
  const d = el.dataset.d !== undefined ? Number(el.dataset.d) : 3;
  return typeof v === 'number' ? v.toFixed(d) : String(v);
}

function _setFlag(id, state) {   // state: true = ok, false = error, null = unknown
  const el = $(id);
  if (el) el.className = `status-flag ${state === null ? 'unknown' : (state ? 'ok' : 'err')}`;
}

function _setBadge(id, text, cls) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `status-badge${cls ? ' ' + cls : ''}`;
}

function _activeMotors() {
  return MOTORS.filter(m => APP.gimbalCount === 4 || !m.coarse);
}

function _decodeSr(v) {
  return {
    power_state:     v & 0x0F,
    servo_enabled:   (v >> 4) & 1,
    current_limit:   (v >> 5) & 1,
    sto1_active:     (v >> 6) & 1,
    sto_diag_failed: (v >> 7) & 1,
  };
}

function _updateFaults(r) {
  MOTORS.forEach(m => {
    const sr = r ? _decodeSr(r[`${m.key}_sr`]) : null;
    SR_ROWS.forEach(row => {
      const el = $(`sr-${m.key}-${row.key}`);
      if (!el) return;
      if (!sr) { el.textContent = '---'; el.className = m.coarse ? 'coarse-only' : ''; return; }
      const v = sr[row.key];
      let text, bad;
      if (row.key === 'power_state')        { text = enumName('power_drive_state', v); bad = v !== 0; }
      else if (row.key === 'servo_enabled') { text = v ? 'Yes' : 'No'; bad = false; }
      else                                  { text = v ? 'Yes' : 'No'; bad = !!v; }
      el.textContent = text;
      el.className = (m.coarse ? 'coarse-only ' : '') + (bad ? 'cell-err' : '');
    });
    const mf = r ? r[`${m.key}_mf`] : null;
    for (let b = 0; b < 32; b++) _setFlag(`mf-${m.key}-${b}`, mf === null ? null : !((mf >>> b) & 1));
  });
  FAILURE_MAPS.forEach(fm => {
    const v = r ? r[fm.key] : null;
    for (let b = 0; b < 8; b++) _setFlag(`fm-${fm.key}-${b}`, v === null ? null : !((v >> b) & 1));
  });
}

function _overallFault(r) {
  const reasons = [];
  _activeMotors().forEach(m => {
    if (r[`${m.key}_mf`])                    reasons.push(`${m.label} MF`);
    if (_decodeSr(r[`${m.key}_sr`]).power_state) reasons.push(`${m.label} power`);
  });
  FAILURE_MAPS.forEach(fm => { if (r[fm.key]) reasons.push(fm.label); });
  return reasons;
}

function refreshUI() {
  const s = APP.status;
  const r = APP.report;
  const connected = isConnected();

  // Link info
  $('tx-count').textContent  = s ? s.tx_count  : 0;
  $('rx-count').textContent  = s ? s.rx_count  : 0;
  $('bad-count').textContent = s ? s.bad_count : 0;
  $('report-age').textContent = s && s.report_age_ms !== null ? `${s.report_age_ms} ms` : '---';
  if (!connected)         _setBadge('report-status', 'NO LINK', '');
  else if (s.report_ok)   _setBadge('report-status', 'REPORT OK', 'ok');
  else                    _setBadge('report-status', 'NO REPORT', 'err');

  if (Date.now() > _toggleHoldUntil) $('connection-toggle').checked = connected;
  document.querySelectorAll('.conn-only').forEach(el => { el.disabled = !connected; });
  $('emergency-stop').classList.toggle('connected', connected);

  // Motors
  const cMotor = commanded('enable_disable_motor');
  $('motor-cmd').textContent = connected ? enumName('enable_disable_motor', cMotor) : '---';
  $('motor-rpt').textContent = r ? enumName('enable_disable_motor', r.enable_disable_motor) : '---';
  $('motor-sf').textContent  = r ? r.motor_sf_debug : '---';
  if (!connected || !r)                                         _setBadge('motor-handshake', 'MOTORS: ---', '');
  else if (motorsConfirmed())                                   _setBadge('motor-handshake', 'MOTORS ENABLED', 'ok');
  else if (enumName('enable_disable_motor', cMotor).startsWith('ENABLE'))
                                                                _setBadge('motor-handshake', 'WAITING FOR ELMO', 'err');
  else                                                          _setBadge('motor-handshake', 'MOTORS DISABLED', '');

  // Gimbals mode
  const cMode = commanded('gimbals_mode');
  $('mode-cmd').textContent = connected ? enumName('gimbals_mode', cMode) : '---';
  $('mode-rpt').textContent = r ? enumName('gimbals_mode', r.gimbals_mode) : '---';
  enumList('gimbals_mode').forEach(m => {
    const b = $(`mode-btn-${m.value}`);
    if (b) b.classList.toggle('active-mode', connected && m.value === cMode);
  });

  // All live report values
  document.querySelectorAll('[data-f]').forEach(el => {
    el.textContent = _fmt(el, r ? r[el.dataset.f] : null);
  });

  // Movement panel "commanded now"
  const setT = (id, v) => { const el = $(id); if (el) el.textContent = connected && v !== null ? Number(v).toFixed(2) : '---'; };
  setT('cmd-yaw-rate',   commanded('yaw_rate'));
  setT('cmd-pitch-rate', commanded('pitch_rate'));
  setT('cmd-yaw-pos',    commanded('yaw_angle_position'));
  setT('cmd-pitch-pos',  commanded('pitch_angle_position'));

  _updateFaults(r);

  // Overall health
  if (!r) {
    _setBadge('overall-status', '—', '');
  } else {
    const reasons = _overallFault(r);
    _setBadge('overall-status', reasons.length ? `FAULT: ${reasons.join(', ')}` : 'NO FAULTS', reasons.length ? 'err' : 'ok');
  }
}

function onTick(msg) {
  const rec = msg.recording;
  if (Date.now() > _toggleHoldUntil) $('record-toggle').checked = rec.active;
  $('record-info').textContent = rec.active
    ? `${rec.path.split(/[\\/]/).pop()} — ${rec.rows} rows`
    : (rec.path ? `last: ${rec.path.split(/[\\/]/).pop()}` : '—');
  refreshUI();
}

// ==================== Toggles ====================

function _holdToggles() { _toggleHoldUntil = Date.now() + 1500; }

$('connection-toggle').onchange = function () {
  _holdToggles();
  if (!sendToServer({ type: this.checked ? 'connect' : 'disconnect' })) this.checked = false;
};

$('record-toggle').onchange = function () {
  _holdToggles();
  if (!sendToServer({ type: 'record', on: this.checked })) this.checked = false;
};

$('rawlog-toggle').onchange = function () {
  sendToServer({ type: 'rawlog', on: this.checked });
};

// ==================== Expose globals ====================

window.APP              = APP;
window.toggleTheme      = toggleTheme;
window.toggleLog        = toggleLog;
window.clearLog         = clearLog;
window.about            = about;
window.setGimbalCount   = setGimbalCount;
window.sendMotor        = sendMotor;
window.setGimbalsMode   = setGimbalsMode;
window.emergencyStop    = emergencyStop;
window.setRate          = setRate;
window.stopRate         = stopRate;
window.goToPosition     = goToPosition;
window.jog              = jog;
window.jogBoth          = jogBoth;
window.jogHome          = jogHome;
window.refreshUI        = refreshUI;
window.syncMovementInputs = syncMovementInputs;

// ==================== Initialise ====================

updateThemeIcon(localStorage.getItem('pop-theme') || 'dark');
setGimbalCount(Number(localStorage.getItem('pop-gimbals')) || 2);
link = new PopLink({
  onMessage: onServerMessage,
  onOpen:    () => setServerOnline(true),
  onClose:   () => { if (APP.serverOnline) setServerOnline(false); },
});
MovementControl();
