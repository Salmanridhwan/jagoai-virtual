import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Kantor tiga dimensi. Modul ini hanya membaca JSON dari /api/state sesuai
// docs/kontrak-api.md, dan tidak pernah menulis apa pun ke sisi server.

const WARNA = {
  idle: 0x8494ab,
  walk: 0xffcf5c,
  sit: 0x6f8ba8,
  think: 0x63b3ff,
  type: 0xff9d4d,
  review: 0xb78cff,
  ship: 0x5fd38a,
  error: 0xff6b6b,
  coffee: 0xc9a17a,
};

const RUANG = {
  'ruang:brief': [-7.5, 0, -5.5],
  'ruang:sunting': [7.5, 0, -5.5],
  'ruang:studio': [0, 0, -8.2],
};

const kanvas = document.getElementById('kanvas');
const adegan = new THREE.Scene();
adegan.background = new THREE.Color(0x070a10);
adegan.fog = new THREE.Fog(0x070a10, 22, 46);

const kamera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 200);
kamera.position.set(13, 12, 17);

const penyaji = new THREE.WebGLRenderer({ antialias: true });
penyaji.setPixelRatio(Math.min(devicePixelRatio, 2));
penyaji.setSize(innerWidth, innerHeight);
penyaji.shadowMap.enabled = true;
kanvas.appendChild(penyaji.domElement);

const kendali = new OrbitControls(kamera, penyaji.domElement);
kendali.target.set(0, 1, -1);
kendali.maxPolarAngle = Math.PI / 2.15;
kendali.minDistance = 8;
kendali.maxDistance = 40;
kendali.enableDamping = true;
kendali.dampingFactor = 0.06;
kendali.autoRotate = true;
kendali.autoRotateSpeed = 0.35;

// ---- lampu
adegan.add(new THREE.HemisphereLight(0x9fb8dd, 0x0d1218, 0.75));
const matahari = new THREE.DirectionalLight(0xffe0b3, 1.15);
matahari.position.set(9, 16, 10);
matahari.castShadow = true;
matahari.shadow.mapSize.set(2048, 2048);
matahari.shadow.camera.left = -18;
matahari.shadow.camera.right = 18;
matahari.shadow.camera.top = 18;
matahari.shadow.camera.bottom = -18;
adegan.add(matahari);
adegan.add(new THREE.PointLight(0xffb020, 14, 26, 2).translateY(6).translateZ(2));

// ---- lantai dan dinding
const lantai = new THREE.Mesh(
  new THREE.BoxGeometry(34, 0.4, 26),
  new THREE.MeshStandardMaterial({ color: 0x141b26, roughness: 0.92 }),
);
lantai.position.y = -0.2;
lantai.receiveShadow = true;
adegan.add(lantai);

const kisi = new THREE.GridHelper(34, 34, 0x1e2a3a, 0x18222e);
kisi.position.y = 0.01;
adegan.add(kisi);

const dindingBahan = new THREE.MeshStandardMaterial({ color: 0x101722, roughness: 1 });
const dindingBelakang = new THREE.Mesh(new THREE.BoxGeometry(34, 9, 0.6), dindingBahan);
dindingBelakang.position.set(0, 4.5, -13);
dindingBelakang.receiveShadow = true;
adegan.add(dindingBelakang);

// ---- meja
const mejaBahan = new THREE.MeshStandardMaterial({ color: 0x2b3a4d, roughness: 0.7 });
const papanBahan = new THREE.MeshStandardMaterial({ color: 0x0e131b, roughness: 0.4, metalness: 0.2 });

function buatMeja(x, z) {
  const grup = new THREE.Group();
  const atas = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 1.3), mejaBahan);
  atas.position.y = 1.05;
  atas.castShadow = true;
  atas.receiveShadow = true;
  grup.add(atas);

  for (const [dx, dz] of [[-1.05, -0.5], [1.05, -0.5], [-1.05, 0.5], [1.05, 0.5]]) {
    const kaki = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.05, 0.12), mejaBahan);
    kaki.position.set(dx, 0.52, dz);
    kaki.castShadow = true;
    grup.add(kaki);
  }

  const layar = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.6, 0.06), papanBahan);
  layar.position.set(0, 1.45, -0.42);
  grup.add(layar);
  const nyala = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 0.52),
    new THREE.MeshBasicMaterial({ color: 0x2f6f8f }),
  );
  nyala.position.set(0, 1.45, -0.38);
  grup.add(nyala);

  grup.position.set(x, 0, z);
  adegan.add(grup);
  return grup;
}

// ---- nama di atas kepala
function papanNama(teks, warna) {
  const lebar = 256, tinggi = 64;
  const c = document.createElement('canvas');
  c.width = lebar;
  c.height = tinggi;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,12,18,0.82)';
  g.roundRect(0, 0, lebar, tinggi, 16);
  g.fill();
  g.fillStyle = warna;
  g.font = 'bold 30px Segoe UI, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(teks, lebar / 2, tinggi / 2 + 1);
  const tekstur = new THREE.CanvasTexture(c);
  tekstur.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tekstur, transparent: true, depthWrite: false }));
  sprite.scale.set(2.3, 0.575, 1);
  return sprite;
}

// ---- karakter
function buatKarakter(nama) {
  const grup = new THREE.Group();

  const badan = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 0.72, 6, 14),
    new THREE.MeshStandardMaterial({ color: WARNA.idle, roughness: 0.55 }),
  );
  badan.position.y = 0.95;
  badan.castShadow = true;
  grup.add(badan);

  const kepala = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 20, 16),
    new THREE.MeshStandardMaterial({ color: 0xf0d6bd, roughness: 0.8 }),
  );
  kepala.position.y = 1.68;
  kepala.castShadow = true;
  grup.add(kepala);

  const label = papanNama(nama, '#ffd8a8');
  label.position.y = 2.35;
  grup.add(label);

  grup.userData.badan = badan;
  adegan.add(grup);
  return grup;
}

// ---- posisi meja dari kolom `meja`
function posisiMeja(meja, urutan) {
  if (RUANG[meja]) return { x: RUANG[meja][0], z: RUANG[meja][2], ruang: true };
  const cocok = /^tetap:(\d+)$/.exec(meja || '');
  const nomor = cocok ? Number(cocok[1]) : urutan + 1;
  const kolom = (nomor - 1) % 4;
  const baris = Math.floor((nomor - 1) / 4) % 3;
  return { x: -6 + kolom * 4, z: -7 + baris * 4.6, ruang: false };
}

const mejaTerpasang = new Set();
const karakter = new Map();
const namaPerMeja = new Map();

// ---- HUD
const barisEl = document.getElementById('baris');
const sumberEl = document.getElementById('sumber');
const jamEl = document.getElementById('jam');

function gambarDaftar(karyawan) {
  barisEl.innerHTML = karyawan.map((k) => {
    const w = '#' + (WARNA[k.state] || WARNA.idle).toString(16).padStart(6, '0');
    const token = k.token_hari_ini ? k.token_hari_ini.toLocaleString('id-ID') : '–';
    return '<div class="baris">'
      + '<span class="titik" style="background:' + w + '"></span>'
      + '<span>' + k.nama + '</span>'
      + '<span class="keadaan">' + (k.state || 'idle') + '</span>'
      + '<span class="token">' + token + '</span>'
      + '</div>';
  }).join('');
}

// ---- data
function terapkan(data, asal) {
  const karyawan = data.karyawan || [];
  sumberEl.textContent = asal;
  jamEl.textContent = (data.sekarang || '').slice(11, 16) || '--:--';

  const dipakai = new Set();

  karyawan.forEach((k, i) => {
    const { x, z } = posisiMeja(k.meja, i);
    const kunci = x + '|' + z;
    dipakai.add(kunci);

    if (!mejaTerpasang.has(kunci)) {
      buatMeja(x, z);
      mejaTerpasang.add(kunci);
    }
    namaPerMeja.set(kunci, k.nama);

    let tok = karakter.get(k.agent_id);
    if (!tok) {
      tok = buatKarakter(k.nama);
      karakter.set(k.agent_id, tok);
    }
    tok.userData.mejaX = x;
    tok.userData.mejaZ = z;
    tok.userData.state = k.state || 'idle';
    tok.userData.fase = i * 0.7;

    const warna = WARNA[k.state] || WARNA.idle;
    tok.userData.badan.material.color.setHex(warna);
    tok.userData.badan.material.emissive = new THREE.Color(warna).multiplyScalar(0.12);
  });

  gambarDaftar(karyawan);
}

async function muat() {
  try {
    const r = await fetch('/api/state', { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    terapkan(await r.json(), 'kantor');
  } catch (e) {
    try {
      const r = await fetch('/data/contoh-state.json');
      terapkan(await r.json(), 'contoh');
    } catch (e2) {
      document.body.insertAdjacentHTML('beforeend',
        '<div class="galat">Tidak bisa membaca /api/state maupun data/contoh-state.json</div>');
    }
  }
}

// ---- animasi
const jam = new THREE.Clock();

function putar() {
  requestAnimationFrame(putar);
  const t = jam.getElapsedTime();

  for (const tok of karakter.values()) {
    const { mejaX, mejaZ, state, fase } = tok.userData;
    const duduk = state === 'sit' || state === 'type' || state === 'review' || state === 'think';
    const sasaranY = duduk ? 0 : Math.sin(t * 1.6 + fase) * 0.05;
    tok.position.set(mejaX, sasaranY, mejaZ + (duduk ? 1.05 : 0.2));
    tok.rotation.y = duduk ? Math.PI : Math.sin(t * 0.6 + fase) * 0.35;

    if (state === 'type') {
      tok.userData.badan.position.y = 0.95 + Math.sin(t * 9 + fase) * 0.03;
    } else if (state === 'error') {
      tok.rotation.z = Math.sin(t * 12 + fase) * 0.05;
    } else {
      tok.userData.badan.position.y = 0.95;
      tok.rotation.z = 0;
    }
  }

  kendali.update();
  penyaji.render(adegan, kamera);
}

addEventListener('resize', () => {
  kamera.aspect = innerWidth / innerHeight;
  kamera.updateProjectionMatrix();
  penyaji.setSize(innerWidth, innerHeight);
});

muat();
setInterval(muat, 2000);
putar();
