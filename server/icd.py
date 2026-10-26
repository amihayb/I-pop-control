"""
Elmo ICD (elmo_icd_messages.md, V19): binary command / report layouts.

All messages are little endian. Each layout is a list of (field_name, struct_code)
in wire order; the struct format is built from that list, so the order here IS
the byte order on the wire.
"""

import struct

SYNC_WORD = 100
OPCODE = 1

# ---------------------------------------------------------------- command (178 B)

COMMAND_FIELDS = [
    ("sync_word", "B"),                     # 1
    ("opcode", "B"),                        # 2
    ("counter", "B"),                       # 3
    ("length", "B"),                        # 4
    ("time_stamp", "I"),                    # 5
    ("enable_disable_motor", "B"),          # 9
    ("gimbals_mode", "B"),                  # 10
    ("tracked_channel_select", "B"),        # 11
    ("special_command", "B"),               # 12
    ("yaw_rate", "f"),                      # 13
    ("pitch_rate", "f"),                    # 17
    ("yaw_angle_position", "f"),            # 21
    ("pitch_angle_position", "f"),          # 25
    ("yaw_angle_pointing", "f"),            # 29
    ("pitch_angle_pointing", "f"),          # 33
    ("track_error_time_tag", "I"),          # 37
    ("yaw_track_error", "f"),               # 41
    ("pitch_track_error", "f"),             # 45
    ("yaw_rate_grr", "f"),                  # 49
    ("pitch_rate_grr", "f"),                # 53
    ("tracked_sensor_fov", "f"),            # 57
    ("cancel_protect_yaw", "B"),            # 61
    ("spare_uint8_62", "B"),                # 62
    ("reset_counter_1pps", "B"),            # 63
    ("cancel_protect_pi", "B"),             # 64
    ("drift_yaw", "f"),                     # 65
    ("drift_pitch", "f"),                   # 69
    ("yaw_rate_sf", "f"),                   # 73
    ("pitch_rate_sf", "f"),                 # 77
    ("cancelled_yaw_protections", "I"),     # 81
    ("cancelled_pi_protections", "I"),      # 85
    ("track_enable_recording", "B"),        # 89
    ("spare_uint8_90", "B"),                # 90
    ("ir_integration_time", "f"),           # 91
    ("vis_integration_time", "f"),          # 95
    ("yaw_los_zero_offset", "f"),           # 99
    ("pitch_los_zero_offset", "f"),         # 103
    ("bias_gyro_x", "f"),                   # 107
    ("bias_gyro_y", "f"),                   # 111
    ("bias_gyro_z", "f"),                   # 115
    ("track_amp_recording", "f"),           # 119
    ("track_min_time_recording", "f"),      # 123
    ("track_min_periods_recording", "f"),   # 127
] + [(f"spare_float_{i}", "f") for i in range(1, 13)]  # 131 .. 175

# ---------------------------------------------------------------- report (206 B)

REPORT_FIELDS = [
    ("sync_word", "B"),                     # 1
    ("opcode", "B"),                        # 2
    ("counter", "B"),                       # 3
    ("length", "B"),                        # 4
    ("time_stamp", "I"),                    # 5
    ("enable_disable_motor", "B"),          # 9
    ("gimbals_mode", "B"),                  # 10
    ("busy", "B"),                          # 11
    ("special_command", "B"),               # 12
    ("yaw_rate", "f"),                      # 13
    ("pitch_rate", "f"),                    # 17
    ("track_error_time_tag", "I"),          # 21
    ("gmcu_measure_angle_timer", "I"),      # 25
    ("camera_sync_timer", "I"),             # 29
    ("yaw_los_angle", "f"),                 # 33
    ("pitch_los_angle", "f"),               # 37
    ("yaw_fine_angle", "f"),                # 41
    ("pitch_fine_angle", "f"),              # 45
    ("yaw_coarse_angle", "f"),              # 49
    ("pitch_coarse_angle", "f"),            # 53
    ("yaw_fine_current", "f"),              # 57
    ("pitch_fine_current", "f"),            # 61
    ("yaw_coarse_current", "f"),            # 65
    ("pitch_coarse_current", "f"),          # 69
    ("yaw_stab_result", "f"),               # 73
    ("pitch_stab_result", "f"),             # 77
    ("yaw_fine_temperature", "B"),          # 81
    ("pitch_fine_temperature", "B"),        # 82
    ("yaw_coarse_temperature", "B"),        # 83
    ("pitch_coarse_temperature", "B"),      # 84
    ("yaw_fine_sr", "B"),                   # 85
    ("pitch_fine_sr", "B"),                 # 86
    ("yaw_coarse_sr", "B"),                 # 87
    ("pitch_coarse_sr", "B"),               # 88
    ("yaw_fine_mf", "I"),                   # 89
    ("pitch_fine_mf", "I"),                 # 93
    ("yaw_coarse_mf", "I"),                 # 97
    ("pitch_coarse_mf", "I"),               # 101
    ("angle_limit", "B"),                   # 105
    ("failure_elmo_1", "B"),                # 106
    ("failure_elmo_2", "B"),                # 107
    ("failure_loop_1", "B"),                # 108
    ("failure_loop_2", "B"),                # 109
    ("cancel_protect_yaw_echo", "B"),       # 110
    ("cancel_protect_pi_echo", "B"),        # 111
    ("spare_uint8_112", "B"),               # 112
    ("cancelled_yaw_protections", "I"),     # 113
    ("cancelled_pi_protections", "I"),      # 117
    ("motor_sf_debug", "B"),                # 121
    ("spare_uint8_122", "B"),               # 122
    ("roll_rate", "f"),                     # 123
    ("control_sw_number", "f"),             # 127
    ("control_sw_version", "f"),            # 131
    ("control_sw_project", "f"),            # 135
    ("spare_float_139", "f"),               # 139
    ("spare_float_143", "f"),               # 143
    ("gyro_x", "f"),                        # 147
    ("gyro_y", "f"),                        # 151
    ("gyro_z", "f"),                        # 155
    ("yaw_rate_for_rate_sf", "f"),          # 159
    ("pitch_rate_for_rate_sf", "f"),        # 163
    ("counter_1pps", "f"),                  # 167
    ("gyro_temperature", "f"),              # 171
    ("track_input_recording", "f"),         # 175
    ("track_output_recording", "f"),        # 179
    ("track_frequency_recording", "f"),     # 183
] + [(f"spare_float_{i}", "f") for i in range(1, 6)]  # 187 .. 203

_CMD_STRUCT = struct.Struct("<" + "".join(code for _, code in COMMAND_FIELDS))
_RPT_STRUCT = struct.Struct("<" + "".join(code for _, code in REPORT_FIELDS))

COMMAND_LENGTH = _CMD_STRUCT.size
REPORT_LENGTH = _RPT_STRUCT.size
assert COMMAND_LENGTH == 178, COMMAND_LENGTH
assert REPORT_LENGTH == 206, REPORT_LENGTH

COMMAND_FIELD_NAMES = [name for name, _ in COMMAND_FIELDS]
REPORT_FIELD_NAMES = [name for name, _ in REPORT_FIELDS]
_CMD_INT_FIELDS = {name for name, code in COMMAND_FIELDS if code != "f"}

# Fields the builder owns; callers never set them.
HEADER_FIELDS = ("sync_word", "opcode", "counter", "length", "time_stamp")

# ---------------------------------------------------------------- bit names

# MF fault bit map (report 89-104) and cancel-protection bit map (cmd 81/85, report 113/117).
FAULT_BITS = [
    "mainFeedbackErr", "commutationProcessErr", "hallFeedbackMismatchErr",
    "peekCurrentLimitExceededErr", "externalInhibitTriggeredErr", "lossOfPhaseErr",
    "hallSensorSpeedExceededErr", "speedTrackingErr", "positionTrackingErr", "Reserved",
    "gantryYawErrorLimitExceededErr", "commutationFailedErr", "underVoltageErr",
    "overVoltageErr", "safeTorqueOffDisabled", "shortProtection",
    "overTemperatureProtection", "overSpeedProtection", "SLTfaultReaction", "Reserved",
    "Reserved", "motorIsStuck", "feedbackIsOutOfPosLimit", "Reserved",
    "gantrySlaveDisabled", "abortInputIsActive", "driveOverTemperature", "Reserved",
    "slaveDriveFault", "failedToEnableMotor", "motorDisabledLocal", "Reserved",
]

FAILURE_ELMO_1_BITS = [
    "GYRO MSG COUNTER", "GYRO MSG CHECKSUM", "EXTERNAL SYNC GYRO MSG", "GYRO TEMPERATURE",
    "Err4", "Err5", "Err6", "Err7",
]
GENERIC_8_BITS = [f"Err{i}" for i in range(8)]


def decode_sr(value):
    """SR detailed status byte, packed as in the Arkolis tool."""
    return {
        "power_state": value & 0x0F,
        "servo_enabled": (value >> 4) & 1,
        "current_limit": (value >> 5) & 1,
        "sto1_active": (value >> 6) & 1,
        "sto_diag_failed": (value >> 7) & 1,
    }


def set_bits(value, width):
    return [i for i in range(width) if (value >> i) & 1]


# ---------------------------------------------------------------- pack / parse

def build_command(fields, counter, time_stamp=0):
    """Pack a command. `fields` holds every non-header COMMAND field by name."""
    values = []
    for name in COMMAND_FIELD_NAMES:
        if name == "sync_word":
            v = SYNC_WORD
        elif name == "opcode":
            v = OPCODE
        elif name == "counter":
            v = counter & 0xFF
        elif name == "length":
            v = COMMAND_LENGTH
        elif name == "time_stamp":
            v = time_stamp
        else:
            v = fields.get(name, 0)
            v = int(v) if name in _CMD_INT_FIELDS else float(v)
        values.append(v)
    return _CMD_STRUCT.pack(*values)


def parse_command(data):
    return dict(zip(COMMAND_FIELD_NAMES, _CMD_STRUCT.unpack(data)))


class ReportError(ValueError):
    pass


def parse_report(data):
    """Return a dict of report fields, or raise ReportError if the packet is invalid."""
    if len(data) != REPORT_LENGTH:
        raise ReportError(f"bad length {len(data)} (expected {REPORT_LENGTH})")
    if data[0] != SYNC_WORD or data[1] != OPCODE:
        raise ReportError(f"bad header sync={data[0]} opcode={data[1]}")
    return dict(zip(REPORT_FIELD_NAMES, _RPT_STRUCT.unpack(data)))


def build_report(fields, counter):
    """Pack a report. Used only by the fake Elmo simulator."""
    values = []
    for name, code in REPORT_FIELDS:
        if name == "sync_word":
            v = SYNC_WORD
        elif name == "opcode":
            v = OPCODE
        elif name == "counter":
            v = counter & 0xFF
        elif name == "length":
            v = REPORT_LENGTH
        else:
            v = fields.get(name, 0)
            v = float(v) if code == "f" else int(v)
        values.append(v)
    return _RPT_STRUCT.pack(*values)
