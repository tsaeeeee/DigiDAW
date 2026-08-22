# DigiDAW Documentation

**DigiDAW** is a browser-based Digital Audio Workstation designed for fast, lightweight, accessible, free, and legal mixing and mastering workflows without relying on pirated software.

DigiDAW was initiated by **Crescentials Record** with one simple goal: to make more serious audio workflows accessible to beginner producers, independent musicians, engineers who are still learning, and professional users who need a fast DAW that can run directly in a browser.

## 1. Why DigiDAW Was Created

Not every producer or musician has access to a commercial DAW. Some are just beginning to learn, some work on shared computers, some only need a lightweight workstation for quick mixing tasks, and others simply do not want to rely on cracked or pirated software.

DigiDAW was created as a healthier alternative for those situations.

Its core principles are:

- **Free to use.** Core mixing and mastering workflows are not locked behind a subscription.
- **A legal alternative to pirated DAWs.** Users should not need to search for cracks, illegal serial numbers, or untrusted installers just to learn mixing.
- **Browser-first.** DigiDAW runs directly in the browser and uses the Web Audio API together with client-side DSP.
- **Lightweight by architecture.** Core audio processing runs on the user's own device instead of sending the entire session to a server for processing.
- **Built around real workflows.** The timeline, tracks, clips, mixer, insert FX, master bus, metering, undo/redo, and rendering are designed as one integrated workflow.
- **No account required at this stage.** Users can open the launcher and start working immediately.

DigiDAW is not intended to replace every desktop DAW in every possible scenario. It is being developed as a practical, accessible, and capable browser-based workstation for real mixing and mastering work.


## 2. Current Session Architecture

In the current version of DigiDAW, sessions operate entirely **client-side**.

This means that when multiple users open DigiDAW at the same time, each user runs their own Web Audio instance, track state, AudioBuffers, transport, and plugin state inside their own browser.

In simple terms:

```text
DigiDAW Web Server
        |
        +-- User A Browser
        |      +-- Track A
        |      +-- AudioBuffer A
        |      +-- Mixer A
        |      +-- FX A
        |
        +-- Another User's Browser
               +-- Track B
               +-- AudioBuffer B
               +-- Mixer B
               +-- FX B
```

User B does not automatically see User A's timeline, stems, plugins, or changes.

At this stage, DigiDAW does not yet include:

- Login or user accounts.
- Cloud project storage.
- Server-side project saving.
- Shared project rooms.
- Real-time collaboration.
- Cross-device session synchronization.

As a result, projects are not yet persistent. If the tab is closed or the browser is refreshed, project state that exists only in browser memory may be lost.

This is an intentional limitation during the early development phase so the primary focus can remain on mixing workflow quality, editing, DSP, and browser performance.



## 3. Getting Started with DigiDAW

### 3.1 Opening the launcher

When DigiDAW is opened, the initial page displays the launcher. The landing-page sidebar provides two options:

- **Launch** — opens the main DigiDAW launcher.
- **Documentation** — opens the documentation you are reading now.

Press **Launch** to initialize the audio engine and enter the workspace.

### 3.2 Importing audio

There are two primary import workflows.

**Per-track upload**

Use the upload button in a track header to choose a single audio file and load it into that track.

**Bulk stem drag and drop**

Multiple audio files can be selected at once from Finder or File Explorer and dragged directly into DigiDAW.

Bulk import is designed specifically for stem-based workflows:

- One audio file is mapped to one track.
- Existing empty tracks are used first.
- If more tracks are required, DigiDAW can create additional tracks up to the available limit.
- Imported files are aligned to the same import time so stems remain synchronized.
- Non-audio files are ignored.
- DigiDAW currently supports a maximum of **25 tracks**.

### 3.3 Setting the BPM

The BPM control is available in the transport bar. BPM is used by the timeline beat grid, bar/beat display, metronome, and tempo-synchronized delay modes.

### 3.4 Starting the edit

Once audio is on the timeline, clips can be moved, cut, faded, selected, deleted, and positioned with snapping.

### 3.5 Mixing

Open the mixer, set the level and pan for each track, then use the FX rack on individual tracks or the master channel as required.

### 3.6 Mastering and rendering

Once the balance is complete, use the master FX chain, add a limiter when needed, monitor the meters, and use the render function to produce the final audio file.

## 4. DigiDAW Workspace

The main workspace is divided into several core areas: transport, timeline, track lanes, mixer, FX rack, master channel, metering, and render controls.

### 4.1 Transport

The transport bar provides the primary playback controls.

Main functions include:

- Play / Pause.
- Stop.
- Metronome.
- BPM.
- Timestamp.
- Bar/beat position.
- Mini real-time spectrum / peak display.
- System performance display.
- Zoom control.
- Tool selector.
- Normalize gain.
- Mixer toggle.
- Add track.
- Render audio.

### 4.2 Timeline

The timeline is the primary area for arranging audio clips.

It includes:

- Horizontal time ruler.
- BPM-based beat/bar grid.
- Playhead.
- Track lanes.
- Dynamic timeline length.
- Snap points from other clips, the playhead, timeline zero, and the beat grid.

The timeline automatically expands according to the longest clip and the current playhead position.

### 4.3 Snapping

Snapping helps clips land on relevant positions while they are being moved.

Snap points include:

- Timeline start.
- Playhead.
- Start of another clip.
- End of another clip.
- BPM-based beat grid.

Hold **Shift** while dragging to temporarily bypass snapping without permanently disabling the snap preference.

### 4.4 Cut tool

The tool selector near the zoom control provides two modes:

- **Cursor** — selection, dragging, and fade editing.
- **Cut** — splits a clip at the mouse-click position.

When Cut mode is active, clicking a clip splits it exactly where the mouse is clicked rather than at the playhead.

The split is performed on the AudioBuffer and produces two new clips.

The original fades are preserved logically:

- The left clip keeps the original fade-in.
- The right clip keeps the original fade-out.
- The split point itself does not automatically create a new fade.

### 4.5 Fade in and fade out

In Cursor mode, the edges of a clip provide fade controls.

The fade UI uses straight visual ramps for clear readability.

Audio fades are processed non-destructively relative to the source buffer. DigiDAW creates a processed playback buffer for playback and rendering while preserving the raw clip buffer as the primary source.

### 4.6 Clip deletion

A selected clip can be deleted with **Delete** or **Backspace**.

### 4.7 Multi-select

DigiDAW supports multi-selection of clips.

- A normal click selects one clip.
- **Ctrl + Click** on Windows/Linux adds or removes a clip from the current selection.
- **Cmd + Click** on macOS performs the same function.
- Clips can be selected across different tracks.
- Delete/Backspace can remove clips that are part of the current multi-selection.
- Escape exits the multi-selection.

At this stage, multi-select is focused on selection and bulk deletion. Moving a selected group as one unit is not currently part of the promised behavior.

### 4.8 Undo and redo

DigiDAW includes project history for many core operations.

History currently covers operations such as:

- Add track.
- Delete track.
- Upload audio.
- Move clip.
- Split clip.
- Fade changes.
- Delete clip.
- Volume/pan/mute/solo changes.
- Track color changes.
- FX changes.
- Master parameter changes.
- BPM changes.
- Normalize gain.

History is limited to keep memory usage under control.

## 5. Tracks and Mixer

### 5.1 Tracks

Each track includes:

- Track name.
- Track color.
- One or more audio clips.
- Volume.
- Pan.
- Mute.
- Solo.
- Insert effect chain.
- Metering.

Track names can be changed from the track header.

### 5.2 Mixer channel

The mixer uses a vertical channel strip for each track.

Main channel controls include:

- Stereo level meter.
- Volume fader.
- Pan.
- Mute.
- Solo.
- FX rack.
- Track label.

The mixer follows a flat, matte visual design using DigiDAW's primary brand color, **#ffd900**.

### 5.3 Master channel

All tracks ultimately feed the master channel.

The master channel includes volume, pan, an FX rack, and its own output/render path.

It is intended for final processing such as master EQ, bus compression, saturation, limiting, or any combination required by the project.

---

## 6. Signal Flow

DigiDAW's signal flow is designed to remain serial and predictable.

```text
Audio clip / player
        |
        v
Track insert FX 1
        |
Track insert FX 2
        |
      ...
        |
Track insert FX 7
        |
        v
Pre-fader analysis / metering
        |
        v
Track pan
        |
        v
Track fader
        |
        v
Track output
        |
        +--------------------+
                             |
                             v
                      Master insert FX
                             |
                             v
                    Master pre-fader
                             |
                             v
                       Master pan
                             |
                             v
                      Master fader
                             |
                             v
                  Destination / Render
```

Insert effects are processed serially. An effect placed in an earlier slot is processed before an effect placed in a later slot.

For example:

```text
Diequ -> Dikompres -> Disaturasi
```

will produce a different result from:

```text
Disaturasi -> Dikompres -> Diequ
```

because each plugin receives the output produced by the plugin before it.

---

## 7. FX Rack

Each FX rack provides up to **7 insert slots**.

The built-in plugins currently available are:

- Dikompres (Compressor)
- Diequ (Parametric EQ)
- Ditune (Pitch Correction)
- Diecho (Reverb)
- Dipantul (Delay)
- Dilimit (Limiter)
- Disaturasi (Saturator)
- Disser (De-esser)

Effects can be used on both individual tracks and the master channel.

Each slot can be:

- Loaded with a plugin.
- Bypassed.
- Reopened for editing.
- Removed from the chain.

Plugin windows can be moved, and multiple plugin windows can remain open. Their z-order follows whichever window was focused most recently.

## 8. Dikompres — Compressor

**Dikompres** is a compressor designed to control dynamic range.

Main parameters:

- **Attack** — determines how quickly the compressor reacts after the signal exceeds the threshold.
- **Release** — determines how quickly gain reduction recovers after the signal falls back down.
- **Ratio** — determines how strongly signal above the threshold is compressed.
- **Threshold** — sets the level at which compression begins.
- **Output** — applies makeup/output gain after compression.

Dikompres includes input and gain-reduction visualization so dynamic changes can be monitored during playback.

Presets:

- Default.
- Punchy Drums.
- Smooth Vocal.
- Bass Control.
- Hard Slam.
- Master Bus.


## 9. Diequ — Five-band Equalizer

**Diequ** is a five-band equalizer.

Each band can use one of the following filter shapes:

- Bell / Peaking.
- High Pass.
- Low Pass.
- Low Shelf.
- High Shelf.

Band parameters:

- Frequency.
- Gain.
- Q.
- Filter type.
- Per-band bypass.

Default five-band layout:

- Band 1: High Pass around 40 Hz.
- Band 2: Bell around 250 Hz.
- Band 3: Bell around 1 kHz.
- Band 4: Bell around 4 kHz.
- Band 5: Low Pass around 15 kHz.

Diequ provides a visual frequency response and band controls for shaping tonal balance.

Presets:

- Flat Default.
- Vocal Clarity.
- Bass & Sub Control.
- Smile Curve.

## 10. Ditune — Vocal Pitch Correction

**Ditune** is a chromatic pitch-correction processor developed for vocals.

Ditune is currently considered **beta / experimental**. It functions as a pitch-correction processor, but the character and quality of its resynthesis remain areas of active development. It is not intended to be presented as equivalent to industry-standard commercial pitch-correction products.

Main parameters:

- **Reference Hz** — tuning reference, 440 Hz by default.
- **Speed** — controls how quickly correction moves toward the target pitch.
- **Humanize** — preserves vocal variation so correction does not become unnecessarily rigid.
- **Transition** — controls correction transitions between target pitches.
- **Color** — adjusts the character of the output/resynthesis.
- **HQ Mode** — enables an additional processing mode used by selected presets.

Ditune telemetry can display:

- Detected note.
- Cents deviation.
- Detected frequency.
- Target frequency.
- Tracking confidence.

Presets:
- Default Auto-Tune.
- Hard Tune Snap.
- Modern Lead.
- Natural Vocal Polish.
- Smooth R&B.
- Bright Lead.

Use Ditune with realistic expectations: the more aggressive the Speed setting and the lower the Humanize value, the more obvious the hard-tune character will become.

## 11. Diecho — Reverb

**Diecho** is a reverb processor for creating space, depth, ambience, plate-like environments, chambers, and halls.

Main parameters:

- **H-Cut** — limits high-frequency content in the reverb path.
- **L-Cut** — removes low-frequency content from the reverb.
- **Predelay** — sets the delay before reverb begins after the dry signal.
- **Size** — controls the perceived size of the space.
- **Mod** — controls modulation amount.
- **Diff** — controls diffusion/density of the reflection character.
- **Speed** — controls modulation speed.
- **Bass** — shapes low-frequency decay behavior.
- **Decay** — sets the length of the reverb tail.
- **Cross** — sets the crossover used to shape decay behavior.
- **Damp** — controls high-frequency damping.
- **Dry** — sets the dry-signal level.
- **ER** — sets the early-reflection level.
- **Wet** — sets the reverb level.
- **Sep** — controls stereo separation/width behavior.
- **Mode** — selects the processing mode used by the reverb engine.

Diecho also provides input, reverb, and output telemetry from the active DSP.

Presets:
- Studio Plate.
- Warm Chamber.
- Wide Hall.
- Dark Vocal Space.
- Endless Side Space.


## 12. Dipantul — Stereo Delay

**Dipantul** is a stereo delay with both free-time and tempo-synchronized modes.

Main parameters:

- **Time** — sets delay time when synchronization is disabled.
- **Sync Mode** — switches between free time and tempo-synchronized delay.
- **Sync Division** — 1/32, 1/16, 1/8, 1/4, 1/2, and 1/1.
- **Feedback** — controls how much delayed signal is fed back into the delay line.
- **Wet Mix** — sets the delay-effect level.
- **Output Gain** — sets plugin output level.
- **Mod** — adds modulation/wobble to the delay.
- **Tone** — shapes the repeat character from dark to bright.
- **Low Cut** — removes low-frequency content from repeats.
- **L/R Offset** — creates timing or character differences between the left and right sides.
- **Drive** — adds drive character to the repeats.
- **Ping Pong** — alternates repeats between the left and right channels.

Presets:

- Slapback 120ms.
- Vocal Echo 240ms.
- Ping-Pong Quarter.
- Warm Tape Echo.
- Ambient Space 500ms.

Sync mode follows the project BPM, so tempo changes also affect synchronized delay timing.

## 13. Dilimit — Brickwall Limiter

**Dilimit** is a limiter designed for peak-ceiling protection and final level control.

Main parameters:

- **Ceiling** — sets the target maximum output level.
- **Drive** — pushes the signal into the limiter.
- **Release** — sets recovery time after gain reduction.
- **Diode Saturation** — adds saturation character to the limiting process.
- **True Peak mode** — enables an optional peak-protection mode in the plugin.

The limiter visualization displays input, output, gain reduction, the ceiling line, and limiting status.

Presets:

- Mastering -0.1dB.
- Analog Slam.
- Streaming -0.5dB.
- Transparent Wall.
- Heavy Brickwall.
- Diode Limiter.

Dilimit is typically placed near the end of the master chain when used as final peak protection.

## 14. Disaturasi — Harmonic Saturation

**Disaturasi** adds harmonic coloration and nonlinear character.

Main parameters:

- **Input Gain** — sets the level entering the saturation stage.
- **Saturation Drive** — controls the amount of nonlinear saturation.
- **Mode** — Clean, Normal, Hot, or Redline.
- **Output Gain** — sets the level after saturation.

More aggressive modes produce a harder saturation curve.

The plugin displays a transfer curve so the input-output relationship can be monitored visually.

Presets:

- Default.
- Subtle Console.
- Warm Tape.
- Hot Tube.
- Redline Crush.
- Clean Boost.

Saturation can be placed before or after compression depending on the desired character.

## 15. Disser — Dynamic Sibilance Control

**Disser** is a de-esser designed to control sibilance without creating a permanent parallel audio path in normal operation.

The S-band is used as a detector/sidechain to determine when sibilance becomes too prominent. The main audio remains on a single primary processing path.

Main parameters:

- **Low Frequency** — sets the lower boundary of the detection band.
- **High Frequency** — sets the upper boundary of the detection band.
- **Threshold** — sets the trigger level.
- **Detection** — controls detection sensitivity.
- **Amount** — sets the maximum permitted reduction.
- **Attack** — determines how quickly reduction engages.
- **Release** — determines how quickly reduction recovers.
- **Mode** — selects processing behavior.
- **Listen** — monitors the detector band when required.

UI telemetry displays:

- Sibilance-band activity.
- Detector level.
- Raw sibilance level.
- Relative prominence.
- Trigger excess.
- Gain reduction.
- Processing backend state.

The backend can use the AudioWorklet path or a safe native serial fallback.

On its primary worklet path, Disser is implemented as a **single-path dynamic shelf**, with its detector dynamically controlling the amount of reduction.

## 16. Normalize Gain

DigiDAW includes a peak-normalization function.

The current control uses a default target of **-1.0 dB peak**.

Normalization follows the current selection:

- If a clip is selected, only that clip is normalized.
- If a track is selected, clips on that track become the target.
- If nothing is selected, all available clips can become the target.

Normalization processes the AudioBuffer and updates the playback buffer on affected tracks.

Normalization is not a replacement for mix balance or limiting. It simply adjusts source peak level toward a defined target.

## 17. Metering and Monitoring

DigiDAW provides several visual monitoring tools.

### Track meter

Each mixer channel provides a stereo level meter to help monitor left and right channel levels.

### Mini master display

The transport bar includes a mini display with spectrum and peak modes.

The RTA uses logarithmic frequency grouping and no longer applies pink-noise tilt compensation as a display reference.

### System performance

DigiDAW includes a System Performance Display to help users monitor runtime conditions as track and DSP counts increase.

Because audio processing runs in the user's browser, performance depends heavily on:

- Device CPU.
- Number of tracks.
- Number of active plugins.
- Plugin complexity.
- Audio buffers and browser runtime behavior.

If dropouts or glitches occur, reduce the amount of active processing or close other resource-intensive applications and browser tabs.

## 18. Keyboard and Interaction Shortcuts

The primary shortcuts currently available are:

- **Space** — Play / Pause.
- **X** — Stop.
- **C** — Toggle metronome.
- **M** — Toggle mixer.
- **S** — Toggle snapping.
- **T** — Add track if the track limit has not been reached.
- **Ctrl/Cmd + G** — Normalize gain.
- **Ctrl/Cmd + Z** — Undo.
- **Ctrl/Cmd + Shift + Z** — Redo.
- **Ctrl + Y** — Redo on platforms that use this convention.
- **Delete / Backspace** — Delete selected clip.
- **Ctrl/Cmd + Click** — Multi-select clips.
- **Escape** — Close certain menus or exit multi-selection.
- **Shift while dragging a clip** — Temporarily bypass snapping.

Shortcut coverage may expand in future versions.

## 19. Audio Import and Formats

Input files use the browser's file-handling system with `audio/*` as the accepted file category.

Actual decodable formats still depend on the codecs supported by the user's browser.

For stem-based workflows, WAV is generally a safe and common choice because it does not use lossy compression on the source material being mixed.

Each imported clip stores an AudioBuffer in browser memory while the session is active.

As a result, projects with many long files or high sample rates may consume a significant amount of memory.

## 20. Rendering Audio

DigiDAW provides offline rendering for producing the final project output.

Rendering follows the project signal chain, including:

- Clip timing.
- Clip fades.
- Track insert processing.
- Track level and pan.
- Master insert processing.
- Master level and pan.

The current render output is exported as a WAV file.

Before rendering, check:

1. Clip start and end points.
2. Track balance.
3. FX bypass states.
4. Master level.
5. Limiter ceiling, when used.
6. Reverb or delay tails.

DigiDAW also accounts for effect tails for selected processors when determining the required render duration.

## 21. Current Limitations

DigiDAW is still under active development.

Current limitations include:

- A maximum of 25 tracks in the current UI/engine.
- No persistent project save/load yet.
- No user accounts yet.
- No cloud project storage yet.
- No real-time collaboration yet.
- Refreshing the browser can remove a project that has not been rendered.
- Multi-select does not yet make every operation a group edit automatically.
- Bulk import and some editing-history behavior are still being refined.
- Ditune remains beta, and resynthesis quality is still an active development area.
- Different browsers and devices can have different performance limits and codec support.

This documentation will be updated as DigiDAW evolves.



# DigiDAW Philosophy

Crescentials Record started DigiDAW with the belief that learning and making music should not begin with searching for pirated software.

Not everyone can immediately afford a commercial DAW, plugins, or an expensive workstation. But limited budgets should not prevent someone from learning balance, EQ, compression, spatial processing, dynamic control, and audio finishing.

DigiDAW aims to sit between two worlds:

- More accessible than a commercial desktop DAW.
- More capable and serious than a basic web audio editor.

The long-term goal is simple:

> Open the browser. Import stems. Mix. Master. Render. Done.

No cracks.

No pirated serial numbers.

No unnecessary barriers.

**DigiDAW, a free web-based linear workstation for real mixing and mastering.**
