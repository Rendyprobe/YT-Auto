# Sequence Prompts — Faceless “Would You Rather” YouTube Shorts

## Cara Menggunakan

1. Letakkan `project-context.md` di root repository.
2. Kirim Prompt 1 ke AI Coding Assistant.
3. Periksa ringkasan perubahan dan hasil tesnya.
4. Lanjutkan ke prompt berikutnya hanya setelah acceptance criteria prompt sebelumnya terpenuhi.
5. Setiap prompt di bawah ini berdiri sendiri dan sudah memerintahkan AI untuk membaca konteks proyek terlebih dahulu.

---

## Prompt 1 — Modul Data & Audio

```text
Baca seluruh file `project-context.md` terlebih dahulu dan jadikan isinya sebagai system rules proyek ini. Setelah itu, inspeksi struktur repository serta file yang sudah ada. Jangan mengimplementasikan layout video, animasi, atau upload YouTube pada langkah ini.

Tujuan langkah ini:
Membangun modul data dan audio yang mengambil tepat satu baris pertama dari `data/data.csv` yang belum pernah berhasil diproses, memvalidasinya, kemudian membuat TTS bahasa Inggris untuk Opsi A dan Opsi B.

Scope implementasi:
1. Jika repository masih kosong, buat hanya folder/file minimum yang dibutuhkan modul ini berdasarkan arsitektur di `project-context.md`.
2. Buat atau lengkapi:
   - `scripts/data_audio.py`
   - helper minimum yang benar-benar diperlukan di `scripts/common/`
   - `config/settings.example.json`
   - `requirements.txt`
   - `.gitignore`
   - `tests/test_data_audio.py`
3. Baca CSV dengan kolom wajib persis:
   `Topik`, `Opsi A`, `Opsi B`, `Persentase A`, `Persentase B`.
4. Abaikan baris kosong, tetapi gagalkan proses jika ada kolom wajib yang hilang atau nilai penting kosong.
5. Normalisasi input secara konservatif dan buat `content_id` deterministik dari gabungan Topik + Opsi A + Opsi B menggunakan SHA-256.
6. Gunakan `state/processing_state.json` untuk memilih baris pertama yang belum memiliki status sukses lanjutan. Jangan mengubah kolom atau isi sumber `data.csv`.
7. Validasi persentase sebagai angka 0–100 dan pastikan totalnya 100 dalam toleransi kecil yang terdokumentasi.
8. Gunakan `edge-tts` secara asynchronous untuk membuat:
   - `output/audio/<content_id>/option_a.mp3`
   - `output/audio/<content_id>/option_b.mp3`
   Voice default harus English dan configurable, misalnya `en-US-AriaNeural`.
9. Tambahkan timeout, retry terbatas dengan exponential backoff untuk error sementara, serta pesan error yang actionable.
10. Buat `output/jobs/<content_id>/manifest.json` berisi data sumber yang telah divalidasi, content_id, path audio, voice, durasi audio jika bisa dibaca secara aman, timestamps, dan status.
11. Gunakan temporary file + atomic rename. Status tidak boleh menjadi `audio_ready` sebelum kedua file MP3 valid dan tidak kosong.
12. Sediakan CLI yang jelas, misalnya:
    `python -m scripts.data_audio --csv data/data.csv --voice en-US-AriaNeural`
    Tambahkan `--help` dan opsi retry/timeout yang masuk akal.

Error handling wajib:
- Gunakan targeted `try-except` untuk file I/O, parsing/validation CSV, JSON state, dan pemanggilan `edge-tts`.
- Jangan memakai bare `except` atau menyembunyikan traceback.
- Gunakan modul `logging`, tulis ringkasan ke console dan detail ke file log.
- Jika gagal, kembalikan exit code nonzero, simpan `failed_step` dan error ringkas tanpa menghapus artefak valid dari proses sebelumnya.
- Jangan mencetak secrets atau seluruh payload sensitif.

Testing wajib sebelum berhenti:
- Gunakan `unittest` bawaan Python atau `pytest` jika sudah menjadi dependency proyek; jangan menambah framework tanpa alasan.
- Mock pemanggilan `edge-tts` agar unit test tidak memerlukan internet.
- Uji minimal: CSV valid, kolom hilang, persentase invalid, pemilihan baris pending pertama, content_id stabil, kegagalan TTS, dan rerun yang idempotent.
- Buat sample CSV kecil yang aman bila belum ada.
- Jalankan `python -m unittest discover -s tests -p "test_data_audio.py"` atau perintah tes setara.
- Jalankan `python -m scripts.data_audio --help`.
- Jika network tersedia, berikan perintah smoke test TTS nyata sebagai langkah manual; jangan jadikan itu syarat unit test.

Acceptance criteria:
- Hanya modul data/audio dan helper langsungnya yang diubah.
- Semua tes lokal yang relevan lulus.
- Satu manifest valid dapat dihasilkan dari sample CSV menggunakan mock atau smoke test.
- Kegagalan menghasilkan log yang jelas dan tidak meninggalkan status sukses palsu.

Sebelum menulis kode, tampilkan rencana file singkat. Setelah implementasi, tampilkan:
1. file yang dibuat/diubah;
2. keputusan desain penting;
3. perintah tes yang dijalankan dan hasil aktual;
4. contoh perintah penggunaan;
5. masalah yang masih tersisa.

Berhenti setelah modul ini selesai. Jangan lanjut ke Prompt 2 dan jangan menulis seluruh pipeline sekaligus.
```

---

## Prompt 2 — Modul Video Layout

```text
Baca seluruh `project-context.md`, lalu inspeksi hasil Prompt 1 dan jalankan tes yang sudah ada sebagai baseline. Pertahankan kontrak manifest dan state yang telah bekerja. Jangan mengimplementasikan animasi countdown, sinkronisasi audio final, atau YouTube uploader pada langkah ini.

Tujuan langkah ini:
Membuat modul layout video split-screen statis 9:16 dari background gambar/video, lalu menempelkan Topik, teks Opsi A, dan teks Opsi B dengan layout yang aman untuk YouTube Shorts.

Scope implementasi:
1. Buat atau lengkapi:
   - `scripts/video_layout.py`
   - helper layout yang benar-benar diperlukan
   - `tests/test_video_layout.py`
   - konfigurasi layout terkait di `config/settings.example.json`
2. Input utama adalah `output/jobs/<content_id>/manifest.json` berstatus `audio_ready`.
3. Cari background dari:
   - `assets/backgrounds/images/`
   - `assets/backgrounds/videos/`
   Izinkan path eksplisit melalui CLI/config agar hasil dapat direproduksi.
4. Buat kanvas portrait `1080x1920` pada 30 fps:
   - Opsi A pada setengah atas.
   - Opsi B pada setengah bawah.
   - Divider kontras di tengah.
   - Area kosong/placeholder bersih untuk timer tepat di tengah.
   - Topik sebagai header ringkas yang tidak bertabrakan dengan Opsi A.
5. Background harus crop-to-fill, tidak boleh distorsi. Video background harus muted, dapat di-loop/trim, dan diproses deterministik bila seed diberikan.
6. Bila hanya satu background tersedia, boleh digunakan dua kali dengan crop/offset berbeda. Bila tidak ada background valid, gagal dengan instruksi yang jelas.
7. Teks harus:
   - auto-wrap berdasarkan lebar pixel, bukan hanya jumlah karakter;
   - auto-fit sampai ukuran font minimum;
   - memiliki stroke atau shadow berkontras tinggi;
   - menggunakan font lokal open-license dari `assets/fonts/`;
   - tetap berada di safe area Shorts sebagaimana diatur dalam project context.
8. Gunakan MoviePy untuk komposisi video. Gunakan ImageMagick melalui pemanggilan yang aman untuk pembuatan/normalisasi layer teks atau aset raster sesuai kebutuhan:
   - deteksi executable `magick`/`convert` secara portable;
   - gunakan `subprocess` dengan argument list dan `shell=False`;
   - jangan menyusun shell command dari teks CSV;
   - jika ImageMagick/font tidak tersedia, tampilkan error diagnosis yang actionable.
9. Hasilkan:
   - preview frame PNG untuk inspeksi visual;
   - base layout MP4 tanpa audio/animasi persentase di `output/intermediate/<content_id>/layout_base.mp4`.
10. Durasi base layout harus configurable dan nantinya boleh di-loop/trim oleh Prompt 3.
11. Setelah file output valid, perbarui manifest/state menjadi `layout_ready` menggunakan temporary file + atomic rename.
12. Sediakan CLI, misalnya:
    `python -m scripts.video_layout --manifest output/jobs/<content_id>/manifest.json --background-a <path> --background-b <path> --preview`

Error handling wajib:
- Targeted `try-except` untuk manifest/config, media yang corrupt, font, ImageMagick, MoviePy/FFmpeg, dan output file.
- Bersihkan hanya temporary file milik proses saat ini; jangan menghapus output valid lama.
- Exit code harus nonzero saat gagal dan state tidak boleh menjadi `layout_ready`.
- Gunakan logging dengan traceback pada log file dan pesan singkat yang berguna di console.

Testing wajib sebelum berhenti:
- Jalankan seluruh tes Prompt 1 terlebih dahulu.
- Gunakan aset gambar/video sintetis kecil yang dibuat saat test setup; jangan bergantung pada download internet.
- Uji minimal: crop-to-fill image, input video muted, fallback satu background, text wrapping/auto-fit, missing font, missing/corrupt media, dimensi output, preview PNG, dan manifest status.
- Mock subprocess ImageMagick pada unit test yang tepat, tetapi sediakan satu integration check jika ImageMagick lokal tersedia.
- Render mode cepat `--preview` pada resolusi rendah, misalnya 360x640, agar tes tidak berat.
- Verifikasi preview frame secara programatik; jika environment memungkinkan, buka/inspeksi juga hasil gambarnya dan laporkan observasi layout.
- Jalankan `python -m scripts.video_layout --help`.

Acceptance criteria:
- Preview menunjukkan Opsi A di atas, Opsi B di bawah, divider/timer placeholder di tengah, serta teks tidak terpotong.
- MP4 base layout memiliki resolusi/aspect ratio/fps yang benar untuk mode yang dipilih.
- Background video tidak membawa audio.
- Error tidak membuat manifest/state sukses palsu.
- Tidak ada implementasi countdown atau upload YouTube pada langkah ini.

Sebelum mengubah kode, tampilkan rencana file singkat. Setelah implementasi, tampilkan:
1. file yang dibuat/diubah;
2. keputusan layout dan safe-area;
3. perintah tes dan hasil aktual;
4. path preview untuk diperiksa;
5. masalah yang masih tersisa.

Berhenti setelah modul layout statis selesai dan tunggu persetujuan untuk Prompt 3.
```

---

## Prompt 3 — Modul Animasi & Audio Sync

```text
Baca seluruh `project-context.md`, inspeksi implementasi Prompt 1–2, lalu jalankan semua tes lama sebagai baseline. Jangan mengubah kontrak CSV, content_id, atau manifest tanpa migration/backward compatibility yang jelas. Jangan mengimplementasikan YouTube uploader pada langkah ini.

Tujuan langkah ini:
Menyusun video final dengan sinkronisasi audio TTS, countdown lima detik, dan reveal Persentase A/B pada detik terakhir countdown.

Scope implementasi:
1. Buat atau lengkapi:
   - `scripts/compose_video.py`
   - helper timeline/render yang benar-benar diperlukan
   - `tests/test_compose_video.py`
   - konfigurasi timing/render terkait
2. Input adalah manifest berstatus `layout_ready`, dua file TTS valid, dan `layout_base.mp4`.
3. Baca durasi nyata `option_a.mp3` dan `option_b.mp3`. Jangan hard-code durasi voice-over.
4. Implementasikan timeline default dari `project-context.md`:
   - pre-roll 0.25 detik;
   - audio Opsi A;
   - pause 0.35 detik;
   - audio Opsi B;
   - pause 0.50 detik;
   - countdown tepat 5 detik dengan angka 5, 4, 3, 2, 1;
   - Persentase A dan B muncul saat satu detik terakhir countdown dimulai;
   - hold result 0.75 detik.
   Semua nilai harus configurable.
5. Loop atau trim `layout_base.mp4` agar tepat sepanjang timeline final.
6. Audio Opsi A dan B harus mulai tepat sesuai timeline. Gunakan silence di antaranya; jangan menimpa atau memotong speech.
7. Countdown berada di tengah divider, mudah dibaca, dan berubah sekali per detik. Tambahkan animasi ringan seperti fade/scale/pop yang tidak mengganggu keterbacaan.
8. Reveal hasil:
   - `Persentase A` tampil di bagian atas.
   - `Persentase B` tampil di bagian bawah.
   - Keduanya fade/scale in pada awal detik terakhir dan tetap terlihat sampai video selesai.
9. Gunakan MoviePy untuk komposisi dan ImageMagick secara aman untuk layer teks/raster jika pola dari Prompt 2 menggunakannya. Cache layer angka/persentase agar tidak merender ulang setiap frame.
10. Render final ke `output/videos/<content_id>.mp4` dengan:
    - 1080x1920;
    - 30 fps;
    - H.264;
    - AAC;
    - `yuv420p`;
    - opsi render cepat `--preview` pada resolusi rendah.
11. Render ke temporary output terlebih dahulu. Validasi file, lalu atomic rename dan ubah status menjadi `video_ready`.
12. Jangan menandai `uploaded` dan jangan memanggil YouTube API.
13. Sediakan CLI, misalnya:
    `python -m scripts.compose_video --manifest output/jobs/<content_id>/manifest.json --preview`

Error handling wajib:
- Targeted `try-except` untuk file audio/video, durasi/codec, timeline invalid, komposisi, FFmpeg/MoviePy, dan state write.
- Pastikan seluruh clip/resource ditutup melalui context manager atau blok `finally`.
- Jika render gagal, pertahankan output final lama yang valid dan hapus hanya temporary file proses saat ini.
- Log harus menyertakan nama step dan content_id, tanpa membanjiri console.
- Exit nonzero dan jangan pernah menulis status `video_ready` sebelum validasi akhir lulus.

Testing wajib sebelum berhenti:
- Jalankan semua tes modul sebelumnya.
- Unit test fungsi perhitungan timeline secara deterministik.
- Uji minimal: urutan waktu A/B, lima interval countdown, reveal tepat pada detik terakhir, base video loop/trim, audio tidak overlap, cleanup saat gagal, dan atomic state update.
- Buat audio/video sintetis pendek untuk automated test; tidak perlu memanggil edge-tts.
- Render satu preview 360x640.
- Buka output dengan MoviePy/FFprobe dan verifikasi: file nonzero, durasi sesuai perhitungan dalam toleransi kecil, resolusi, fps, codec yang diharapkan bila dapat dibaca, dan adanya audio track.
- Ambil frame sampel pada countdown 5, countdown 1/reveal, dan hold result; inspeksi programatik bahwa overlay muncul. Jika environment mendukung visual inspection, tampilkan/inspeksi frame tersebut dan laporkan.
- Jalankan `python -m scripts.compose_video --help`.

Acceptance criteria:
- TTS A dan B sinkron serta tidak terpotong.
- Countdown berlangsung tepat lima detik dan menampilkan 5 hingga 1.
- Kedua persentase muncul pada detik terakhir dan bertahan sampai akhir.
- Final MP4 kompatibel untuk YouTube Shorts.
- Kegagalan tidak menghasilkan status sukses palsu.

Sebelum mengubah kode, tampilkan rencana file singkat. Setelah implementasi, tampilkan:
1. file yang dibuat/diubah;
2. tabel timeline aktual berdasarkan durasi audio sample;
3. perintah tes dan hasil aktual;
4. path video dan frame preview;
5. masalah yang masih tersisa.

Berhenti setelah modul render final selesai dan tunggu persetujuan untuk Prompt 4.
```

---

## Prompt 4 — Modul YouTube Uploader

```text
Baca seluruh `project-context.md`, inspeksi implementasi Prompt 1–3, dan jalankan semua tes lama sebagai baseline. Fokus hanya pada upload YouTube dan perubahan state setelah upload. Jangan merombak modul rendering yang sudah lulus tes.

Tujuan langkah ini:
Mengunggah `output/videos/<content_id>.mp4` yang berstatus `video_ready` ke YouTube menggunakan YouTube Data API v3 dengan OAuth 2.0, upload resumable, pencegahan duplikasi, dan mode dry-run yang aman.

Scope implementasi:
1. Buat atau lengkapi:
   - `scripts/youtube_uploader.py`
   - helper OAuth/upload minimum yang diperlukan
   - `tests/test_youtube_uploader.py`
   - bagian YouTube pada `config/settings.example.json`
   - `.gitignore` untuk seluruh credential/token lokal
2. Gunakan:
   - `google-api-python-client`
   - `google-auth`
   - `google-auth-oauthlib`
   - YouTube Data API v3 scope minimum yang diperlukan untuk upload.
3. Ambil input dari manifest berstatus `video_ready` dan validasi MP4 sebelum membangun request.
4. OAuth installed-app flow:
   - baca client secret dari `credentials/client_secret.json` atau path CLI;
   - simpan refreshable token di `credentials/token.json`;
   - refresh token yang kedaluwarsa bila memungkinkan;
   - jangan log credential, access token, refresh token, atau isi file secret.
5. Metadata default dibuat dari manifest:
   - title singkat berbasis Topik, aman dalam limit YouTube;
   - description berisi pertanyaan, Opsi A/B, dan CTA netral;
   - tags relevan seperti `would you rather`, `quiz`, `shorts`;
   - category configurable, default Entertainment;
   - privacy default wajib `private`.
6. Upload menggunakan `MediaFileUpload(..., resumable=True)` dengan chunk size configurable.
7. Implementasikan loop `next_chunk()` dan logging progress tanpa membocorkan data sensitif.
8. Retry dengan exponential backoff + jitter hanya untuk error yang layak diulang, misalnya HTTP 429 dan 5xx, timeout, atau disconnect. Jangan mengulang otomatis error OAuth/permission/config yang permanen.
9. Idempotency:
   - jika state sudah `uploaded` dan memiliki `youtube_video_id`, hentikan dengan pesan aman;
   - upload ulang hanya bila user memberi `--force`;
   - status menjadi `uploading` sebelum request dan `uploaded` hanya setelah API mengembalikan video ID valid;
   - simpan `youtube_video_id`, URL, privacy, dan uploaded_at ke manifest/state.
10. Tambahkan `--dry-run` yang melakukan seluruh validasi dan mencetak metadata tersanitasi tanpa autentikasi/upload.
11. Upload nyata harus memerlukan flag eksplisit `--confirm-upload`, contohnya:
    `python -m scripts.youtube_uploader --manifest output/jobs/<content_id>/manifest.json --privacy private --confirm-upload`
    Jika flag tidak ada, jangan upload.
12. Gunakan temporary file + atomic rename untuk update manifest/state. Jika upload berhasil tetapi state write gagal, log video ID dengan jelas ke recovery file lokal agar operator dapat memperbaiki state tanpa upload duplikat.

Error handling wajib:
- Targeted `try-except` untuk config/manifest, file video, OAuth, token refresh, HTTP/API response, resumable session, dan state write.
- Bedakan error retryable dan permanent.
- Exit code nonzero saat gagal dan simpan `failed_step=uploading` tanpa menghapus video final.
- Jangan menangkap `KeyboardInterrupt` sebagai error biasa; hentikan secara rapi dan pertahankan state yang dapat dipulihkan.

Testing wajib sebelum menyatakan selesai:
- Jalankan semua tes Prompt 1–3.
- Mock seluruh OAuth dan YouTube API pada automated tests; tes tidak boleh mengunggah video sungguhan.
- Uji minimal: dry-run, missing secret, token refresh, request metadata, progress resumable, retry 429/5xx, no-retry untuk 400/401/403 yang permanen, state uploaded, recovery saat state-write gagal, pencegahan duplikasi, dan perilaku `--force`.
- Jalankan `python -m scripts.youtube_uploader --help`.
- Jalankan satu dry-run lokal terhadap manifest sample.
- Jangan menjalankan upload nyata selama testing otomatis.
- Berikan langkah manual untuk:
  1. membuat project Google Cloud;
  2. mengaktifkan YouTube Data API v3;
  3. membuat OAuth Desktop App credential;
  4. menaruh client secret pada path yang benar;
  5. melakukan upload pertama sebagai `private`;
  6. memverifikasi video di YouTube Studio.

Acceptance criteria:
- Dry-run berhasil tanpa API call.
- Unit tests membuktikan resumable upload, retry policy, dan idempotency.
- Default privacy adalah `private`.
- Token/secret tidak masuk Git atau log.
- State `uploaded` hanya ditulis setelah video ID valid diterima.
- Tidak ada upload sungguhan tanpa `--confirm-upload`.

Sebelum mengubah kode, tampilkan rencana file singkat. Setelah implementasi, tampilkan:
1. file yang dibuat/diubah;
2. perintah tes dan hasil aktual;
3. contoh dry-run;
4. langkah setup OAuth dan perintah upload private pertama;
5. risiko/limit kuota yang perlu diketahui;
6. checklist integrasi end-to-end dari CSV sampai status uploaded.

Berhenti setelah uploader dan dokumentasi setup selesai. Jangan melakukan upload nyata kecuali saya secara eksplisit memerintahkannya.
```
