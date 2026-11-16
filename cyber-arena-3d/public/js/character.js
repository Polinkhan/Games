// High-detail procedural tactical operative
// Jointed rig (hips → spine → chest → neck → head, two-bone arms & legs), arm IK that keeps
// both hands on the rifle, and procedural walk/run/jump/aim/death animation.
// The model's origin is at the feet and it faces -Z (same as an unrotated camera).

const CHAR_DOWN = new THREE.Vector3(0, -1, 0);

// Smooth capsule hanging from y=0 down to y=-len (top radius r1, bottom radius r2)
function capsuleGeometry(r1, r2, len, radial = 14) {
  const pts = [];
  const seg = 6;
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r2 * Math.cos(a) + 1e-4, -len + r2 * Math.sin(a)));
  }
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r1 * Math.cos(a) + 1e-4, r1 * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts, radial);
}

// Box with softly bevelled edges, centred on the origin
function roundedBoxGeometry(w, h, d, r = 0.02) {
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const shape = new THREE.Shape();
  const x = -w / 2 + r, y = -h / 2 + r, iw = w - 2 * r, ih = h - 2 * r;
  shape.moveTo(x, y);
  shape.lineTo(x + iw, y);
  shape.lineTo(x + iw, y + ih);
  shape.lineTo(x, y + ih);
  shape.lineTo(x, y);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(d - 2 * r, 1e-3),
    bevelEnabled: true,
    bevelSize: r,
    bevelThickness: r,
    bevelSegments: 3,
    curveSegments: 4
  });
  geo.center();
  return geo;
}

class CharacterModel {
  constructor(accentColor = '#00bfff') {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    this.hitMeshes = [];
    this.materials = [];

    // Animation state
    this.time = Math.random() * 10;
    this.walkPhase = 0;
    this.moveBlend = 0;
    this.airBlend = 0;
    this.hipYaw = 0;
    this.recoil = 0;
    this.flash = 0;
    this.deathT = -1;
    this.flashTimer = null;

    this.createMaterials(new THREE.Color(accentColor));
    this.build();

    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  // ---------- Materials ----------
  createMaterials(accent) {
    accent = accent.clone().convertSRGBToLinear();
    const std = (params) => {
      const m = new THREE.MeshStandardMaterial(params);
      // Authoring colours are sRGB; renderer outputs sRGB, so lighting needs linear values
      if (params.color !== accent) m.color.convertSRGBToLinear();
      m.userData.linear = true;
      m.userData.baseEmissive = m.emissive.clone();
      this.materials.push(m);
      return m;
    };
    this.mat = {
      uniform: std({ color: 0x4a5240, roughness: 0.92, metalness: 0.0 }),   // olive combat fabric
      uniformDark: std({ color: 0x353b2f, roughness: 0.95, metalness: 0.0 }),
      vest: std({ color: 0x2f3329, roughness: 0.85, metalness: 0.05 }),     // plate carrier
      webbing: std({ color: 0x23261f, roughness: 0.9, metalness: 0.0 }),
      armor: std({ color: 0x3d4436, roughness: 0.55, metalness: 0.2 }),     // knee/elbow pads, helmet
      glove: std({ color: 0x1b1c1e, roughness: 0.7, metalness: 0.05 }),
      boot: std({ color: 0x3b2f24, roughness: 0.8, metalness: 0.05 }),
      sole: std({ color: 0x151515, roughness: 0.95, metalness: 0.0 }),
      skin: std({ color: 0xc69276, roughness: 0.75, metalness: 0.0 }),
      mask: std({ color: 0x1f2320, roughness: 0.9, metalness: 0.0 }),
      gunMetal: std({ color: 0x2a2d31, roughness: 0.35, metalness: 0.85 }),
      gunPolymer: std({ color: 0x1c1e20, roughness: 0.6, metalness: 0.2 }),
      accent: std({ color: accent, roughness: 0.5, metalness: 0.1, emissive: accent, emissiveIntensity: 0.25 }),
      glass: std({ color: 0x111111, roughness: 0.08, metalness: 0.95, emissive: accent, emissiveIntensity: 0.55 })
    };
    this.mat.accent.userData.baseEmissive = accent.clone();
    this.mat.glass.userData.baseEmissive = accent.clone();
  }

  setAccent(colorStr) {
    const c = new THREE.Color(colorStr).convertSRGBToLinear();
    this.mat.accent.color.copy(c);
    this.mat.accent.emissive.copy(c);
    this.mat.accent.userData.baseEmissive = c.clone();
    this.mat.glass.emissive.copy(c);
    this.mat.glass.userData.baseEmissive = c.clone();
    if (this.muzzleLight) this.muzzleLight.color.copy(c);
  }

  // ---------- Construction helpers ----------
  add(parent, geo, mat, x = 0, y = 0, z = 0, hittable = true) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    if (hittable) this.hitMeshes.push(m);
    return m;
  }

  group(parent, x = 0, y = 0, z = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  build() {
    const M = this.mat;

    // ---- Hips ----
    this.hips = this.group(this.body, 0, 0.96, 0);
    this.hipsBaseY = 0.96;
    this.add(this.hips, roundedBoxGeometry(0.33, 0.17, 0.21, 0.05), M.uniform, 0, 0, 0);
    // Belt with buckle & utility pouches
    this.add(this.hips, roundedBoxGeometry(0.35, 0.055, 0.23, 0.02), M.webbing, 0, 0.065, 0);
    this.add(this.hips, roundedBoxGeometry(0.06, 0.045, 0.02, 0.008), M.gunMetal, 0, 0.065, -0.12);
    this.add(this.hips, roundedBoxGeometry(0.07, 0.09, 0.06, 0.015), M.vest, 0.17, 0.02, 0.03);
    this.add(this.hips, roundedBoxGeometry(0.07, 0.09, 0.06, 0.015), M.vest, -0.17, 0.02, 0.03);
    this.add(this.hips, roundedBoxGeometry(0.1, 0.08, 0.05, 0.015), M.vest, 0, 0.03, 0.13);

    // ---- Legs ----
    this.legL = this.buildLeg(-0.1);
    this.legR = this.buildLeg(0.1);
    // Thigh holster on the right leg
    this.add(this.legR.thigh, roundedBoxGeometry(0.06, 0.16, 0.12, 0.02), M.webbing, 0.08, -0.17, 0);
    this.add(this.legR.thigh, roundedBoxGeometry(0.035, 0.07, 0.1, 0.01), M.gunPolymer, 0.1, -0.1, 0);

    // ---- Spine & chest ----
    this.spine = this.group(this.hips, 0, 0.08, 0);
    this.add(this.spine, capsuleGeometry(0.13, 0.15, 0.06, 16), M.uniform, 0, 0.14, 0).scale.set(1.1, 1, 0.75);

    this.chest = this.group(this.spine, 0, 0.2, 0);
    // Shirt torso
    this.add(this.chest, roundedBoxGeometry(0.38, 0.33, 0.22, 0.08), M.uniform, 0, 0.12, 0);
    // Plate carrier front & back
    this.add(this.chest, roundedBoxGeometry(0.34, 0.31, 0.07, 0.025), M.vest, 0, 0.12, -0.115);
    this.add(this.chest, roundedBoxGeometry(0.34, 0.33, 0.07, 0.025), M.vest, 0, 0.13, 0.115);
    // Cummerbund side panels
    this.add(this.chest, roundedBoxGeometry(0.05, 0.16, 0.2, 0.015), M.vest, 0.19, 0.04, 0);
    this.add(this.chest, roundedBoxGeometry(0.05, 0.16, 0.2, 0.015), M.vest, -0.19, 0.04, 0);
    // Shoulder straps
    this.add(this.chest, roundedBoxGeometry(0.07, 0.04, 0.3, 0.012), M.webbing, 0.11, 0.285, 0);
    this.add(this.chest, roundedBoxGeometry(0.07, 0.04, 0.3, 0.012), M.webbing, -0.11, 0.285, 0);
    // Triple magazine pouches
    for (let i = -1; i <= 1; i++) {
      this.add(this.chest, roundedBoxGeometry(0.085, 0.11, 0.05, 0.012), M.webbing, i * 0.095, 0.03, -0.165);
      this.add(this.chest, roundedBoxGeometry(0.087, 0.03, 0.052, 0.008), M.vest, i * 0.095, 0.085, -0.166);
    }
    // Admin pouch + team ID patch
    this.add(this.chest, roundedBoxGeometry(0.16, 0.08, 0.035, 0.01), M.webbing, 0, 0.19, -0.165);
    this.add(this.chest, roundedBoxGeometry(0.1, 0.035, 0.01, 0.004), M.accent, 0, 0.2, -0.186);
    // Radio on the left side with antenna
    this.add(this.chest, roundedBoxGeometry(0.06, 0.12, 0.05, 0.012), M.gunPolymer, -0.15, 0.17, -0.15);

    // Backpack / hydration carrier
    this.add(this.chest, roundedBoxGeometry(0.29, 0.34, 0.13, 0.04), M.uniformDark, 0, 0.12, 0.2);
    this.add(this.chest, roundedBoxGeometry(0.24, 0.12, 0.05, 0.02), M.vest, 0, 0.04, 0.275);
    this.add(this.chest, roundedBoxGeometry(0.08, 0.02, 0.01, 0.004), M.accent, 0, 0.24, 0.27);
    const antenna = this.add(this.chest, new THREE.CylinderGeometry(0.005, 0.008, 0.42, 6), M.gunPolymer, -0.1, 0.5, 0.23, false);
    antenna.rotation.z = 0.12;

    // ---- Neck & head ----
    this.neck = this.group(this.chest, 0, 0.3, 0);
    this.add(this.neck, new THREE.CylinderGeometry(0.052, 0.06, 0.1, 14), M.mask, 0, 0.03, 0);
    this.head = this.group(this.neck, 0, 0.13, 0);
    this.buildHead();

    // ---- Rifle (held in chest space so it follows aim pitch) ----
    this.rifle = this.group(this.chest, 0.08, 0.15, -0.1);
    this.rifleBase = this.rifle.position.clone();
    this.buildRifle();

    // ---- Arms (solved with IK each frame) ----
    this.armL = this.buildArm(-1);
    this.armR = this.buildArm(1);
    this.gripR = new THREE.Vector3(0, -0.075, -0.1);   // pistol grip (rifle space)
    this.gripL = new THREE.Vector3(0, -0.035, -0.36);  // handguard (rifle space)
  }

  buildLeg(side) {
    const M = this.mat;
    const thigh = this.group(this.hips, side, -0.04, 0);
    this.add(thigh, capsuleGeometry(0.088, 0.068, 0.42), M.uniform, 0, 0, 0);
    // Cargo pocket on the outside of the thigh
    this.add(thigh, roundedBoxGeometry(0.03, 0.12, 0.11, 0.012), M.uniformDark, side > 0 ? 0.075 : -0.075, -0.22, 0);

    const knee = this.group(thigh, 0, -0.43, 0);
    this.add(knee, roundedBoxGeometry(0.11, 0.12, 0.06, 0.025), M.armor, 0, 0.0, -0.06);
    this.add(knee, capsuleGeometry(0.066, 0.05, 0.38), M.uniform, 0, 0, 0);

    const ankle = this.group(knee, 0, -0.42, 0);
    this.add(ankle, roundedBoxGeometry(0.12, 0.13, 0.14, 0.035), M.boot, 0, 0.02, 0.0);
    this.add(ankle, roundedBoxGeometry(0.115, 0.08, 0.27, 0.035), M.boot, 0, -0.025, -0.05);
    this.add(ankle, roundedBoxGeometry(0.125, 0.03, 0.285, 0.01), M.sole, 0, -0.07, -0.05);

    return { thigh, knee, ankle };
  }

  buildArm(side) {
    const M = this.mat;
    const upperLen = 0.3;
    const foreLen = 0.28;
    const shoulder = this.group(this.chest, side * 0.215, 0.245, 0);
    // Deltoid / shoulder pad with team patch
    this.add(shoulder, new THREE.SphereGeometry(0.078, 16, 12), M.uniform, 0, -0.01, 0);
    this.add(shoulder, capsuleGeometry(0.068, 0.055, upperLen), M.uniform, 0, 0, 0);
    const patch = this.add(shoulder, roundedBoxGeometry(0.012, 0.07, 0.06, 0.004), M.accent, side * 0.068, -0.09, 0);
    patch.rotation.z = side * 0.1;

    const elbow = this.group(shoulder, 0, -upperLen, 0);
    this.add(elbow, new THREE.SphereGeometry(0.058, 12, 10), M.armor, 0, 0, 0.012);
    this.add(elbow, capsuleGeometry(0.056, 0.045, foreLen), M.uniform, 0, 0, 0);
    // Rolled sleeve cuff
    this.add(elbow, new THREE.CylinderGeometry(0.05, 0.05, 0.04, 14), M.uniformDark, 0, -foreLen + 0.04, 0);

    const hand = this.group(elbow, 0, -foreLen, 0);
    this.add(hand, roundedBoxGeometry(0.075, 0.1, 0.09, 0.03), M.glove, 0, -0.045, 0);
    this.add(hand, roundedBoxGeometry(0.03, 0.06, 0.035, 0.012), M.glove, side * -0.04, -0.03, -0.03);

    return { shoulder, elbow, hand, upperLen, foreLen, side };
  }

  buildHead() {
    const M = this.mat;
    const h = this.head;
    // Head under balaclava
    this.add(h, new THREE.SphereGeometry(0.105, 24, 18), M.mask, 0, 0, 0).scale.set(0.95, 1.12, 1.02);
    // Exposed skin around the eyes
    this.add(h, roundedBoxGeometry(0.15, 0.05, 0.04, 0.015), M.skin, 0, 0.012, -0.085);
    // Ballistic goggles (team-tinted glass) + strap
    this.add(h, roundedBoxGeometry(0.175, 0.055, 0.04, 0.02), M.glass, 0, 0.015, -0.105);
    this.add(h, new THREE.TorusGeometry(0.112, 0.008, 6, 28), M.webbing, 0, 0.015, 0).rotation.x = Math.PI / 2;
    // Shemagh / face mask lower half
    this.add(h, roundedBoxGeometry(0.17, 0.08, 0.08, 0.03), M.uniformDark, 0, -0.06, -0.065);

    // Ballistic helmet dome
    const helmet = this.add(
      h,
      new THREE.SphereGeometry(0.135, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.55),
      M.armor, 0, 0.025, 0.008
    );
    helmet.scale.set(1.0, 0.95, 1.1);
    // Helmet brim / cut line
    this.add(h, new THREE.TorusGeometry(0.128, 0.011, 8, 32), M.armor, 0, 0.0, 0.01).rotation.x = Math.PI / 2;
    // Side rails, hearing protection and NVG shroud
    this.add(h, roundedBoxGeometry(0.02, 0.03, 0.13, 0.006), M.gunPolymer, 0.13, 0.03, 0);
    this.add(h, roundedBoxGeometry(0.02, 0.03, 0.13, 0.006), M.gunPolymer, -0.13, 0.03, 0);
    for (const s of [-1, 1]) {
      const cup = this.add(h, new THREE.CylinderGeometry(0.048, 0.048, 0.04, 18), M.gunPolymer, s * 0.12, -0.02, 0.01);
      cup.rotation.z = Math.PI / 2;
    }
    this.add(h, roundedBoxGeometry(0.05, 0.035, 0.03, 0.008), M.gunMetal, 0, 0.1, -0.128);
    // Helmet strobe / IFF marker in team colour
    this.add(h, roundedBoxGeometry(0.03, 0.02, 0.03, 0.006), M.accent, 0, 0.145, 0.06);
    // Velcro patch on helmet top
    this.add(h, roundedBoxGeometry(0.07, 0.008, 0.05, 0.003), M.accent, 0, 0.152, -0.02).rotation.x = -0.25;
  }

  buildRifle() {
    const M = this.mat;
    const r = this.rifle;
    // Receiver
    this.add(r, roundedBoxGeometry(0.055, 0.085, 0.3, 0.012), M.gunMetal, 0, 0, -0.16);
    // Top rail
    this.add(r, roundedBoxGeometry(0.035, 0.018, 0.42, 0.004), M.gunPolymer, 0, 0.05, -0.24);
    // Stock (into the shoulder)
    this.add(r, roundedBoxGeometry(0.045, 0.075, 0.2, 0.015), M.gunPolymer, 0, -0.01, 0.07);
    this.add(r, roundedBoxGeometry(0.05, 0.1, 0.03, 0.01), M.sole, 0, -0.015, 0.17);
    // Pistol grip
    const grip = this.add(r, roundedBoxGeometry(0.035, 0.095, 0.045, 0.012), M.gunPolymer, 0, -0.08, -0.08);
    grip.rotation.x = 0.3;
    // Magazine
    const mag = this.add(r, roundedBoxGeometry(0.038, 0.14, 0.065, 0.01), M.gunPolymer, 0, -0.1, -0.2);
    mag.rotation.x = -0.18;
    // Handguard + barrel + muzzle brake
    const hg = this.add(r, new THREE.CylinderGeometry(0.03, 0.03, 0.26, 14), M.gunPolymer, 0, 0.005, -0.44);
    hg.rotation.x = Math.PI / 2;
    const barrel = this.add(r, new THREE.CylinderGeometry(0.012, 0.012, 0.18, 10), M.gunMetal, 0, 0.005, -0.65);
    barrel.rotation.x = Math.PI / 2;
    const brake = this.add(r, new THREE.CylinderGeometry(0.019, 0.019, 0.06, 10), M.gunMetal, 0, 0.005, -0.75);
    brake.rotation.x = Math.PI / 2;
    // Vertical foregrip
    this.add(r, roundedBoxGeometry(0.025, 0.07, 0.03, 0.01), M.gunPolymer, 0, -0.06, -0.4);
    // Optic with glowing lens
    const scope = this.add(r, new THREE.CylinderGeometry(0.026, 0.026, 0.15, 16), M.gunMetal, 0, 0.09, -0.2);
    scope.rotation.x = Math.PI / 2;
    const lens = this.add(r, new THREE.CircleGeometry(0.022, 16), M.glass, 0, 0.09, -0.276, false);
    lens.rotation.y = Math.PI;
    this.add(r, roundedBoxGeometry(0.02, 0.03, 0.05, 0.005), M.gunMetal, 0, 0.065, -0.2);
    // Side flashlight in team colour
    const torch = this.add(r, new THREE.CylinderGeometry(0.014, 0.014, 0.08, 10), M.accent, 0.035, 0.0, -0.5);
    torch.rotation.x = Math.PI / 2;

    // Muzzle flash (hidden until fired)
    this.muzzlePoint = new THREE.Vector3(0, 0.005, -0.8);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.9 });
    flashMat.userData.linear = true;
    this.muzzleFlash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), flashMat);
    this.muzzleFlash.scale.set(1, 1, 2.2);
    this.muzzleFlash.position.copy(this.muzzlePoint).add(new THREE.Vector3(0, 0, -0.06));
    this.muzzleFlash.visible = false;
    r.add(this.muzzleFlash);
    this.muzzleLight = new THREE.PointLight(0xffd27a, 0, 7);
    this.muzzleLight.position.copy(this.muzzlePoint);
    r.add(this.muzzleLight);
  }

  // ---------- Runtime API ----------
  getMuzzleWorldPosition(target = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    return this.rifle.localToWorld(target.copy(this.muzzlePoint));
  }

  fire() {
    this.recoil = 1;
    this.muzzleFlash.visible = true;
    this.muzzleFlash.rotation.z = Math.random() * Math.PI;
    this.muzzleLight.intensity = 2.5;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.muzzleFlash.visible = false;
      this.muzzleLight.intensity = 0;
    }, 50);
  }

  hitFlash() {
    this.flash = 1;
  }

  die() {
    if (this.deathT < 0) this.deathT = 0;
  }

  revive() {
    this.deathT = -1;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
  }

  get isDead() {
    return this.deathT >= 0;
  }

  setVisible(v) {
    this.root.visible = v;
  }

  // state: { forward, strafe (m/s in the model's local frame), grounded, pitch }
  update(dt, state) {
    this.time += dt;
    const forward = state.forward || 0;
    const strafe = state.strafe || 0;
    const speed = Math.hypot(forward, strafe);
    const pitch = state.pitch || 0;
    const lerpK = (k) => 1 - Math.exp(-k * dt);

    // Blend factors
    const targetMove = Math.min(speed / 9, 1.35);
    this.moveBlend += (targetMove - this.moveBlend) * lerpK(10);
    this.airBlend += ((state.grounded ? 0 : 1) - this.airBlend) * lerpK(12);

    // Advance gait phase (reverse when back-pedalling)
    const dir = forward < -0.5 && Math.abs(forward) > Math.abs(strafe) * 0.5 ? -1 : 1;
    this.walkPhase += dt * Math.min(speed, 18) * 1.5 * dir;

    const amp = 0.62 * this.moveBlend * (1 - this.airBlend);
    const p = this.walkPhase;

    // Hips point toward the movement direction when strafing; chest stays on target
    let targetYaw = 0;
    if (speed > 1) {
      targetYaw = -Math.atan2(strafe, Math.abs(forward) + 0.001) * 0.65 * dir;
      targetYaw = Math.max(-0.75, Math.min(0.75, targetYaw));
    }
    this.hipYaw += (targetYaw - this.hipYaw) * lerpK(8);

    // Legs: swing + knee bend on the forward swing
    const legPose = (leg, ph) => {
      const swing = Math.sin(ph) * amp;
      const lift = Math.max(0, Math.cos(ph) * dir) * amp * 1.6;
      leg.thigh.rotation.x = swing + this.airBlend * 0.55;
      leg.knee.rotation.x = -(lift + 0.06) - this.airBlend * 0.9;
      leg.ankle.rotation.x = -leg.thigh.rotation.x - leg.knee.rotation.x * 0.6;
    };
    legPose(this.legL, p);
    legPose(this.legR, p + Math.PI);
    this.legR.thigh.rotation.x -= this.airBlend * 0.45; // staggered legs in the air
    this.legL.thigh.rotation.z = -0.03;
    this.legR.thigh.rotation.z = 0.03;

    // Hips bob, sway and yaw
    const breathe = Math.sin(this.time * 1.8) * 0.006 * (1 - this.moveBlend);
    this.hips.position.y = this.hipsBaseY
      - Math.abs(Math.cos(p)) * 0.035 * this.moveBlend * (1 - this.airBlend)
      - 0.02 * this.moveBlend
      + breathe;
    this.hips.rotation.y = this.hipYaw;
    this.hips.rotation.z = Math.sin(p) * 0.04 * this.moveBlend;

    // Spine: forward lean with speed, split aim pitch between spine and chest
    this.spine.rotation.y = -this.hipYaw;
    this.spine.rotation.x = -0.1 * this.moveBlend + pitch * 0.35;
    this.spine.rotation.z = -this.hips.rotation.z;
    this.chest.rotation.x = pitch * 0.45 + Math.sin(this.time * 1.8) * 0.01;
    this.chest.rotation.y = Math.sin(p) * 0.05 * this.moveBlend;
    this.neck.rotation.x = pitch * 0.2 + 0.1 * this.moveBlend;
    this.head.rotation.y = -this.chest.rotation.y;

    // Rifle recoil & running sway
    this.recoil += (0 - this.recoil) * lerpK(16);
    this.rifle.position.set(
      this.rifleBase.x + Math.cos(p) * 0.008 * this.moveBlend,
      this.rifleBase.y + Math.abs(Math.sin(p)) * 0.01 * this.moveBlend,
      this.rifleBase.z + this.recoil * 0.05
    );
    this.rifle.rotation.x = this.recoil * 0.12;

    // Arms: keep both hands on the rifle
    this.solveArm(this.armR, this.gripR, new THREE.Vector3(0.7, -1, 0.3));
    this.solveArm(this.armL, this.gripL, new THREE.Vector3(-0.5, -1, -0.1));

    // Hit flash: tint every standard material red briefly
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 7);
      for (const m of this.materials) {
        m.emissive.copy(m.userData.baseEmissive).lerp(new THREE.Color(0xff2222), this.flash);
        if (this.flash === 0) m.emissive.copy(m.userData.baseEmissive);
      }
    }

    // Death: topple backwards
    if (this.deathT >= 0) {
      this.deathT = Math.min(1, this.deathT + dt * 1.8);
      const e = 1 - Math.pow(1 - this.deathT, 3);
      this.body.rotation.x = e * (Math.PI / 2 - 0.08);
      this.body.position.y = e * 0.14;
      this.body.position.z = e * 0.25;
      this.legL.knee.rotation.x = -0.35 * e;
      this.legR.knee.rotation.x = -0.6 * e;
    }
  }

  // Analytic two-bone IK in chest space
  solveArm(arm, gripLocal, pole) {
    const a = arm.upperLen;
    const b = arm.foreLen + 0.04; // reach to the palm centre
    const S = arm.shoulder.position;
    const target = gripLocal.clone().applyQuaternion(this.rifle.quaternion).add(this.rifle.position);

    const d = target.clone().sub(S);
    let c = d.length();
    c = Math.max(Math.abs(a - b) + 0.01, Math.min(c, (a + b) * 0.999));
    const dn = d.normalize();

    const cosA = (a * a + c * c - b * b) / (2 * a * c);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const n = pole.clone().normalize();
    n.sub(dn.clone().multiplyScalar(n.dot(dn))).normalize();

    const E = S.clone().addScaledVector(dn, a * cosA).addScaledVector(n, a * sinA);
    const T = S.clone().addScaledVector(dn, c);

    arm.shoulder.quaternion.setFromUnitVectors(CHAR_DOWN, E.clone().sub(S).normalize());
    const inv = arm.shoulder.quaternion.clone().invert();
    const foreDir = T.clone().sub(E).normalize().applyQuaternion(inv);
    arm.elbow.quaternion.setFromUnitVectors(CHAR_DOWN, foreDir);
  }
}
