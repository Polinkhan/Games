// Real-time WebSocket Client for Multiplayer Arena
// Synchronizes positions, remote player 3D models with overhead names & health bars, shoot events, and kills

class NetworkManager {
  constructor(scene, onKillCallback, onDamageCallback) {
    this.scene = scene;
    this.onKillCallback = onKillCallback;
    this.onDamageCallback = onDamageCallback;

    this.ws = null;
    this.localId = null;
    this.connected = false;
    this.remotePlayers = new Map(); // id -> { mesh, data, targetPos, targetRotY, healthBarFill, healthBarGroup, nameplate }

    this.lastSendTime = 0;
    this.sendInterval = 0.033; // ~30 updates/sec

    this.connect();
  }

  connect() {
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
      console.log('Running in local standalone mode (no WebSocket server detected)');
      return;
    }

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[Network] Connected to PvP arena server');
        this.connected = true;
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          console.error('[Network] Message parse error:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('[Network] Disconnected from server');
        this.connected = false;
      };

      this.ws.onerror = (err) => {
        console.warn('[Network] WebSocket error:', err);
      };
    } catch (e) {
      console.warn('[Network] Connection failed:', e);
    }
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'init':
        this.localId = msg.id;
        console.log(`[Network] Assigned ID: ${this.localId}`);
        if (window.mainGame && msg.player && msg.player.color) {
          window.mainGame.player.model.setAccent(msg.player.color);
        }
        for (const p of msg.players) {
          if (p.id !== this.localId) {
            this.addRemotePlayer(p);
          }
        }
        if (msg.leaderboard) {
          this.updateLeaderboard(msg.leaderboard);
        }
        this.updatePlayerCount();
        break;

      case 'player_joined':
        if (msg.player.id !== this.localId) {
          this.addRemotePlayer(msg.player);
          this.updatePlayerCount();
          this.addKillFeedEntry(`${escapeHtml(msg.player.name || 'Agent')} entered the arena`);
        }
        break;

      case 'player_moved':
        if (this.remotePlayers.has(msg.id)) {
          const rp = this.remotePlayers.get(msg.id);
          rp.targetPos.set(msg.x, msg.y, msg.z);
          rp.targetRotY = msg.rotY;
          rp.targetRotX = msg.rotX;
        }
        break;

      case 'player_shot':
        if (this.remotePlayers.has(msg.id)) {
          this.remotePlayers.get(msg.id).model.fire();
          if (window.mainGame) {
            window.mainGame.spawnPlasmaBolt(msg.origin, msg.direction, 0xff0055, false);
          }
        }
        break;

      case 'player_damaged':
        if (msg.id === this.localId) {
          if (this.onDamageCallback) {
            this.onDamageCallback(msg.health);
          }
        } else if (this.remotePlayers.has(msg.id)) {
          const rp = this.remotePlayers.get(msg.id);
          rp.data.health = msg.health;
          this.updateRemotePlayerHealth(rp);
          this.flashRemotePlayerHit(rp);
        }
        break;

      case 'kill':
        this.addKillFeedEntry(
          `<span class="kill-killer">${escapeHtml(msg.killerName || 'Agent')}</span> fragged <span class="kill-victim">${escapeHtml(msg.victimName || 'Agent')}</span>`
        );
        if (this.remotePlayers.has(msg.victimId)) {
          // Dead opponents play a death animation and can't be shot again until respawn
          this.setRemoteDead(this.remotePlayers.get(msg.victimId), true);
        }
        if (msg.killerId === this.localId && this.onKillCallback) {
          this.onKillCallback(msg.killerScore);
        }
        break;

      case 'leaderboard':
        this.updateLeaderboard(msg.leaderboard);
        break;

      case 'respawn':
        if (msg.id === this.localId) {
          if (window.mainGame) {
            window.mainGame.respawnLocalPlayer(msg.x, msg.y, msg.z);
          }
        } else if (this.remotePlayers.has(msg.id)) {
          const rp = this.remotePlayers.get(msg.id);
          rp.mesh.position.set(msg.x, msg.y, msg.z);
          rp.targetPos.set(msg.x, msg.y, msg.z);
          rp.prevPos.set(msg.x, msg.y, msg.z);
          rp.mesh.visible = true;
          this.setRemoteDead(rp, false);
          rp.data.health = 100;
          this.updateRemotePlayerHealth(rp);
        }
        break;

      case 'player_renamed':
        if (this.remotePlayers.has(msg.id)) {
          const rp = this.remotePlayers.get(msg.id);
          rp.name = msg.name;
          this.updateNameplate(rp.nameplate, msg.name);
        }
        break;

      case 'player_left':
        this.removeRemotePlayer(msg.id);
        this.updatePlayerCount();
        break;
    }
  }

  // Create crisp 3D Canvas Nameplate Sprite
  createNameplate(name, color = '#00ffcc') {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');

    // Rounded background box
    ctx.fillStyle = 'rgba(3, 7, 18, 0.85)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    const x = 6, y = 6, w = 308, h = 68, r = 14;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Player text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 160, 40);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.6, 0.4, 1);
    sprite.position.set(0, 1.95, 0);

    return { sprite, canvas, ctx, texture, color };
  }

  updateNameplate(nameplate, newName) {
    if (!nameplate) return;
    const ctx = nameplate.ctx;
    const canvas = nameplate.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(3, 7, 18, 0.85)';
    ctx.strokeStyle = nameplate.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    const x = 6, y = 6, w = 308, h = 68, r = 14;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(newName, 160, 40);

    nameplate.texture.needsUpdate = true;
  }

  addRemotePlayer(data) {
    if (this.remotePlayers.has(data.id)) return;

    // Group origin = network position (eye height); the character's feet sit 1.6m below
    const group = new THREE.Group();
    const model = new CharacterModel(data.color || '#00ffcc');
    model.root.position.y = -1.6;
    model.root.rotation.y = data.rotY || 0;
    group.add(model.root);

    // Overhead 3D Health Bar Group
    const barGroup = new THREE.Group();
    barGroup.position.set(0, 0.5, 0);

    const bgGeo = new THREE.PlaneGeometry(1.0, 0.12);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x111827, side: THREE.DoubleSide });
    const bgMesh = new THREE.Mesh(bgGeo, bgMat);
    barGroup.add(bgMesh);

    const fillGeo = new THREE.PlaneGeometry(0.96, 0.08);
    const fillMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, side: THREE.DoubleSide });
    const fillMesh = new THREE.Mesh(fillGeo, fillMat);
    fillMesh.position.z = 0.01;
    barGroup.add(fillMesh);
    group.add(barGroup);

    // 3D Player Nameplate Sprite
    const nameplate = this.createNameplate(data.name || 'Agent', data.color || '#00ffcc');
    nameplate.sprite.position.set(0, 0.72, 0);
    group.add(nameplate.sprite);

    group.position.set(data.x, data.y, data.z);
    this.scene.add(group);

    const rp = {
      id: data.id,
      name: data.name,
      mesh: group,
      model: model,
      hitMeshes: model.hitMeshes,
      barGroup: barGroup,
      fillMesh: fillMesh,
      nameplate: nameplate,
      data: data,
      dead: false,
      targetPos: new THREE.Vector3(data.x, data.y, data.z),
      prevPos: new THREE.Vector3(data.x, data.y, data.z),
      smoothVel: new THREE.Vector3(),
      targetRotY: data.rotY || 0,
      targetRotX: data.rotX || 0,
      pitch: data.rotX || 0
    };
    this.remotePlayers.set(data.id, rp);
    this.updateRemotePlayerHealth(rp);
    if (data.health !== undefined && data.health <= 0) this.setRemoteDead(rp, true);
  }

  setRemoteDead(rp, dead) {
    rp.dead = dead;
    rp.barGroup.visible = !dead;
    rp.nameplate.sprite.visible = !dead;
    if (dead) rp.model.die();
    else rp.model.revive();
  }

  updateRemotePlayerHealth(rp) {
    const fraction = Math.max(0, rp.data.health / 100);
    rp.fillMesh.scale.x = fraction;
    rp.fillMesh.position.x = (fraction - 1) * 0.48;

    if (fraction > 0.5) {
      rp.fillMesh.material.color.setHex(0x00ffcc);
    } else if (fraction > 0.25) {
      rp.fillMesh.material.color.setHex(0xffbb00);
    } else {
      rp.fillMesh.material.color.setHex(0xff0055);
    }
  }

  flashRemotePlayerHit(rp) {
    rp.model.hitFlash();
  }

  removeRemotePlayer(id) {
    if (this.remotePlayers.has(id)) {
      const rp = this.remotePlayers.get(id);
      this.scene.remove(rp.mesh);
      this.remotePlayers.delete(id);
    }
  }

  sendUpdate(x, y, z, rotY, rotX) {
    if (!this.connected || !this.ws) return;
    const now = performance.now() / 1000;
    if (now - this.lastSendTime < this.sendInterval) return;
    this.lastSendTime = now;

    this.ws.send(JSON.stringify({
      type: 'update',
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      z: Number(z.toFixed(2)),
      rotY: Number(rotY.toFixed(3)),
      rotX: Number(rotX.toFixed(3))
    }));
  }

  sendShoot(origin, direction) {
    if (!this.connected || !this.ws) return;
    this.ws.send(JSON.stringify({
      type: 'shoot',
      origin: { x: origin.x, y: origin.y, z: origin.z },
      direction: { x: direction.x, y: direction.y, z: direction.z }
    }));
  }

  sendHit(targetId) {
    if (!this.connected || !this.ws) return;
    // Damage is decided by the server
    this.ws.send(JSON.stringify({
      type: 'hit',
      targetId: targetId
    }));
  }

  sendSetName(name) {
    if (!this.connected || !this.ws) return;
    this.ws.send(JSON.stringify({
      type: 'setName',
      name: name
    }));
  }

  sendRequestRespawn() {
    if (!this.connected || !this.ws) return;
    this.ws.send(JSON.stringify({
      type: 'request_respawn'
    }));
  }

  update(delta, camera) {
    const k = Math.min(delta * 14, 1);
    for (const [, rp] of this.remotePlayers) {
      rp.mesh.position.lerp(rp.targetPos, k);
      const root = rp.model.root;
      root.rotation.y = THREE.MathUtils.lerp(root.rotation.y, rp.targetRotY, k);
      rp.pitch = THREE.MathUtils.lerp(rp.pitch, rp.targetRotX, k);

      // Derive velocity from interpolated motion to drive the gait animation
      if (delta > 0) {
        const v = rp.mesh.position.clone().sub(rp.prevPos).divideScalar(delta);
        rp.smoothVel.lerp(v, Math.min(delta * 10, 1));
      }
      rp.prevPos.copy(rp.mesh.position);

      const yaw = root.rotation.y;
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      const vx = rp.smoothVel.x, vz = rp.smoothVel.z;
      rp.model.update(delta, {
        forward: -vx * sin - vz * cos,
        strafe: vx * cos - vz * sin,
        grounded: Math.abs(rp.smoothVel.y) < 1.5,
        pitch: rp.pitch
      });

      // Billboard overhead health bar (group itself is unrotated)
      if (camera && rp.barGroup) {
        rp.barGroup.quaternion.copy(camera.quaternion);
      }
    }
  }

  updateLeaderboard(leaderboard) {
    const listEl = document.getElementById('leaderboard-list');
    if (!listEl || !Array.isArray(leaderboard)) return;

    listEl.innerHTML = '';
    leaderboard.forEach((entry, idx) => {
      const isLocal = entry.id === this.localId;
      const row = document.createElement('div');
      row.className = 'lb-row' + (isLocal ? ' local-player' : '');

      const prefix = isLocal ? '★ ' : `${idx + 1}. `;
      row.innerHTML = `
        <span class="lb-name">${prefix}${escapeHtml(entry.name || 'Agent')}</span>
        <span class="lb-frags">${entry.score || 0}</span>
      `;
      listEl.appendChild(row);
    });
  }

  updatePlayerCount() {
    const total = this.remotePlayers.size + 1;
    const countEl = document.getElementById('player-count');
    if (countEl) countEl.innerText = total.toString();

    const banner = document.getElementById('match-banner');
    if (banner) {
      if (total <= 1) {
        banner.className = 'waiting';
        banner.innerText = 'WAITING FOR OPPONENT... (OPEN 2ND TAB TO FIGHT)';
      } else {
        banner.className = 'active';
        banner.innerText = `PVP ENGAGED - ${total} AGENTS IN ARENA`;
      }
    }
  }

  addKillFeedEntry(html) {
    const feed = document.getElementById('kill-feed');
    if (!feed) return;
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    entry.innerHTML = html;
    feed.appendChild(entry);
    setTimeout(() => {
      if (entry.parentElement) entry.remove();
    }, 4000);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}
