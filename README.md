# AccuSim DRSM Telemetry Router

Windows telemetry bridge for the **A2A Simulations Accu-Sim Comanche**, Microsoft
Flight Simulator, and **DR Sim Manager (DRSM)**.

> [!IMPORTANT]
> This is a community-built interim solution. Its purpose is to make the
> Accu-Sim flight-model telemetry usable in DRSM until DRSM provides a native
> integration for these aircraft-specific values.

![AccuSim DRSM Telemetry Router offering an update in Basic mode](docs/images/telemetry-router-basic.png)

## Why this tool exists

The A2A Comanche uses a custom Accu-Sim flight model. Its most useful body-frame
acceleration values are exposed through aircraft-specific LVars rather than only
through the regular MSFS telemetry path:

```text
L:FM_BodyAccelerationX
L:FM_BodyAccelerationY
L:FM_BodyAccelerationZ
L:FM_BodyRotationAccelerationX
L:FM_BodyRotationAccelerationY
L:FM_BodyRotationAccelerationZ
```

Motion software needs acceleration, angular velocity, orientation, airspeed,
altitude, and engine data to create useful cues. The router reads both standard
SimVars and Accu-Sim LVars through SimConnect, converts their units, and sends a
compatible [DRSM DCS telemetry protocol v2](https://github.com/DepartedReality/dcs-telemetry)
packet over UDP.

It does not modify MSFS or DRSM, and it does not impersonate the DCS process.
DRSM simply receives the same open UDP/JSON format it supports for DCS World.

```text
MSFS + A2A LVars
        │ SimConnect
        ▼
Telemetry Router ── mapping / unit conversion ──► DCS v2 JSON over UDP
                                                        │
                                                        ▼
                                                       DRSM
```

## Features

- Basic mode with 14 relevant Comanche motion and engine channels
- Per-channel choice between a suitable standard SimVar and known Accu-Sim LVar
- Exact LVar names displayed directly in the source selector
- Live raw input and converted DCS output values
- Per-channel enable/disable and explicit inversion controls
- Automatic conversion between compatible physical units
- Safe Expert mode filters sources, units, and operations by output semantics
- Scale, offset, axis inversion, integration, and differentiation in Expert mode
- Full documented numeric DCS v2 output catalog in Expert mode
- Explicit red Raw mode for deliberately unrestricted experimental mappings
- User-defined LVars with add/remove controls
- SimConnect subscribes only to sources selected by enabled output channels
- Automatically reconnecting SimConnect client
- Renderer updates freeze while the window is hidden or minimized; telemetry continues
- Installed app checks for updates at startup and offers install or per-version skip
- Download progress and an explicit restart action that stops the bridge safely
- Small web bootstrapper with automatic update support
- Configurable UDP host, port, packet name, and sampling period
- Atomic persistent JSON configuration
- DCS-compatible attitude-dependent 1 G gravity reference
- Optional turbulence mixer with four presets, band-pass, blend, gain, and soft G limit
- Persistent German/English interface, including tray, updater, status and validation messages
- Contextual tooltips explain every turbulence input, mapping control and DCS output field
- Bilingual output help describes axes, units and the intended DRSM use of fields such as `acc.1`
- Fixed three-element DCS vectors to prevent malformed Primary cue packets
- CSV recording of raw sources, routed outputs, gravity, and turbulence diagnostics

## Core Comanche mapping

| DRSM output | Default Accu-Sim/MSFS source | Conversion |
| --- | --- | --- |
| `acc[0]` lateral | `L:FM_BodyAccelerationX` | m/s² → G |
| `acc[1]` longitudinal | `L:FM_BodyAccelerationZ` | m/s² → G |
| `acc[2]` vertical | `L:FM_BodyAccelerationY` | m/s² → G |
| `ang_vel[0]` pitch | `ROTATION VELOCITY BODY X` | rad/s |
| `ang_vel[1]` roll | `ROTATION VELOCITY BODY Z` | rad/s |
| `ang_vel[2]` yaw | `ROTATION VELOCITY BODY Y` | rad/s |
| `pitch`, `roll`, `yaw` | standard MSFS orientation SimVars | degrees → radians |
| `ias` | `AIRSPEED INDICATED` | knots → m/s |
| `alt_agl` | `PLANE ALT ABOVE GROUND` | feet → metres |
| `rpm_left`, `prop_rpm` | `L:Eng1_RPM` | RPM |

The A2A body-acceleration LVars are centred around zero and do not include the
DCS gravity reference. By default, the router adds a full attitude-dependent
gravity vector. In level flight this is `[0, 0, -1] G`; pitch and roll rotate it
across all three body axes so DRSM can apply its normal DCS gravity compensation.
Disable this processor only when using an input that already contains the 1 G
reference.

The optional turbulence mixer leaves the original acceleration intact. It
isolates a configurable fast band (default `0.7–5 Hz`) and blends only that
component into vertical acceleration, with an adjustable soft limit. It is off
by default for safe initial testing.

Four presets provide repeatable starting points. Selecting one enables the
mixer and copies its values into the normal controls; every value can still be
edited afterwards.

| Preset | Mix | Gain | Band | Extra soft limit | Intended use |
| --- | ---: | ---: | ---: | ---: | --- |
| Light | 25% | 1.6× | 0.9–4 Hz | 0.08 G | Subtle air movement |
| Medium | 50% | 2.5× | 0.7–5 Hz | 0.20 G | Balanced default |
| Strong | 75% | 3.5× | 0.5–7 Hz | 0.30 G | Clearly noticeable turbulence |
| Extreme | 100% | 5.0× | 0.3–10 Hz | 0.50 G | Short diagnostic tests only |

The `?` controls explain how mix, gain, cutoff frequencies, source choice, and
the soft limit affect the output. Extreme settings can cause DRSM axis
overallocation and should be approached gradually.

The A2A rotation-acceleration LVars can be selected for comparison. Since DRSM
expects angular velocity in `rad/s`, a `rad/s²` source is integrated only when
the user explicitly selects that operation. The integration resets after a
telemetry gap or configuration change to limit runaway drift.

## Quick start

1. Download the latest
   [Windows setup bootstrapper](https://github.com/iNherjer/AccuSim-DRSM-Telemetry-Router/releases/latest/download/AccuSim-DRSM-Telemetry-Router-Setup.exe).
2. Start Microsoft Flight Simulator and load the A2A Comanche.
3. In DRSM, select **DCS World** as the telemetry source and use UDP port `4135`.
4. Start the installed **AccuSim DRSM Telemetry Router**.
5. Click **Bridge starten**.

For a diagnostic log, click **CSV aufnehmen** after the bridge is running and
**CSV stoppen** when the manoeuvre is complete.

Do not run another DCS-format telemetry sender to the same DRSM endpoint at the
same time, or DRSM may receive conflicting packets.

## Basic and Expert modes

Basic mode intentionally stays small. It shows linear acceleration, angular
velocity, pitch/roll/yaw, IAS, AGL, stall warning, and engine/propeller RPM.
Only appropriate standard and A2A sources are offered for each output.

Expert mode exposes every documented numeric DCS v2 field, compatible built-in
and custom sources, input units, mathematical operations, scale, and offset.
The source list is also filtered semantically: an acceleration output offers
acceleration sources, while an RPM output offers engine/propeller RPM sources.
Optional fields such as individual gear positions, control surfaces, weapons,
and damage remain available there without cluttering the normal Comanche
workflow.

Input units and operations are constrained to combinations that can actually
produce the selected output. For example, velocity may be differentiated into
acceleration, but `mph` cannot be relabelled as G or RPM. Existing or deliberate
experimental mappings can still be edited in the clearly marked red **Raw**
mode. Runtime validation remains active, so incompatible channels are not sent.

## Configuration

The app saves its configuration to:

```text
Documents\VFR Multitool\AccuSim DRSM Router\bridge-config.json
```

CSV recordings are stored in:

```text
Documents\VFR Multitool\AccuSim DRSM Router\logs
```

Closing the window hides the app in the Windows tray. Use the tray menu to stop
the bridge or quit the application completely. While hidden or minimized, the
Chromium renderer receives no live telemetry snapshots. SimConnect processing
and UDP output continue normally, and the UI receives one current snapshot when
it is shown again.

The default profile maps 14 output channels to 13 unique SimConnect sources.
Shared inputs such as `L:Eng1_RPM` are subscribed only once. Changing scale or
offset does not reconnect SimConnect; changing an enabled channel's source or
sampling period rebuilds the compact subscription automatically.

## Updates and installation

The installed Windows app checks the latest public GitHub release at startup.
When a newer version is available, it offers **Install update** or **Skip this
version**. A skipped version stays suppressed on automatic startup checks; a
manual check from the app header or tray can offer it again. Telemetry continues
while the update downloads. The bridge is stopped only after the user confirms
the restart, and a downloaded update is also installed on the next real app
exit.

Every release used by the updater must publish these files from the same build:

- `AccuSim-DRSM-Telemetry-Router-Setup.exe`
- `accusim-drsm-telemetry-router-<version>-x64.nsis.7z`
- `latest.yml`

Draft releases are not part of the update channel.

When migrating from an older portable build, the bootstrapper also detects
router processes outside the installation directory. It warns before stopping
the active bridge, closes both installed and portable process names, and avoids
the old tray instance reclaiming Electron's single-instance lock after setup.

## Development

Requirements:

- Node.js 22 or newer
- Windows for live SimConnect testing
- MSFS SimConnect runtime

```bash
npm ci
npm test
npm start
```

Build the x64 Windows bootstrapper and updater payload:

```bash
npm run build:win
```

The bootstrapper, payload, and `latest.yml` metadata are written below
`dist/nsis-web/`.

## Current status and limitations

- The current mapping is validated against recorded A2A Comanche telemetry, but
  real motion-platform tuning remains profile- and hardware-dependent.
- Standard MSFS angular velocities are the safe default. Integrated rotational
  acceleration is experimental and may drift.
- The app currently targets Windows x64 and local SimConnect.
- This bridge is intentionally temporary infrastructure, not a replacement for
  a future native DRSM source implementation.

Please use this repository's issue tracker for router problems. Do not ask A2A
Simulations or Departed Reality to support this unofficial community tool.

## Disclaimer

This project is not affiliated with, endorsed by, or supported by A2A
Simulations, Departed Reality, Microsoft, or Eagle Dynamics. Product and company
names belong to their respective owners.

## License

[MIT](LICENSE)
