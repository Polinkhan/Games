// Daylight Arena generation and environment builder
// Sunlit tarmac yard: gradient sky dome, drifting clouds, shipping-container cover,
// observation towers, jump pads and a raised centre dais.

class Arena {
  constructor(scene) {
    this.scene = scene;
    this.colliders = []; // Meshes that block shots
    this.jumpPads = [];  // Jump pad trigger positions
    this.solids = [];    // Movement blockers: {type:'box'|'circle', ..., bottom, top}
    this.clouds = [];
    this.size = 74;      // 74x74 meters arena

    this.init();
  }

  init() {
    this.createLighting();
    this.createSky();
    this.createFloor();
    this.createPerimeter();
    this.createObstacles();
    this.createCenterPlatform();
  }

  createLighting() {
    // Hemisphere light: sky blue from above, warm concrete bounce from below
    const hemi = new THREE.HemisphereLight(0xbfdcff, 0xa89f8c, 0.35);
    hemi.position.set(0, 50, 0);
    this.scene.add(hemi);

    // Warm, crisp sunlight
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.9);
    sun.position.set(38, 55, 28);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 4096;
    sun.shadow.mapSize.height = 4096;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 140;
    const d = 48;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);

    // Soft cool fill from the opposite side
    const fill = new THREE.DirectionalLight(0xb0d4f1, 0.4);
    fill.position.set(-35, 30, -25);
    this.scene.add(fill);
  }

  createSky() {
    // Gradient sky dome (horizon haze → deep zenith blue)
    const skyGeo = new THREE.SphereGeometry(420, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x2f7fd6) },
        horizonColor: { value: new THREE.Color(0xd8ecfa) },
        bottomColor: { value: new THREE.Color(0xe9e4d8) }
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 bottomColor;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 col = h > 0.0
            ? mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.55))
            : mix(horizonColor, bottomColor, clamp(-h * 4.0, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -1;
    this.scene.add(sky);
    this.skyMesh = sky; // also used to build the image-based lighting environment

    // Sun disk with soft corona
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(6, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfffbea, fog: false })
    );
    sunMesh.position.set(150, 220, 110);
    this.scene.add(sunMesh);

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(6.2, 18, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff1d0, side: THREE.DoubleSide, transparent: true, opacity: 0.3, fog: false })
    );
    glow.position.copy(sunMesh.position);
    glow.lookAt(0, 0, 0);
    this.scene.add(glow);

    // Fluffy low-poly clouds
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      emissive: 0x9fb4c8,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.92,
      flatShading: true,
      fog: false
    });
    for (let i = 0; i < 16; i++) {
      const cloudGroup = new THREE.Group();
      const puffCount = 5 + Math.floor(Math.random() * 4);
      for (let j = 0; j < puffCount; j++) {
        const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(5 + Math.random() * 4, 1), cloudMat);
        puff.position.set(
          (j - puffCount / 2) * 5 + (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 2.5,
          (Math.random() - 0.5) * 4
        );
        puff.scale.y = 0.7;
        cloudGroup.add(puff);
      }
      cloudGroup.position.set(
        (Math.random() - 0.5) * 260,
        55 + Math.random() * 25,
        (Math.random() - 0.5) * 260
      );
      this.scene.add(cloudGroup);
      this.clouds.push({ group: cloudGroup, speed: 1.5 + Math.random() * 2.0 });
    }
  }

  // Procedural concrete texture: speckle noise + expansion joints
  createConcreteTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#8f928b';
    ctx.fillRect(0, 0, 512, 512);
    const img = ctx.getImageData(0, 0, 512, 512);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 26;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    // Large soft stains
    for (let i = 0; i < 18; i++) {
      const x = Math.random() * 512, y = Math.random() * 512, r = 30 + Math.random() * 90;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = Math.random() > 0.5;
      g.addColorStop(0, dark ? 'rgba(60,60,55,0.12)' : 'rgba(255,255,250,0.08)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Panel joints
    ctx.strokeStyle = 'rgba(55,55,50,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, 509, 509);
    ctx.strokeStyle = 'rgba(55,55,50,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(256, 0); ctx.lineTo(256, 512);
    ctx.moveTo(0, 256); ctx.lineTo(512, 256);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(this.size / 8, this.size / 8);
    tex.anisotropy = 8;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  createFloor() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(this.size, this.size),
      new THREE.MeshStandardMaterial({ map: this.createConcreteTexture(), roughness: 0.88, metalness: 0.02 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Painted yellow safety lanes
    const laneMat = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.7 });
    const laneLen = this.size - 8;
    [[0, -9], [0, 9]].forEach(([x, z]) => {
      const lane = new THREE.Mesh(new THREE.PlaneGeometry(laneLen, 0.25), laneMat);
      lane.rotation.x = -Math.PI / 2;
      lane.position.set(x, 0.015, z);
      lane.receiveShadow = true;
      this.scene.add(lane);
      const laneV = lane.clone();
      laneV.rotation.z = Math.PI / 2;
      laneV.position.set(z, 0.016, x);
      this.scene.add(laneV);
    });

    // Central tactical battle circle
    const circle = new THREE.Mesh(
      new THREE.RingGeometry(8, 8.4, 64),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.6, side: THREE.DoubleSide })
    );
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.02;
    circle.receiveShadow = true;
    this.scene.add(circle);
  }

  createPerimeter() {
    const wallHeight = 6.5;
    const halfSize = this.size / 2;
    const wallThickness = 1.6;

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a919a, roughness: 0.8, metalness: 0.05 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.5, metalness: 0.5 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 });

    const wallsData = [
      { size: [this.size, wallHeight, wallThickness], pos: [0, wallHeight / 2, -halfSize] },
      { size: [this.size, wallHeight, wallThickness], pos: [0, wallHeight / 2, halfSize] },
      { size: [wallThickness, wallHeight, this.size], pos: [-halfSize, wallHeight / 2, 0] },
      { size: [wallThickness, wallHeight, this.size], pos: [halfSize, wallHeight / 2, 0] }
    ];

    wallsData.forEach(w => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(...w.size), wallMat);
      wall.position.set(...w.pos);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);
      this.colliders.push(wall);

      const along = w.size[0] === wallThickness ? 'z' : 'x';
      const len = this.size;

      // Top cap
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(along === 'x' ? len : 1.8, 0.3, along === 'z' ? len : 1.8),
        capMat
      );
      cap.position.set(w.pos[0], wallHeight + 0.15, w.pos[2]);
      cap.castShadow = true;
      this.scene.add(cap);

      // Painted stripe
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(along === 'x' ? len : 1.65, 0.25, along === 'z' ? len : 1.65),
        accentMat
      );
      stripe.position.set(w.pos[0], wallHeight * 0.6, w.pos[2]);
      this.scene.add(stripe);

      // Vertical support pilasters every 6m
      for (let t = -halfSize + 3; t <= halfSize - 3; t += 6) {
        const pil = new THREE.Mesh(new THREE.BoxGeometry(0.5, wallHeight, 0.5), capMat);
        const inward = 0.9;
        if (along === 'x') pil.position.set(t, wallHeight / 2, w.pos[2] - Math.sign(w.pos[2]) * inward);
        else pil.position.set(w.pos[0] - Math.sign(w.pos[0]) * inward, wallHeight / 2, t);
        pil.castShadow = true;
        pil.receiveShadow = true;
        this.scene.add(pil);
      }
    });
  }

  createObstacles() {
    const containerColors = [0xb91c1c, 0x0369a1, 0x15803d, 0xb45309];
    const crateConfigs = [
      // Quadrant 1
      { x: 14, z: 14, w: 3.2, h: 2.6, d: 5.5, color: containerColors[0] },
      { x: 18, z: 10, w: 2.2, h: 1.6, d: 2.2, color: 0x475569 },
      { x: 24, z: 18, w: 4.5, h: 3.0, d: 2.5, color: containerColors[1] },
      // Quadrant 2
      { x: -14, z: 14, w: 3.2, h: 2.6, d: 5.5, color: containerColors[1] },
      { x: -18, z: 16, w: 2.2, h: 1.6, d: 4.0, color: 0x475569 },
      { x: -22, z: 10, w: 3.0, h: 3.2, d: 2.5, color: containerColors[2] },
      // Quadrant 3
      { x: -16, z: -16, w: 3.2, h: 2.6, d: 5.5, color: containerColors[3] },
      { x: -10, z: -20, w: 2.2, h: 1.6, d: 2.2, color: 0x475569 },
      { x: -24, z: -14, w: 4.5, h: 3.0, d: 2.5, color: containerColors[0] },
      // Quadrant 4
      { x: 16, z: -16, w: 3.2, h: 2.6, d: 5.5, color: containerColors[2] },
      { x: 20, z: -12, w: 2.2, h: 1.6, d: 4.0, color: 0x475569 },
      { x: 22, z: -22, w: 3.0, h: 3.2, d: 2.5, color: containerColors[3] }
    ];

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5, metalness: 0.6 });

    crateConfigs.forEach(c => {
      const mat = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.55, metalness: 0.35 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d), mat);
      mesh.position.set(c.x, c.h / 2, c.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.colliders.push(mesh);
      this.solids.push({
        type: 'box',
        minX: c.x - c.w / 2, maxX: c.x + c.w / 2,
        minZ: c.z - c.d / 2, maxZ: c.z + c.d / 2,
        bottom: 0, top: c.h
      });

      // Corrugation ribs along the long side
      const longX = c.w >= c.d;
      const ribCount = Math.floor((longX ? c.w : c.d) / 0.45);
      const ribMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(c.color).multiplyScalar(0.8),
        roughness: 0.6,
        metalness: 0.35
      });
      for (let i = 1; i < ribCount; i++) {
        const t = -((longX ? c.w : c.d) / 2) + i * 0.45;
        const rib = new THREE.Mesh(
          new THREE.BoxGeometry(longX ? 0.08 : c.w + 0.06, c.h - 0.3, longX ? c.d + 0.06 : 0.08),
          ribMat
        );
        rib.position.set(c.x + (longX ? t : 0), c.h / 2, c.z + (longX ? 0 : t));
        rib.castShadow = true;
        rib.receiveShadow = true;
        this.scene.add(rib);
      }

      // Steel corner frame (top & bottom rails)
      [c.h - 0.08, 0.08].forEach((y) => {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(c.w + 0.1, 0.16, c.d + 0.1), frameMat);
        frame.position.set(c.x, y, c.z);
        frame.castShadow = true;
        frame.receiveShadow = true;
        this.scene.add(frame);
      });
    });

    // 4 corner observation towers
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.7, metalness: 0.2 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.6 });
    [[26, 26], [-26, 26], [-26, -26], [26, -26]].forEach(([px, pz]) => {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 6.5, 24), towerMat);
      pillar.position.set(px, 3.25, pz);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.scene.add(pillar);
      this.colliders.push(pillar);
      this.solids.push({ type: 'circle', x: px, z: pz, r: 2.6, bottom: 0, top: 6.5 });

      const band = new THREE.Mesh(new THREE.CylinderGeometry(2.42, 2.48, 0.35, 24), bandMat);
      band.position.set(px, 3.6, pz);
      this.scene.add(band);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.3, 0.3, 24), frameMat);
      top.position.set(px, 6.6, pz);
      top.castShadow = true;
      this.scene.add(top);
    });

    // Jump pads
    this.createJumpPad(0, 18);
    this.createJumpPad(0, -18);
    this.createJumpPad(18, 0);
    this.createJumpPad(-18, 0);
  }

  createJumpPad(x, z) {
    const padBase = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.8, 0.22, 32),
      new THREE.MeshStandardMaterial({ color: 0x3b4656, roughness: 0.4, metalness: 0.6 })
    );
    padBase.position.set(x, 0.11, z);
    padBase.receiveShadow = true;
    padBase.castShadow = true;
    this.scene.add(padBase);

    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 0.24, 32),
      new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 0.6, roughness: 0.3 })
    );
    core.position.set(x, 0.13, z);
    this.scene.add(core);

    this.jumpPads.push({ x, z, radius: 1.6, power: 19 });
  }

  createCenterPlatform() {
    const plat = new THREE.Mesh(
      new THREE.CylinderGeometry(6.2, 6.8, 1.6, 48),
      new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.6, metalness: 0.3 })
    );
    plat.position.set(0, 0.8, 0);
    plat.castShadow = true;
    plat.receiveShadow = true;
    this.scene.add(plat);
    this.colliders.push(plat);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(6.2, 0.14, 10, 64),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.25, metalness: 0.7 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 1.6, 0);
    this.scene.add(rim);

    // Centre beacon
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 3.2, 24),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.15, metalness: 0.85 })
    );
    core.position.set(0, 3.2, 0);
    core.castShadow = true;
    this.scene.add(core);
    this.colliders.push(core);
    this.solids.push({ type: 'circle', x: 0, z: 0, r: 0.7, bottom: 1.6, top: 4.8 });
    this.energyCore = core;
  }

  update(delta) {
    if (this.energyCore) this.energyCore.rotation.y += delta * 1.2;
    for (const cloud of this.clouds) {
      cloud.group.position.x += cloud.speed * delta;
      if (cloud.group.position.x > 140) cloud.group.position.x = -140;
    }
  }
}
