// Third-Person Player Controller
// Mouse-look orbit camera (over-the-shoulder, wall-aware), WASD movement, jumping,
// obstacle collision and the animated local character model.

class Player {
  constructor(camera, scene, domElement, arena) {
    this.camera = camera;
    this.scene = scene;
    this.domElement = domElement;
    this.arena = arena;

    // Transforms & physics (position = eye point, feet are eyeHeight below)
    this.position = new THREE.Vector3(0, 1.6, 20);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.eyeHeight = 1.6;
    this.radius = 0.45;
    this.isGrounded = true;

    // Movement speeds
    this.walkSpeed = 8;
    this.sprintSpeed = 13;
    this.jumpForce = 11;
    this.gravity = 28;

    // Third-person camera rig
    this.camShoulder = new THREE.Vector3(0.65, 0.3, 0); // right-shoulder offset (camera space)
    this.camDistance = 3.4;                              // desired boom length
    this.camCurrentDist = this.camDistance;
    this.camRaycaster = new THREE.Raycaster();
    this.camPivot = new THREE.Vector3();

    // Input states
    this.keys = { forward: false, backward: false, left: false, right: false, jump: false, sprint: false };

    // Weapon state
    this.ammo = 30;
    this.maxAmmo = 30;
    this.isReloading = false;
    this.lastFireTime = 0;
    this.fireInterval = 0.13; // seconds between shots

    // Character model
    this.model = new CharacterModel('#00bfff');
    this.scene.add(this.model.root);
    this.scene.add(this.camera);

    this.setupInputs();
    this.updateCamera(0);
  }

  setupInputs() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyW') this.keys.forward = true;
      if (e.code === 'KeyS') this.keys.backward = true;
      if (e.code === 'KeyA') this.keys.left = true;
      if (e.code === 'KeyD') this.keys.right = true;
      if (e.code === 'Space') this.keys.jump = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keys.sprint = true;
      if (e.code === 'KeyR') this.reload();
      if (e.code === 'KeyQ') this.camShoulder.x = -this.camShoulder.x; // swap shoulder
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyW') this.keys.forward = false;
      if (e.code === 'KeyS') this.keys.backward = false;
      if (e.code === 'KeyA') this.keys.left = false;
      if (e.code === 'KeyD') this.keys.right = false;
      if (e.code === 'Space') this.keys.jump = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keys.sprint = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.domElement) {
        const sensitivity = 0.0022;
        this.yaw -= e.movementX * sensitivity;
        this.pitch -= e.movementY * sensitivity;
        this.pitch = Math.max(-1.05, Math.min(1.2, this.pitch));
      }
    });
  }

  triggerShootAnimation() {
    this.model.fire();
  }

  getMuzzlePosition(target) {
    return this.model.getMuzzleWorldPosition(target);
  }

  reload() {
    if (this.isReloading || this.ammo === this.maxAmmo) return;
    this.isReloading = true;
    window.soundFX.playReload();

    const indicator = document.getElementById('reload-indicator');
    if (indicator) indicator.classList.remove('hidden');

    setTimeout(() => {
      this.ammo = this.maxAmmo;
      this.isReloading = false;
      if (indicator) indicator.classList.add('hidden');
      this.updateHUD();
    }, 1200);
  }

  updateHUD() {
    const ammoVal = document.getElementById('ammo-val');
    if (ammoVal) ammoVal.innerText = this.ammo;
  }

  // Does the player's horizontal circle at (x, z) overlap this solid's footprint?
  overlapsSolid(x, z, s) {
    if (s.type === 'box') {
      const cx = Math.max(s.minX, Math.min(s.maxX, x));
      const cz = Math.max(s.minZ, Math.min(s.maxZ, z));
      return (x - cx) ** 2 + (z - cz) ** 2 < this.radius * this.radius;
    }
    const r = s.r + this.radius;
    return (x - s.x) ** 2 + (z - s.z) ** 2 < r * r;
  }

  // Blocked if a solid overlaps horizontally and spans the player's body height
  collidesAt(x, z, feetY, arena) {
    const stepHeight = 0.35;
    const headY = feetY + this.eyeHeight + 0.2;
    for (const s of arena.solids) {
      if (feetY + stepHeight >= s.top || headY <= s.bottom) continue;
      if (this.overlapsSolid(x, z, s)) return true;
    }
    return false;
  }

  // Over-the-shoulder orbit camera that pulls in instead of clipping through walls
  updateCamera(delta) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

    // Pivot sits just above the character's head, shifted toward the chosen shoulder
    this.camPivot.copy(this.position);
    this.camPivot.y += 0.1;
    const shoulder = this.camShoulder.clone().applyQuaternion(q);
    const pivot = this.camPivot.clone().add(shoulder);

    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    let target = this.camDistance;
    if (this.arena) {
      this.camRaycaster.set(pivot, back);
      this.camRaycaster.far = this.camDistance + 0.3;
      const hits = this.camRaycaster.intersectObjects(this.arena.colliders, false);
      if (hits.length > 0) target = Math.max(0.3, hits[0].distance - 0.3);
    }

    // Snap in fast when blocked, ease back out smoothly
    if (target < this.camCurrentDist || delta === 0) this.camCurrentDist = target;
    else this.camCurrentDist += (target - this.camCurrentDist) * (1 - Math.exp(-6 * delta));

    this.camera.position.copy(pivot).addScaledVector(back, this.camCurrentDist);
    this.camera.position.y = Math.max(0.25, this.camera.position.y);
    this.camera.quaternion.copy(q);

    // Hide the body when the camera is jammed against it
    this.model.setVisible(this.camCurrentDist > 0.9);
  }

  // Distance from the camera to the character, so aim rays skip anything behind the player
  getCameraBoomLength() {
    return this.camera.position.distanceTo(this.camPivot);
  }

  update(delta, arena, isDead = false) {
    if (!isDead) {
      // Horizontal movement direction relative to camera yaw
      const moveDir = new THREE.Vector3();
      if (this.keys.forward) moveDir.z -= 1;
      if (this.keys.backward) moveDir.z += 1;
      if (this.keys.left) moveDir.x -= 1;
      if (this.keys.right) moveDir.x += 1;

      if (moveDir.lengthSq() > 0) {
        moveDir.normalize();
        moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      }

      // Sprinting only while moving forward
      const sprinting = this.keys.sprint && this.keys.forward && !this.keys.backward;
      const currentSpeed = sprinting ? this.sprintSpeed : this.walkSpeed;
      const accel = this.isGrounded ? 14 : 4;
      this.velocity.x += (moveDir.x * currentSpeed - this.velocity.x) * Math.min(delta * accel, 1);
      this.velocity.z += (moveDir.z * currentSpeed - this.velocity.z) * Math.min(delta * accel, 1);

      if (this.keys.jump && this.isGrounded) {
        this.velocity.y = this.jumpForce;
        this.isGrounded = false;
        window.soundFX.playJump();
      }
    } else {
      this.velocity.x *= 0.9;
      this.velocity.z *= 0.9;
    }

    this.velocity.y -= this.gravity * delta;

    // Jump pads (only launch from the ground, so a pad fires once per touch)
    if (this.isGrounded && !isDead) {
      for (const pad of arena.jumpPads) {
        const dist = Math.hypot(this.position.x - pad.x, this.position.z - pad.z);
        if (dist < pad.radius && this.position.y <= 2.0) {
          this.velocity.y = pad.power;
          this.isGrounded = false;
          window.soundFX.playJump();
          break;
        }
      }
    }

    // Integrate position with collisions
    const nextY = this.position.y + this.velocity.y * delta;
    const feetY = this.position.y - this.eyeHeight;

    const arenaBoundary = arena.size / 2 - 1.2;
    const clampB = (v) => Math.max(-arenaBoundary, Math.min(arenaBoundary, v));

    // Resolve per axis so the player slides along obstacles instead of sticking.
    // If already overlapping (e.g. respawned inside cover), let them walk out.
    const stuck = this.collidesAt(this.position.x, this.position.z, feetY, arena);
    const nextX = clampB(this.position.x + this.velocity.x * delta);
    if (stuck || !this.collidesAt(nextX, this.position.z, feetY, arena)) this.position.x = nextX;
    else this.velocity.x = 0;
    const nextZ = clampB(this.position.z + this.velocity.z * delta);
    if (stuck || !this.collidesAt(this.position.x, nextZ, feetY, arena)) this.position.z = nextZ;
    else this.velocity.z = 0;

    // Ground height: floor, centre dais, or top of an obstacle
    let groundHeight = this.eyeHeight;
    if (Math.hypot(this.position.x, this.position.z) <= 6.2) groundHeight = 1.6 + 1.6;
    for (const s of arena.solids) {
      if (feetY >= s.top - 0.35 && this.overlapsSolid(this.position.x, this.position.z, s)) {
        groundHeight = Math.max(groundHeight, s.top + this.eyeHeight);
      }
    }

    if (nextY <= groundHeight) {
      this.position.y = groundHeight;
      this.velocity.y = 0;
      this.isGrounded = true;
    } else {
      this.position.y = nextY;
      this.isGrounded = false;
    }

    // Character follows the aim yaw; animation uses local-space velocity
    this.model.root.position.set(this.position.x, this.position.y - this.eyeHeight, this.position.z);
    this.model.root.rotation.y = this.yaw;
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    this.model.update(delta, {
      // facing = (-sin, 0, -cos), right = (cos, 0, -sin)
      forward: -this.velocity.x * sin - this.velocity.z * cos,
      strafe: this.velocity.x * cos - this.velocity.z * sin,
      grounded: this.isGrounded,
      pitch: this.pitch
    });

    this.updateCamera(delta);
  }
}
