/**
 * Panel UI — builds and destroys side panels (Movement Control, Telemetry, Faults).
 * No server calls here; buttons call functions from app.js.
 *
 * Live values: any element with data-f="<report field>" is filled by app.js on each
 * update. Optional attributes: data-d (decimals), data-enum (enum list name),
 * data-hex (hex digits).
 */

const MOTORS = [
  { key: 'yaw_fine',     label: 'Yaw F',   coarse: false },
  { key: 'pitch_fine',   label: 'Pitch F', coarse: false },
  { key: 'yaw_coarse',   label: 'Yaw C',   coarse: true  },
  { key: 'pitch_coarse', label: 'Pitch C', coarse: true  },
];

const SR_ROWS = [
  { key: 'power_state',     label: 'Power drive state' },
  { key: 'servo_enabled',   label: 'Servo enabled'     },
  { key: 'current_limit',   label: 'Current limit on'  },
  { key: 'sto1_active',     label: 'STO1 active'       },
  { key: 'sto_diag_failed', label: 'STO diag failed'   },
];

const FAILURE_MAPS = [
  { key: 'failure_elmo_1', label: 'Failure ELMO 1', bits: 'failure_elmo_1' },
  { key: 'failure_elmo_2', label: 'Failure ELMO 2', bits: 'generic_8' },
  { key: 'failure_loop_1', label: 'Failure Loop 1', bits: 'generic_8' },
  { key: 'failure_loop_2', label: 'Failure Loop 2', bits: 'generic_8' },
];

// Left-to-right order of the panels when several are open.
const PANELS = [
  { id: 'movement-control-panel', button: 'movement-control-button', build: () => MovementControl() },
  { id: 'telemetry-panel',        button: 'telemetry-button',        build: () => TelemetryPanel()  },
  { id: 'faults-panel',           button: 'faults-button',           build: () => FaultsPanel()     },
];

const SIDENAV_WIDTH = 350;

// Toggles panel `id`: opens it next to the other open panels, or closes it if already open.
function _openPanel(id, html, width) {
  if (document.getElementById(id)) { closePanel(id); return; }

  const idx   = PANELS.findIndex(p => p.id === id);
  const panel = document.createElement('div');
  panel.id = id;
  panel.classList.add('movement-panel');
  panel.style.width = `${width || 350}px`;
  panel.style.order = idx;
  panel.innerHTML = html;
  document.getElementById('panels').appendChild(panel);
  document.getElementById(PANELS[idx].button).classList.add('active');
  _layoutMain();
  if (typeof refreshUI === 'function') refreshUI();
}

function closePanel(id) {
  const panel = document.getElementById(id);
  if (panel) panel.remove();
  const p = PANELS.find(x => x.id === id);
  if (p) document.getElementById(p.button).classList.remove('active');
  _layoutMain();
}

// Re-create the open panels (used when the server sends limits / bit names).
function rebuildPanels() {
  PANELS.forEach(p => {
    if (!document.getElementById(p.id)) return;
    closePanel(p.id);
    p.build();
  });
}

// Push the log area to the right of all open panels.
function _layoutMain() {
  const panelsWidth = Array.from(document.getElementById('panels').children)
    .reduce((sum, el) => sum + el.offsetWidth, 0);
  document.getElementById('main-content').style.marginLeft = `${SIDENAV_WIDTH + panelsWidth + 20}px`;
}

function _header(title, id) {
  return `
    <div class="panel-header">
      <h1>${title}</h1>
      <button class="panel-close-btn" onclick="closePanel('${id}')">&#x00D7;</button>
    </div>`;
}

// ==================== Movement Control panel ====================

function MovementControl() {
  const lim = (APP.cfg && APP.cfg.limits) || {
    rate_deg_s: 200, yaw_min_deg: 0, yaw_max_deg: 360, pitch_min_deg: -180, pitch_max_deg: 180,
  };
  const arrow = (dir, rot) =>
    `<i class="fa fa-arrow-${dir}"${rot ? ` style="display:inline-block;transform:rotate(${rot}deg)"` : ''}></i>`;

  _openPanel('movement-control-panel', `
    ${_header('Movement Control', 'movement-control-panel')}

    <h3 class="cal-axis-heading">Rate Mode</h3>
    <div class="target-control" title="Yaw rate, ±${lim.rate_deg_s} °/s">
      <label for="rate-yaw">Yaw Rate [°/s]</label>
      <input type="number" id="rate-yaw" value="0" step="1"
             min="${-lim.rate_deg_s}" max="${lim.rate_deg_s}" style="width:80px;" />
    </div><br>
    <div class="target-control" title="Pitch rate, ±${lim.rate_deg_s} °/s">
      <label for="rate-pitch">Pitch Rate [°/s]</label>
      <input type="number" id="rate-pitch" value="0" step="1"
             min="${-lim.rate_deg_s}" max="${lim.rate_deg_s}" style="width:80px;" />
    </div><br>
    <div style="display:flex; gap:8px;">
      <a href="#" class="button" style="flex:1; text-align:center;"
         onclick="setRate(); return false;">Set Rate</a>
      <a href="#" class="button" style="flex:1; text-align:center;"
         onclick="stopRate(); return false;">Stop</a>
    </div>

    <hr>

    <h3 class="cal-axis-heading">Position Mode</h3>
    <div class="target-control" title="Yaw ${lim.yaw_min_deg} to ${lim.yaw_max_deg}°">
      <label for="target-yaw">Yaw [°]</label>
      <input type="number" id="target-yaw" value="0" step="0.1"
             min="${lim.yaw_min_deg}" max="${lim.yaw_max_deg}" style="width:80px;" />
    </div><br>
    <div class="target-control" title="Pitch ${lim.pitch_min_deg} to ${lim.pitch_max_deg}°">
      <label for="target-pitch">Pitch [°]</label>
      <input type="number" id="target-pitch" value="0" step="0.1"
             min="${lim.pitch_min_deg}" max="${lim.pitch_max_deg}" style="width:80px;" />
    </div><br>
    <a href="#" class="button" style="display:block;"
       onclick="goToPosition(); return false;">Go to Position</a>

    <hr>

    <!-- Jog: Up/Down = Pitch, Left/Right = Yaw.
         Rate mode: changes the rate by 1 or 5 °/s. Otherwise: moves by 1° or 5° in Position mode. -->
    <h3 class="cal-axis-heading">Jog <span class="small-muted" style="text-transform:none;">(Rate mode: °/s, else °)</span></h3>
    <div style="display:grid; grid-template-columns:repeat(5,38px); grid-template-rows:repeat(5,38px); gap:4px; margin:8px auto; width:fit-content;">
      <button class="jog-btn jog-big"   onclick="jogBoth(-5, 5)" title="-5 Yaw / +5 Pitch">${arrow('up', -45)}</button>
      <span></span>
      <button class="jog-btn jog-big"   onclick="jog('pitch', 5)" title="+5 Pitch">${arrow('up')}</button>
      <span></span>
      <button class="jog-btn jog-big"   onclick="jogBoth( 5, 5)" title="+5 Yaw / +5 Pitch">${arrow('up', 45)}</button>

      <span></span>
      <button class="jog-btn jog-small" onclick="jogBoth(-1, 1)" title="-1 Yaw / +1 Pitch">${arrow('up', -45)}</button>
      <button class="jog-btn jog-small" onclick="jog('pitch', 1)" title="+1 Pitch">${arrow('up')}</button>
      <button class="jog-btn jog-small" onclick="jogBoth( 1, 1)" title="+1 Yaw / +1 Pitch">${arrow('up', 45)}</button>
      <span></span>

      <button class="jog-btn jog-big"   onclick="jog('yaw', -5)" title="-5 Yaw">${arrow('left')}</button>
      <button class="jog-btn jog-small" onclick="jog('yaw', -1)" title="-1 Yaw">${arrow('left')}</button>
      <button class="jog-btn jog-home"  onclick="jogHome()"      title="Rate mode: zero rates. Otherwise: go to 0°, 0°"><i class="fa fa-home"></i></button>
      <button class="jog-btn jog-small" onclick="jog('yaw', 1)"  title="+1 Yaw">${arrow('right')}</button>
      <button class="jog-btn jog-big"   onclick="jog('yaw', 5)"  title="+5 Yaw">${arrow('right')}</button>

      <span></span>
      <button class="jog-btn jog-small" onclick="jogBoth(-1,-1)" title="-1 Yaw / -1 Pitch">${arrow('down', 45)}</button>
      <button class="jog-btn jog-small" onclick="jog('pitch',-1)" title="-1 Pitch">${arrow('down')}</button>
      <button class="jog-btn jog-small" onclick="jogBoth( 1,-1)" title="+1 Yaw / -1 Pitch">${arrow('down', -45)}</button>
      <span></span>

      <button class="jog-btn jog-big"   onclick="jogBoth(-5,-5)" title="-5 Yaw / -5 Pitch">${arrow('down', 45)}</button>
      <span></span>
      <button class="jog-btn jog-big"   onclick="jog('pitch',-5)" title="-5 Pitch">${arrow('down')}</button>
      <span></span>
      <button class="jog-btn jog-big"   onclick="jogBoth( 5,-5)" title="+5 Yaw / -5 Pitch">${arrow('down', -45)}</button>
    </div>

    <hr>
    <h3 class="cal-axis-heading">Commanded now</h3>
    <table class="tel-table">
      <thead><tr><th></th><th>Yaw</th><th>Pitch</th></tr></thead>
      <tbody>
        <tr><td>Rate [°/s]</td><td id="cmd-yaw-rate">---</td><td id="cmd-pitch-rate">---</td></tr>
        <tr><td>Position [°]</td><td id="cmd-yaw-pos">---</td><td id="cmd-pitch-pos">---</td></tr>
      </tbody>
    </table>
  `);
  syncMovementInputs();
}

// ==================== Telemetry panel ====================

function _row(label, yawField, pitchField, dec, rowClass) {
  const cell = f => f ? `<td data-f="${f}" data-d="${dec}">---</td>` : '<td></td>';
  return `<tr${rowClass ? ` class="${rowClass}"` : ''}><td>${label}</td>${cell(yawField)}${cell(pitchField)}</tr>`;
}

function _one(label, field, extra) {
  return `<tr><td>${label}</td><td colspan="2" data-f="${field}" ${extra || 'data-d="0"'}>---</td></tr>`;
}

function TelemetryPanel() {
  _openPanel('telemetry-panel', `
    ${_header('Telemetry', 'telemetry-panel')}

    <h3 class="cal-axis-heading">Angles [°]</h3>
    <table class="tel-table">
      <thead><tr><th>Parameter</th><th>Yaw</th><th>Pitch</th></tr></thead>
      <tbody>
        ${_row('LOS',    'yaw_los_angle',    'pitch_los_angle',    3)}
        ${_row('Fine',   'yaw_fine_angle',   'pitch_fine_angle',   3)}
        ${_row('Coarse', 'yaw_coarse_angle', 'pitch_coarse_angle', 3, 'coarse-only')}
      </tbody>
    </table>

    <h3 class="cal-axis-heading" style="margin-top:12px;">Rates [°/s]</h3>
    <table class="tel-table">
      <thead><tr><th>Parameter</th><th>Yaw</th><th>Pitch</th></tr></thead>
      <tbody>
        ${_row('Rate',            'yaw_rate',             'pitch_rate',             3)}
        ${_row('Rate for SF',     'yaw_rate_for_rate_sf', 'pitch_rate_for_rate_sf', 3)}
        ${_row('Stab result [µrad]', 'yaw_stab_result',   'pitch_stab_result',      2)}
      </tbody>
    </table>
    <table class="tel-table">
      <tbody>${_one('Roll rate [°/s]', 'roll_rate', 'data-d="3"')}</tbody>
    </table>

    <h3 class="cal-axis-heading" style="margin-top:12px;">Currents [A] / Temperatures</h3>
    <table class="tel-table">
      <thead><tr><th>Parameter</th><th>Yaw</th><th>Pitch</th></tr></thead>
      <tbody>
        ${_row('Current fine',   'yaw_fine_current',       'pitch_fine_current',       3)}
        ${_row('Current coarse', 'yaw_coarse_current',     'pitch_coarse_current',     3, 'coarse-only')}
        ${_row('Temp fine',      'yaw_fine_temperature',   'pitch_fine_temperature',   0)}
        ${_row('Temp coarse',    'yaw_coarse_temperature', 'pitch_coarse_temperature', 0, 'coarse-only')}
      </tbody>
    </table>

    <h3 class="cal-axis-heading" style="margin-top:12px;">Gyro</h3>
    <table class="tel-table">
      <tbody>
        ${_one('Gyro X', 'gyro_x', 'data-d="4"')}
        ${_one('Gyro Y', 'gyro_y', 'data-d="4"')}
        ${_one('Gyro Z', 'gyro_z', 'data-d="4"')}
        ${_one('Gyro temperature', 'gyro_temperature', 'data-d="2"')}
      </tbody>
    </table>

    <h3 class="cal-axis-heading" style="margin-top:12px;">System</h3>
    <table class="tel-table">
      <tbody>
        ${_one('Enable/Disable echo', 'enable_disable_motor', 'data-enum="enable_disable_motor"')}
        ${_one('Gimbals mode echo',   'gimbals_mode',         'data-enum="gimbals_mode"')}
        ${_one('Special command',     'special_command',      'data-enum="special_command"')}
        ${_one('Busy',                'busy',                 'data-enum="busy"')}
        ${_one('Angle limit',         'angle_limit',          'data-enum="angle_limit"')}
        ${_one('MotorSF_DEBUG',       'motor_sf_debug')}
        ${_one('Report counter',      'counter')}
        ${_one('Report time stamp',   'time_stamp')}
        ${_one('Track error time tag','track_error_time_tag')}
        ${_one('Angle timer [µs]',    'gmcu_measure_angle_timer')}
        ${_one('Camera sync timer [µs]', 'camera_sync_timer')}
        ${_one('1PPS counter',        'counter_1pps')}
      </tbody>
    </table>

    <h3 class="cal-axis-heading" style="margin-top:12px;">Control SW</h3>
    <table class="tel-table">
      <tbody>
        ${_one('SW number',  'control_sw_number',  'data-d="0"')}
        ${_one('SW version', 'control_sw_version', 'data-d="0"')}
        ${_one('Project',    'control_sw_project', 'data-d="0"')}
      </tbody>
    </table>

    <h3 class="cal-axis-heading" style="margin-top:12px;">Track recording</h3>
    <table class="tel-table">
      <tbody>
        ${_one('Input',     'track_input_recording',     'data-d="4"')}
        ${_one('Output',    'track_output_recording',    'data-d="4"')}
        ${_one('Frequency', 'track_frequency_recording', 'data-d="3"')}
      </tbody>
    </table>
  `, 380);
}

// ==================== Faults panel ====================

function _dot(id) {
  return `<span id="${id}" class="status-flag unknown"><span class="status-dot"></span></span>`;
}

function _motorHeader() {
  return `<thead><tr><th>Bit</th>${MOTORS.map(m =>
    `<th class="${m.coarse ? 'coarse-only' : ''}">${m.label}</th>`).join('')}</tr></thead>`;
}

function FaultsPanel() {
  const bits = (APP.bits && APP.bits.fault) || [];

  const srRows = SR_ROWS.map(r => `<tr><td>${r.label}</td>${MOTORS.map(m =>
    `<td class="${m.coarse ? 'coarse-only' : ''}" id="sr-${m.key}-${r.key}">---</td>`).join('')}</tr>`).join('');

  const mfRows = bits.map((name, b) => `<tr><td>${b} ${name}</td>${MOTORS.map(m =>
    `<td class="${m.coarse ? 'coarse-only' : ''}">${_dot(`mf-${m.key}-${b}`)}</td>`).join('')}</tr>`).join('');

  const mfHex = `<tr><td>Raw (hex)</td>${MOTORS.map(m =>
    `<td class="${m.coarse ? 'coarse-only' : ''}" data-f="${m.key}_mf" data-hex="8">---</td>`).join('')}</tr>`;

  const failure = FAILURE_MAPS.map(fm => {
    const names = (APP.bits && APP.bits[fm.bits]) || [];
    return `
      <h3 class="cal-axis-heading" style="margin-top:12px;">${fm.label}
        <span class="small-muted" data-f="${fm.key}" data-hex="2"></span></h3>
      <div class="bit-list">${names.map((n, b) =>
        `<span class="bit-item">${_dot(`fm-${fm.key}-${b}`)} ${b} ${n}</span>`).join('')}</div>`;
  }).join('');

  _openPanel('faults-panel', `
    ${_header('Faults', 'faults-panel')}

    <h3 class="cal-axis-heading">Detailed status (SR)</h3>
    <table class="tel-table">
      ${_motorHeader().replace('<th>Bit</th>', '<th></th>')}
      <tbody>${srRows}</tbody>
    </table>

    <h3 class="cal-axis-heading" style="margin-top:12px;">Fault bit maps (MF, latched)</h3>
    <table class="tel-table fault-table">
      ${_motorHeader()}
      <tbody>${mfHex}${mfRows}</tbody>
    </table>

    ${failure}

    <h3 class="cal-axis-heading" style="margin-top:12px;">Cancelled protections (echo)</h3>
    <table class="tel-table">
      <tbody>
        ${_one('Cancel opcode YAW', 'cancel_protect_yaw_echo', 'data-hex="2"')}
        ${_one('Cancel opcode PI',  'cancel_protect_pi_echo',  'data-hex="2"')}
        ${_one('Cancelled YAW',     'cancelled_yaw_protections', 'data-hex="8"')}
        ${_one('Cancelled PI',      'cancelled_pi_protections',  'data-hex="8"')}
      </tbody>
    </table>
  `, 540);
}

window.MovementControl = MovementControl;
window.TelemetryPanel  = TelemetryPanel;
window.FaultsPanel     = FaultsPanel;
window.closePanel      = closePanel;
window.rebuildPanels   = rebuildPanels;
