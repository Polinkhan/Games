// Cyber-Arena 3D - Main Game Engine
// Integrates Three.js rendering, physics loop, weapon firing, particles, and HUD

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.blocker = document.getElementById('blocker');
    this.playBtn = document.getElementById('play-button');
    this.nameInput = document.getElementById('player-name-input');
    this.hitmarker = document.getElementById('hitmarker');
    this.damageOverlay = document.getElementById('damage-overlay');
    this.healthBar = document.getElementById('health-bar');
    this.healthVal = document.getElementById('health-val');
    this.scoreVal = document.getElementById('score-val');
    this.deathScreen = document.getElementById('death-screen');
    this.respawnTimer = document.getElementById('respawn-timer');
    this.rejoinBtn = document.getElementById('rejoin-btn');
    this.respawnInterval = null;

    this.isPlaying = false;
    this.isDead = false;
    this.score = 0;
    this.health = 100;

    // Three.js core components
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xd8ecfa);
    this.scene.fog = new THREE.Fog(0xd8ecfa, 70, 260);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 900);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Physically-based output: sRGB + filmic tone mapping for natural daylight
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.physicallyCorrectLights = false;

    // Game modules
    this.arena = new Arena(this.scene);

    // Image-based lighting from the sky dome: soft ambient fill + reflections on metal/armor
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(this.arena.skyMesh.clone());
    this.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    pmrem.dispose();
    this.player = new Player(this.camera, this.scene, this.canvas, this.arena);
    this.network = new NetworkManager(
      this.scene,
      (newScore) => this.onKillAwarded(newScore),
      (newHealth) => this.onLocalPlayerDamaged(newHealth)
    );

    // Convert authored sRGB colours to linear once, so the sRGB output shows them as intended
    this.linearizeColors(this.scene);
    this.scene.fog.color.convertSRGBToLinear();

    // Systems
    this.projectiles = [];
    this.particles = [];
    this.boltGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.8, 8);
    this.sparkGeometry = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    this.effectMaterials = new Map();
    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.isFiring = false;

    this.initEvents();
    this.animate();
  }

  linearizeColors(root) {
    root.traverse((obj) => {
      if (obj.isLight) {
        obj.color.convertSRGBToLinear();
        if (obj.groundColor) obj.groundColor.convertSRGBToLinear();
      }
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      for (const m of mats) {
        if (m.isShaderMaterial || m.userData.linear) continue;
        if (m.color) m.color.convertSRGBToLinear();
        if (m.emissive) m.emissive.convertSRGBToLinear();
        m.userData.linear = true;
      }
    });
  }

  initEvents() {
    // Window resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Play button & Pointer Lock
    this.playBtn.addEventListener('click', () => this.enterGame());
    this.canvas.addEventListener('click', () => {
      if (!this.isPlaying && !this.isDead) {
        this.enterGame();
      }
    });

    if (this.rejoinBtn) {
      this.rejoinBtn.addEventListener('click', () => {
        this.rejoinMatch();
      });
    }

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === this.canvas) {
        this.isPlaying = true;
        this.blocker.style.opacity = '0';
        this.blocker.style.pointerEvents = 'none';
        this.deathScreen.classList.add('hidden');
      } else {
        this.isPlaying = false;
        this.isFiring = false;
        if (!this.isDead) {
          this.blocker.style.opacity = '1';
          this.blocker.style.pointerEvents = 'auto';
        }
      }
    });

    // Firing events
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.isPlaying && !this.isDead) {
        this.isFiring = true;
        this.fireWeapon();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isFiring = false;
      }
    });

    // Callsign name change
    this.nameInput.addEventListener('change', (e) => {
      const name = e.target.value.trim();
      if (name) {
        this.network.sendSetName(name);
      }
    });
  }

  enterGame() {
    window.soundFX.init();
    window.soundFX.resume();

    const name = this.nameInput.value.trim();
    if (name) {
      this.network.sendSetName(name);
    }

    this.canvas.requestPointerLock();
  }

  fireWeapon() {
    if (!this.isPlaying || this.isDead || this.player.isReloading) return;

    const now = performance.now() / 1000;
    if (now - this.player.lastFireTime < this.player.fireInterval) return;

    if (this.player.ammo <= 0) {
      window.soundFX.playEmpty();
      this.player.reload();
      return;
    }

    this.player.lastFireTime = now;
    this.player.ammo--;
    this.player.updateHUD();
    this.player.triggerShootAnimation();
    window.soundFX.playShoot();

    // 1. Aim: ray from the camera through the crosshair, starting past our own character
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const aim = this.castShot(this.camera.position, camDir, this.player.getCameraBoomLength() + 0.3, 150);
    const aimPoint = aim
      ? aim.point.clone()
      : this.camera.position.clone().addScaledVector(camDir, 150);

    // 2. Fire: real projectile path from the rifle muzzle toward the aim point
    const origin = this.player.getMuzzlePosition(new THREE.Vector3());
    const direction = aimPoint.clone().sub(origin);
    if (direction.lengthSq() < 1e-6) direction.copy(camDir);
    direction.normalize();

    this.spawnPlasmaBolt(origin, direction, 0x00e5ff, true);
    this.network.sendShoot(origin, direction);

    // 3. Hit detection along the muzzle path (cover between muzzle and target blocks it)
    const hit = this.castShot(origin, direction, 0, 80);
    if (hit && hit.playerId) {
      this.showHitmarker();
      this.spawnSparks(hit.point, 0xff4d4d);
      this.network.sendHit(hit.playerId);
    } else if (hit) {
      this.spawnSparks(hit.point, 0xffd27a);
    }
  }

  // Nearest hit among living remote players and arena geometry
  castShot(origin, direction, near, far) {
    this.raycaster.set(origin, direction);
    this.raycaster.near = near;
    this.raycaster.far = far;

    let best = null;
    for (const [id, rp] of this.network.remotePlayers) {
      if (!rp.mesh.visible || rp.dead) continue;
      const hits = this.raycaster.intersectObjects(rp.hitMeshes, false);
      if (hits.length > 0 && (!best || hits[0].distance < best.distance)) {
        best = { distance: hits[0].distance, point: hits[0].point, playerId: id };
      }
    }

    const wallHits = this.raycaster.intersectObjects(this.arena.colliders, false);
    if (wallHits.length > 0 && (!best || wallHits[0].distance < best.distance)) {
      best = { distance: wallHits[0].distance, point: wallHits[0].point, playerId: null };
    }
    return best;
  }

  showHitmarker() {
    window.soundFX.playHit();
    this.hitmarker.classList.add('active');
    setTimeout(() => {
      this.hitmarker.classList.remove('active');
    }, 110);
  }

  // Shared geometry/material cache so effects don't allocate GPU resources per shot
  getEffectMaterial(colorHex) {
    if (!this.effectMaterials.has(colorHex)) {
      this.effectMaterials.set(colorHex, new THREE.MeshBasicMaterial({ color: colorHex }));
    }
    return this.effectMaterials.get(colorHex);
  }

  spawnPlasmaBolt(origin, direction, colorHex, isLocal) {
    // Network messages deliver plain {x,y,z} objects — normalize to Vector3
    origin = new THREE.Vector3(origin.x, origin.y, origin.z);
    direction = new THREE.Vector3(direction.x, direction.y, direction.z);
    if (direction.lengthSq() === 0) return;
    direction.normalize();

    const bolt = new THREE.Mesh(this.boltGeometry, this.getEffectMaterial(colorHex));

    // Align bolt with trajectory direction (tail starts at the muzzle)
    bolt.position.copy(origin).addScaledVector(direction, 0.4);
    bolt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);

    this.scene.add(bolt);

    this.projectiles.push({
      mesh: bolt,
      velocity: direction.clone().multiplyScalar(75), // 75 m/s
      spawnTime: performance.now(),
      lifetime: 1.2, // seconds
      isLocal: isLocal
    });
  }

  spawnSparks(pos, colorHex) {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(this.sparkGeometry, this.getEffectMaterial(colorHex));
      p.position.copy(pos);

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.2) * 8,
        (Math.random() - 0.5) * 8
      );

      this.scene.add(p);
      this.particles.push({
        mesh: p,
        velocity: vel,
        life: 0.35 + Math.random() * 0.2
      });
    }
  }

  onLocalPlayerDamaged(newHealth) {
    if (this.isDead) return;
    this.health = newHealth;
    this.healthVal.innerText = Math.max(0, this.health);
    this.healthBar.style.width = `${Math.max(0, this.health)}%`;

    window.soundFX.playDamage();
    this.player.model.hitFlash();
    this.damageOverlay.classList.add('active');
    setTimeout(() => {
      this.damageOverlay.classList.remove('active');
    }, 160);

    if (this.health <= 0) {
      this.killLocalPlayer();
    }
  }

  killLocalPlayer() {
    this.isDead = true;
    this.isFiring = false;
    this.player.model.die();
    this.deathScreen.classList.remove('hidden');
    window.soundFX.playExplosion();

    // Release pointer lock so player can see cursor to click rejoin button
    if (document.exitPointerLock) {
      document.exitPointerLock();
    }

    let countdown = 3;
    this.respawnTimer.innerText = countdown;
    if (this.respawnInterval) clearInterval(this.respawnInterval);

    this.respawnInterval = setInterval(() => {
      countdown--;
      this.respawnTimer.innerText = Math.max(0, countdown);
      if (countdown <= 0) {
        clearInterval(this.respawnInterval);
        this.respawnInterval = null;
        this.rejoinMatch();
      }
    }, 1000);
  }

  rejoinMatch() {
    if (this.respawnInterval) {
      clearInterval(this.respawnInterval);
      this.respawnInterval = null;
    }
    this.network.sendRequestRespawn();
  }

  respawnLocalPlayer(x, y, z) {
    if (this.respawnInterval) {
      clearInterval(this.respawnInterval);
      this.respawnInterval = null;
    }
    this.health = 100;
    this.healthVal.innerText = 100;
    this.healthBar.style.width = '100%';
    this.player.position.set(x || 0, y || 1.6, z || 20);
    this.player.velocity.set(0, 0, 0);
    this.player.model.revive();
    this.player.ammo = this.player.maxAmmo;
    this.player.updateHUD();
    this.isDead = false;
    this.deathScreen.classList.add('hidden');
    this.blocker.style.opacity = '0';
    this.blocker.style.pointerEvents = 'none';

    // Re-lock mouse to immediately control player
    this.canvas.requestPointerLock();
  }

  onKillAwarded(newScore) {
    this.score = newScore;
    this.scoreVal.innerText = this.score;
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = Math.min(this.clock.getDelta(), 0.1);

    const controllable = this.isPlaying && !this.isDead;
    // Always simulate so the character idles / plays its death animation while menus are open
    this.player.update(delta, this.arena, !controllable);

    if (controllable) {
      // Automatic weapon continuous fire if mouse held down
      if (this.isFiring) {
        this.fireWeapon();
      }

      // Transmit local coordinates to network
      this.network.sendUpdate(
        this.player.position.x,
        this.player.position.y,
        this.player.position.z,
        this.player.yaw,
        this.player.pitch
      );
    }

    // Update Arena
    this.arena.update(delta);

    // Update Network (remote players interpolation & overhead health bars)
    this.network.update(delta, this.camera);

    // Update Projectiles
    const now = performance.now();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.mesh.position.addScaledVector(p.velocity, delta);

      if ((now - p.spawnTime) / 1000 > p.lifetime) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    // Update Impact Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.velocity.y -= 18 * delta; // gravity
      pt.mesh.position.addScaledVector(pt.velocity, delta);
      pt.life -= delta;

      if (pt.life <= 0) {
        this.scene.remove(pt.mesh);
        this.particles.splice(i, 1);
      }
    }

    // Render 3D Scene
    this.renderer.render(this.scene, this.camera);
  }
}

// Boot game when window is loaded
window.addEventListener('load', () => {
  window.mainGame = new Game();
});
