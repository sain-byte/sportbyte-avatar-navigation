# Sport Byte — Avatar Navigation Lab

Prototype terpisah untuk menguji avatar GLB sebagai penanda navigasi di atas peta MapLibre.

## Isi
- `index.html` — aplikasi uji peta + avatar.
- `ava-sain.glb` — model avatar yang diberikan pengguna.

## Menjalankan
Ekstrak ZIP, lalu jalankan melalui web server lokal atau unggah kedua file ke satu folder GitHub Pages. Jangan membuka `index.html` sebagai `file://` karena browser biasanya memblokir pemuatan modul dan GLB lokal.

## Fitur
- MapLibre + OpenFreeMap Liberty vector style.
- Import GPX (`trkpt`, fallback `rtept`).
- Semua titik koordinat dipertahankan; tidak ada simplification/smoothing.
- Avatar GLB mengikuti posisi simulasi sepanjang rute.
- Follow camera dan map rotation berdasarkan bearing rute.
- Kontrol simulasi, kecepatan, fit route, dan live GPS (HTTPS/localhost).
- Start/finish dan marker kilometer.

## Pemeriksaan model
Model GLB ini berisi 54 joints, 12 mesh, 1 skin, dan 0 animation clips. Karena belum memiliki animation clips, avatar dapat berpindah dan berputar mengikuti rute tetapi belum memiliki siklus gerak lari. Orientasi depan model mungkin memerlukan penyesuaian kecil setelah uji visual.

## Batasan prototype
- Simulasi menggunakan laju virtual sederhana, bukan pace aktual dari timestamp GPX.
- Live GPS menempatkan avatar di posisi GPS aktual, tetapi belum melakukan map matching atau off-route detection.
- Heading live bergantung pada sensor/browser; saat heading tidak tersedia, arah peta saat ini digunakan.
- Peta dan library Three.js/MapLibre memerlukan koneksi internet.
- Attribution: © OpenStreetMap contributors; vector style/tiles by OpenFreeMap.
