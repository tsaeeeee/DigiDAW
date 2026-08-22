# DigiDAW Documentation

**DigiDAW** adalah Digital Audio Workstation berbasis browser yang dirancang untuk workflow mixing dan mastering yang cepat, ringan, mudah diakses, gratis, dan dapat digunakan tanpa bergantung pada software bajakan.

DigiDAW dipelopori oleh **Crescentials Record** dengan satu tujuan sederhana: membuka akses ke workflow audio yang lebih serius untuk producer pemula, musisi independen, engineer yang sedang belajar, sampai pengguna profesional yang membutuhkan DAW cepat untuk bekerja langsung dari browser.

> Fokus DigiDAW bukan menjadi music player dengan beberapa efek. Fokusnya adalah menghadirkan workflow DAW yang nyata: import stems, edit timeline, mixing per track, insert effect serial, master bus, metering, dan render audio.

---

## 1. Kenapa DigiDAW Dibuat

Tidak semua producer atau musisi memiliki akses ke DAW komersial. Ada yang baru mulai belajar, ada yang menggunakan komputer bersama, ada yang hanya membutuhkan workstation ringan untuk menyelesaikan mixing cepat, dan ada juga yang tidak ingin menggunakan software hasil crack atau pembajakan.

DigiDAW dibuat sebagai alternatif yang lebih sehat untuk kondisi tersebut.

Prinsip utamanya:

- **Gratis untuk digunakan.** Workflow dasar mixing dan mastering tidak dikunci di balik subscription.
- **Legal sebagai alternatif penggunaan DAW bajakan.** Pengguna tidak perlu mencari crack, serial ilegal, atau installer tidak terpercaya hanya untuk belajar mixing.
- **Browser-first.** DigiDAW berjalan langsung di browser dan memanfaatkan Web Audio API serta DSP yang berjalan di sisi pengguna.
- **Ringan secara arsitektur.** Pemrosesan audio utama dilakukan di device pengguna, bukan dengan mengirim seluruh session ke server untuk diproses.
- **Berorientasi workflow nyata.** Timeline, track, clip, mixer, insert FX, master bus, metering, undo/redo, dan render dibangun sebagai satu workflow.
- **Tidak memaksa akun pada tahap saat ini.** Pengguna dapat langsung masuk ke launcher dan bekerja.

DigiDAW bukan pengganti mutlak semua DAW desktop dalam setiap skenario. DigiDAW dikembangkan sebagai workstation yang praktis, mudah diakses, dan cukup serius untuk menjadi alat mixing/mastering berbasis browser yang benar-benar berguna.

---

## 2. Arsitektur Session Saat Ini

Pada versi DigiDAW saat ini, session bekerja secara **client-side**.

Artinya, ketika dua pengguna membuka DigiDAW pada waktu yang sama, masing-masing menjalankan instance React, Tone.js, Web Audio, track state, AudioBuffer, transport, dan plugin state miliknya sendiri di browser masing-masing.

Secara sederhana:

```text
DigiDAW Web Server
        |
        +-- User A Browser
        |      +-- Track A
        |      +-- AudioBuffer A
        |      +-- Mixer A
        |      +-- FX A
        |
        +-- User B Browser
               +-- Track B
               +-- AudioBuffer B
               +-- Mixer B
               +-- FX B
```

User B tidak otomatis melihat timeline, stems, plugin, atau perubahan milik User A.

Pada tahap saat ini DigiDAW belum memiliki:

- Login dan user account.
- Cloud project storage.
- Save project ke server.
- Shared project room.
- Realtime collaboration.
- Session sinkron antar device.

Konsekuensinya, project juga belum persistent. Jika tab ditutup atau browser direfresh, state project yang hanya berada di memory browser dapat hilang.

Ini adalah batasan yang disengaja pada fase awal pengembangan supaya fokus utama tetap pada kualitas workflow mixing, editing, DSP, dan performa browser.

---

## 3. Memulai DigiDAW

### 3.1 Membuka launcher

Saat DigiDAW dibuka, halaman awal menampilkan launcher. Dari sidebar landing page tersedia dua pilihan:

- **DigiDAW** — membuka tampilan launcher utama.
- **Documentation** — membuka dokumentasi yang sedang Anda baca sekarang.

Tekan **Launch** untuk menginisialisasi audio engine dan masuk ke workspace.

### 3.2 Import audio

Ada dua workflow import utama.

**Upload per track**

Gunakan tombol upload pada track header untuk memilih satu file audio dan memasukkannya ke track tersebut.

**Bulk stem drag and drop**

Beberapa file audio dapat dipilih sekaligus dari Finder atau File Explorer lalu ditarik langsung ke DigiDAW.

Bulk import dirancang untuk workflow stems:

- Satu file audio dipetakan ke satu track.
- Track kosong yang sudah tersedia akan dipakai terlebih dahulu.
- Jika jumlah track tidak cukup, DigiDAW dapat menambahkan track baru sampai batas yang tersedia.
- File audio diselaraskan ke waktu import yang sama agar stems tetap sejajar.
- File non-audio diabaikan.
- Batas track DigiDAW saat ini adalah **25 track**.

### 3.3 Atur BPM

BPM control tersedia di transport bar. BPM digunakan oleh timeline beat grid, bar/beat display, metronome, dan mode delay yang disinkronkan ke tempo.

### 3.4 Mulai editing

Setelah audio berada di timeline, clip dapat dipindah, dipotong, diberikan fade, dipilih, dihapus, dan diatur menggunakan snapping.

### 3.5 Mixing

Buka mixer, atur level dan pan setiap track, kemudian gunakan FX rack pada track atau master channel sesuai kebutuhan.

### 3.6 Mastering dan render

Setelah balance selesai, gunakan master FX chain, limiter jika diperlukan, pantau meter, lalu gunakan fungsi render untuk menghasilkan file audio hasil akhir.

---

## 4. Workspace DigiDAW

Workspace utama dibagi menjadi beberapa bagian besar: transport, timeline, track lane, mixer, FX rack, master channel, metering, dan render control.

### 4.1 Transport

Transport bar menyediakan kontrol utama pemutaran.

Fungsi utama:

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

Timeline adalah area utama untuk mengatur clip audio.

Timeline memiliki:

- Horizontal time ruler.
- Beat/bar grid berdasarkan BPM.
- Playhead.
- Track lanes.
- Dynamic timeline length.
- Snap points dari clip lain, playhead, titik nol, dan beat grid.

Timeline akan memanjang mengikuti clip terpanjang serta posisi playhead.

### 4.3 Playhead-centered zoom

Zoom DigiDAW tidak menggunakan titik awal timeline sebagai pusat zoom.

Ketika zoom dilakukan, posisi playhead dijaga sebagai pivot utama sehingga workflow terasa lebih dekat dengan editing DAW desktop.

Zoom control menggunakan desain roller/scroll-wheel dengan karakter berikut:

- Drag ke kanan untuk zoom in.
- Drag ke kiri untuk zoom out.
- Mouse wheel atau trackpad dapat digunakan.
- Nilai zoom mempunyai batas minimum dan maksimum.
- Visual roller tetap dapat bergerak secara kontinu ketika nilai zoom sudah mencapai limit.
- Gerakan visual menggunakan smoothing agar tidak terasa seperti slider biasa.

### 4.4 Snapping

Snapping membantu clip berhenti pada titik yang relevan saat dipindah.

Snap points mencakup:

- Timeline start.
- Playhead.
- Start clip lain.
- End clip lain.
- Beat grid berdasarkan BPM.

Tahan **Shift** ketika sedang melakukan drag untuk melewati snapping sementara tanpa mematikan preference snap secara permanen.

### 4.5 Cut tool

Tool selector di dekat zoom control mempunyai mode:

- **Cursor** — selection, drag, dan fade editing.
- **Cut** — membelah clip pada posisi mouse click.

Saat Cut aktif, klik pada clip akan melakukan split pada titik yang diklik, bukan pada playhead.

Split dilakukan pada AudioBuffer dan menghasilkan dua clip baru.

Fade original dipertahankan secara logis:

- Clip bagian kiri mempertahankan fade-in.
- Clip bagian kanan mempertahankan fade-out.
- Titik split sendiri tidak otomatis menambahkan fade baru.

### 4.6 Fade in dan fade out

Saat menggunakan Cursor mode, area tepi clip mempunyai kontrol fade.

UI fade menggunakan garis visual lurus agar mudah dibaca.

Pemrosesan audio fade dilakukan secara non-destructive terhadap buffer sumber. DigiDAW membuat playback buffer terproses untuk pemutaran dan render, sementara raw clip buffer tetap menjadi sumber utama.

### 4.7 Clip delete

Clip yang dipilih dapat dihapus menggunakan **Delete** atau **Backspace**.

### 4.8 Multi-select

DigiDAW mendukung multi-selection clip.

- Click biasa memilih satu clip.
- **Ctrl + Click** pada Windows/Linux menambah atau melepas clip dari selection.
- **Cmd + Click** pada macOS melakukan fungsi yang sama.
- Selection dapat dilakukan pada clip di track yang berbeda.
- Delete/Backspace dapat menghapus clip yang sedang berada pada multi-selection.
- Escape keluar dari multi-selection.

Pada tahap saat ini multi-select difokuskan untuk selection dan bulk delete. Group movement sebagai satu unit belum menjadi bagian dari behavior yang dijanjikan.

### 4.9 Undo dan redo

DigiDAW mempunyai project history untuk banyak operasi utama.

History mencakup antara lain:

- Add track.
- Delete track.
- Upload audio.
- Move clip.
- Split clip.
- Fade change.
- Delete clip.
- Volume/pan/mute/solo.
- Track color.
- FX changes.
- Master parameter changes.
- BPM changes.
- Normalize gain.

History dibatasi agar memory tetap terkontrol.

---

## 5. Track dan Mixer

### 5.1 Track

Setiap track mempunyai:

- Nama track.
- Track color.
- Satu atau lebih audio clip.
- Volume.
- Pan.
- Mute.
- Solo.
- Insert effect chain.
- Metering.

Nama track dapat diubah melalui track header.

### 5.2 Mixer channel

Mixer menggunakan channel strip vertikal yang mewakili setiap track.

Kontrol utama channel:

- Stereo level meter.
- Volume fader.
- Pan.
- Mute.
- Solo.
- FX rack.
- Track label.

Desain mixer menggunakan pendekatan flat matte dengan warna brand utama **#ffd900**.

### 5.3 Master channel

Semua track akhirnya menuju master channel.

Master channel memiliki volume, pan, FX rack, dan jalur output/render sendiri.

Master digunakan untuk processing akhir seperti master EQ, bus compression, saturation, limiter, atau kombinasi lain sesuai kebutuhan.

---

## 6. Signal Flow

Signal flow DigiDAW dirancang tetap serial dan dapat diprediksi.

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

Insert effect diproses secara serial. Posisi effect di slot yang lebih awal berarti effect tersebut diproses lebih dahulu.

Contoh:

```text
Diequ -> Dikompres -> Disaturasi
```

berbeda hasilnya dengan:

```text
Disaturasi -> Dikompres -> Diequ
```

Karena masing-masing plugin menerima hasil dari plugin sebelumnya.

---

## 7. FX Rack

Setiap FX rack menyediakan sampai **7 insert slot**.

Plugin yang tersedia saat ini:

- Dikompres.
- Diequ.
- Ditune.
- Diecho.
- Dipantul.
- Dilimit.
- Disaturasi.
- Disser.

Effect dapat digunakan pada track maupun master.

Setiap slot dapat:

- Diisi plugin.
- Dibypass.
- Dibuka kembali untuk editing.
- Dihapus dari chain.

Plugin window dapat dipindahkan dan beberapa plugin window dapat terbuka dengan z-order yang mengikuti window terakhir yang difokuskan.

---

## 8. Dikompres — Compressor

**Dikompres** adalah compressor untuk mengontrol dynamic range.

Parameter utama:

- **Attack** — menentukan seberapa cepat compressor bereaksi setelah signal melewati threshold.
- **Release** — menentukan seberapa cepat gain reduction kembali setelah signal turun.
- **Ratio** — menentukan seberapa kuat signal di atas threshold dikompresi.
- **Threshold** — level mulai bekerjanya compression.
- **Output** — makeup/output gain setelah proses compression.

Dikompres dilengkapi visual input dan gain reduction agar perubahan dynamic dapat dilihat ketika audio diputar.

Preset yang tersedia:

- Default.
- Punchy Drums.
- Smooth Vocal.
- Bass Control.
- Hard Slam.
- Master Bus.

Contoh workflow vocal:

1. Mulai dari Smooth Vocal.
2. Turunkan threshold sampai gain reduction mulai bekerja pada bagian paling keras.
3. Sesuaikan attack agar transient dan articulation tidak hilang berlebihan.
4. Sesuaikan release agar compressor kembali natural di antara frase.
5. Gunakan output untuk menyamakan perceived level ketika membandingkan bypass dan active.

---

## 9. Diequ — Five-band Equalizer

**Diequ** adalah equalizer lima band.

Setiap band dapat menggunakan bentuk filter:

- Bell / Peaking.
- High Pass.
- Low Pass.
- Low Shelf.
- High Shelf.

Parameter band:

- Frequency.
- Gain.
- Q.
- Filter type.
- Per-band bypass.

Default five-band layout:

- Band 1: High Pass sekitar 40 Hz.
- Band 2: Bell sekitar 250 Hz.
- Band 3: Bell sekitar 1 kHz.
- Band 4: Bell sekitar 4 kHz.
- Band 5: Low Pass sekitar 15 kHz.

Diequ mempunyai visual frequency response dan kontrol band untuk membentuk tonal balance.

Preset saat ini:

- Flat Default.
- Vocal Clarity.
- Bass & Sub Control.
- Smile Curve.

Contoh workflow vocal:

1. Gunakan high-pass untuk membersihkan low rumble jika diperlukan.
2. Evaluasi area low-mid jika vocal terlalu muddy.
3. Gunakan bell di area presence untuk membantu articulation.
4. Gunakan high shelf secara hati-hati untuk air/brightness.
5. Band yang tidak diperlukan dapat dibypass.

---

## 10. Ditune — Vocal Pitch Correction

**Ditune** adalah processor pitch correction chromatic yang dikembangkan untuk vocal.

Ditune saat ini masih dianggap **beta / experimental**. Fitur bekerja sebagai pitch-correction processor, tetapi karakter resynthesis masih menjadi area pengembangan aktif dan belum dimaksudkan untuk diklaim setara dengan produk pitch correction komersial kelas industri.

Parameter utama:

- **Reference Hz** — tuning reference, default 440 Hz.
- **Speed** — kecepatan correction menuju target pitch.
- **Humanize** — mempertahankan variasi vocal agar hasil tidak terlalu kaku.
- **Transition** — mengatur transisi correction antar target pitch.
- **Color** — parameter karakter output/resynthesis.
- **HQ Mode** — mode processing tambahan untuk preset tertentu.

Telemetry Ditune dapat menampilkan:

- Detected note.
- Cents deviation.
- Detected frequency.
- Target frequency.
- Tracking confidence.

Preset saat ini:

- Default Auto-Tune.
- Hard Tune Snap.
- Modern Lead.
- Natural Vocal Polish.
- Smooth R&B.
- Bright Lead.

Gunakan Ditune dengan expectation yang realistis: semakin agresif speed dan semakin rendah humanize, semakin jelas karakter hard-tune yang dihasilkan.

---

## 11. Diecho — Reverb

**Diecho** adalah reverb untuk membangun ruang, depth, ambience, plate-like space, chamber, dan hall.

Parameter utama:

- **H-Cut** — membatasi high frequency pada jalur reverb.
- **L-Cut** — membersihkan low frequency pada reverb.
- **Predelay** — jarak waktu sebelum reverb muncul setelah dry signal.
- **Size** — persepsi ukuran ruang.
- **Mod** — modulation amount.
- **Diff** — diffusion/density karakter pantulan.
- **Speed** — modulation speed.
- **Bass** — karakter low-frequency decay.
- **Decay** — panjang tail reverb.
- **Cross** — crossover untuk pembentukan decay.
- **Damp** — high-frequency damping.
- **Dry** — level dry signal.
- **ER** — early reflection level.
- **Wet** — level reverb.
- **Sep** — stereo separation/width behavior.
- **Mode** — mode processing yang digunakan oleh engine reverb.

Diecho juga menyediakan telemetry input, reverb, dan output dari DSP aktif.

Preset:

- Studio Plate.
- Warm Chamber.
- Wide Hall.
- Dark Vocal Space.
- Endless Side Space.

Untuk vocal, predelay sering berguna untuk menjaga dry articulation tetap di depan sebelum tail reverb muncul.

---

## 12. Dipantul — Stereo Delay

**Dipantul** adalah stereo delay dengan mode time bebas dan tempo-sync.

Parameter utama:

- **Time** — delay time ketika sync dimatikan.
- **Sync Mode** — memilih free time atau tempo-synced delay.
- **Sync Division** — 1/32, 1/16, 1/8, 1/4, 1/2, dan 1/1.
- **Feedback** — jumlah signal delay yang dikembalikan ke delay line.
- **Wet Mix** — level delay effect.
- **Output Gain** — output level plugin.
- **Mod** — modulation/wobble pada delay.
- **Tone** — karakter dark sampai bright.
- **Low Cut** — membersihkan low-frequency repeat.
- **L/R Offset** — perbedaan timing/character antar stereo side.
- **Drive** — menambahkan karakter drive pada repeat.
- **Ping Pong** — memantulkan repeat antar channel kiri dan kanan.

Preset:

- Slapback 120ms.
- Vocal Echo 240ms.
- Ping-Pong Quarter.
- Warm Tape Echo.
- Ambient Space 500ms.

Mode sync menggunakan BPM project sehingga perubahan tempo ikut mempengaruhi pembagian waktu delay.

---

## 13. Dilimit — Brickwall Limiter

**Dilimit** adalah limiter untuk peak ceiling protection dan final level control.

Parameter utama:

- **Ceiling** — batas maksimum output yang dituju oleh limiter.
- **Drive** — mendorong signal ke limiter.
- **Release** — waktu recovery dari gain reduction.
- **Diode Saturation** — menambahkan karakter saturasi pada limiting.
- **True Peak mode** — opsi mode peak protection di plugin.

Visual limiter menampilkan input, output, gain reduction, ceiling line, dan status limiting.

Preset:

- Mastering -0.1dB.
- Analog Slam.
- Streaming -0.5dB.
- Transparent Wall.
- Heavy Brickwall.
- Diode Limiter.

Dilimit biasanya ditempatkan di bagian akhir master chain ketika digunakan sebagai final peak protection.

Contoh:

```text
Master Diequ -> Master Dikompres -> Disaturasi -> Dilimit
```

---

## 14. Disaturasi — Harmonic Saturation

**Disaturasi** menambahkan harmonic coloration dan nonlinear character.

Parameter utama:

- **Input Gain** — level signal yang masuk ke saturation stage.
- **Saturation Drive** — jumlah nonlinear saturation.
- **Mode** — Clean, Normal, Hot, atau Redline.
- **Output Gain** — level setelah saturation.

Mode yang lebih agresif menghasilkan curve saturation yang lebih keras.

Plugin menampilkan transfer curve sehingga hubungan input-output dapat dilihat secara visual.

Preset:

- Default.
- Subtle Console.
- Warm Tape.
- Hot Tube.
- Redline Crush.
- Clean Boost.

Saturation dapat ditempatkan sebelum atau sesudah compressor tergantung karakter yang diinginkan.

---

## 15. Disser — Dynamic Sibilance Control

**Disser** adalah de-esser untuk mengontrol sibilance tanpa membangun jalur audio paralel permanen pada mode normal.

S-band digunakan sebagai detector/sidechain untuk menentukan kapan sibilance terlalu menonjol. Main audio tetap melewati satu jalur processing utama.

Parameter utama:

- **Low Frequency** — batas bawah detection band.
- **High Frequency** — batas atas detection band.
- **Threshold** — trigger level.
- **Detection** — sensitivitas detection.
- **Amount** — maksimum reduction yang diizinkan.
- **Attack** — seberapa cepat reduction masuk.
- **Release** — seberapa cepat reduction kembali.
- **Mode** — mode behavior processing.
- **Listen** — monitor detector band ketika diperlukan.

UI telemetry menampilkan:

- Sibilance band activity.
- Detector level.
- Raw sibilance level.
- Relative prominence.
- Trigger excess.
- Gain reduction.
- Backend processing state.

Backend dapat menggunakan AudioWorklet path atau safe native serial fallback.

Disser dibangun sebagai **single-path dynamic shelf** pada jalur worklet utamanya, dengan detector yang digunakan untuk mengontrol reduction secara dinamis.

---

## 16. Normalize Gain

DigiDAW mempunyai fungsi normalize peak.

Default target pada control saat ini adalah **-1.0 dB peak**.

Behavior normalize mengikuti selection:

- Jika clip dipilih, hanya clip tersebut yang dinormalisasi.
- Jika track dipilih, clip pada track tersebut menjadi target.
- Jika tidak ada selection, semua clip yang tersedia dapat menjadi target.

Normalize memproses AudioBuffer dan memperbarui playback buffer pada track yang terdampak.

Normalize bukan pengganti mixing balance atau limiter. Ini hanya membantu menyesuaikan peak level sumber ke target tertentu.

---

## 17. Metering dan Monitoring

DigiDAW mempunyai beberapa visual monitoring.

### Track meter

Mixer channel menyediakan stereo level meter untuk membantu melihat level kiri dan kanan.

### Mini master display

Transport bar menyediakan mini display dengan mode spectrum dan peak.

RTA menggunakan pembagian frequency secara logaritmik dan tidak lagi menggunakan kompensasi pink-noise tilt sebagai reference display.

### System performance

DigiDAW mempunyai System Performance Display untuk membantu pengguna mengawasi kondisi runtime ketika jumlah track dan DSP bertambah.

Karena audio processing berjalan di browser pengguna, performa sangat bergantung pada:

- CPU device.
- Jumlah track.
- Jumlah plugin aktif.
- Complexity plugin.
- Audio buffer dan browser runtime.

Jika terjadi drop-out atau glitch, kurangi jumlah processing aktif atau tutup aplikasi/tab berat lain pada device.

---

## 18. Keyboard dan Interaction Shortcut

Shortcut utama yang tersedia pada workflow sekarang:

- **Space** — Play / Pause.
- **X** — Stop.
- **C** — Toggle metronome.
- **M** — Toggle mixer.
- **S** — Toggle snapping.
- **T** — Add track jika belum mencapai limit.
- **Ctrl/Cmd + G** — Normalize gain.
- **Ctrl/Cmd + Z** — Undo.
- **Ctrl/Cmd + Shift + Z** — Redo.
- **Ctrl + Y** — Redo pada platform yang menggunakan convention tersebut.
- **Delete / Backspace** — Delete selected clip.
- **Ctrl/Cmd + Click** — Multi-select clip.
- **Escape** — menutup menu tertentu atau keluar dari multi-selection.
- **Shift saat drag clip** — temporary bypass snapping.

Shortcut dapat berkembang pada versi berikutnya.

---

## 19. Import dan Format Audio

Input file menggunakan browser file handling dengan `audio/*` sebagai accepted file category.

Format yang benar-benar dapat didecode tetap bergantung pada codec yang didukung browser pengguna.

Untuk workflow stems, file WAV biasanya menjadi pilihan yang aman dan umum karena tidak menggunakan lossy compression pada sumber mixing.

Setiap imported clip menyimpan AudioBuffer di memory browser selama session aktif.

Karena itu, project dengan banyak file panjang dan sample rate tinggi dapat menggunakan memory yang cukup besar.

---

## 20. Render Audio

DigiDAW menyediakan offline render untuk menghasilkan hasil akhir project.

Render mengikuti signal chain project, termasuk:

- Clip timing.
- Clip fade.
- Track insert processing.
- Track level dan pan.
- Master insert processing.
- Master level dan pan.

Output render saat ini diekspor sebagai file WAV.

Sebelum render, periksa:

1. Start dan end clip.
2. Balance track.
3. FX bypass state.
4. Master level.
5. Limiter ceiling jika digunakan.
6. Tail dari reverb atau delay.

DigiDAW juga memperhitungkan effect tail untuk beberapa processor ketika menentukan kebutuhan render duration.

---

## 21. Rekomendasi Workflow Mixing Dasar

Berikut contoh workflow sederhana untuk pengguna yang baru mulai.

### Step 1 — Import stems

Masukkan kick, snare, bass, instrument, lead vocal, backing vocal, dan stem lain.

### Step 2 — Static balance

Sebelum menggunakan plugin, atur volume track sampai lagu sudah terasa seimbang.

### Step 3 — Pan

Gunakan pan untuk memberi ruang stereo jika arrangement membutuhkan.

### Step 4 — Cleanup EQ

Gunakan Diequ untuk mengurangi frequency yang tidak dibutuhkan atau memperbaiki area yang mengganggu.

### Step 5 — Dynamic control

Gunakan Dikompres ketika track mempunyai dynamic range yang perlu dikontrol.

### Step 6 — Vocal processing

Jika diperlukan:

- Ditune untuk pitch correction.
- Disser untuk sibilance.
- Diequ untuk tone.
- Dikompres untuk dynamic.
- Diecho / Dipantul untuk space.

### Step 7 — Character

Gunakan Disaturasi secara ringan jika ingin menambah harmonic character.

### Step 8 — Master bus

Gunakan processing master secara konservatif. Jangan memaksa master chain memperbaiki balance yang seharusnya diselesaikan di track.

### Step 9 — Limiting

Gunakan Dilimit sebagai final peak protection bila diperlukan.

### Step 10 — Render dan compare

Render hasil, dengarkan kembali di sistem playback lain, lalu lakukan revisi jika perlu.

---

## 22. Contoh Vocal Chain

Contoh chain yang dapat digunakan sebagai starting point:

```text
Disser
  -> Diequ
  -> Dikompres
  -> Ditune
  -> Disaturasi
  -> Diecho
  -> Dipantul
```

Urutan di atas bukan aturan wajib.

Contoh alternatif:

```text
Ditune
  -> Disser
  -> Diequ
  -> Dikompres
  -> Disaturasi
  -> Diecho
```

Karena plugin diproses serial, urutan menghasilkan karakter yang berbeda.

---

## 23. Contoh Master Chain

Starting point sederhana:

```text
Diequ
  -> Dikompres
  -> Disaturasi
  -> Dilimit
```

Tujuan master processing sebaiknya bukan sekadar membuat audio sekeras mungkin. Gunakan processing untuk tonal balance, glue, harmonic character, dan peak protection dengan tetap menjaga hasil yang nyaman didengar.

---

## 24. Batasan Versi Saat Ini

DigiDAW masih dalam pengembangan aktif.

Beberapa batasan yang perlu diketahui:

- Maksimum 25 track pada UI/engine saat ini.
- Belum ada project save/load persistent.
- Belum ada user account.
- Belum ada cloud project storage.
- Belum ada realtime collaboration.
- Refresh browser dapat menghilangkan project yang belum dirender.
- Multi-select belum berarti semua operasi otomatis menjadi group edit.
- Bulk import dan beberapa editing history masih terus dipoles.
- Ditune masih beta dan resynthesis quality masih menjadi area pengembangan.
- Browser/device yang berbeda dapat memberikan batas performa dan codec support yang berbeda.

Dokumentasi ini akan diperbarui mengikuti perubahan fitur.

---

## 25. Filosofi DigiDAW

Crescentials Record memulai DigiDAW dengan keyakinan bahwa belajar dan membuat musik tidak seharusnya dimulai dengan mencari software bajakan.

Tidak semua orang mampu langsung membeli DAW, plugin, atau workstation mahal. Tetapi keterbatasan budget tidak seharusnya menghentikan seseorang untuk belajar balance, EQ, compression, spatial processing, dynamic control, dan finishing audio.

DigiDAW mencoba mengambil posisi di antara dua dunia:

- Lebih mudah diakses daripada DAW desktop komersial.
- Lebih serius daripada web audio editor sederhana.

Tujuan akhirnya sederhana:

> Buka browser. Import stems. Mix. Master. Render. Selesai.

Tanpa crack.

Tanpa serial bajakan.

Tanpa barrier yang tidak perlu.

**DigiDAW — a free browser-based workstation for real mixing and mastering.**
