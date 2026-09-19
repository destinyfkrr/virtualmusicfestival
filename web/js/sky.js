// sky.js - time of day. Night is the default and stays what it was: a pure black sky with stars and no dome at all.
// 'sunset' holds the golden hour behind the stage, and 'cycle' starts there and lets the light go over five minutes,
// so the headliner still plays under black. `tod` runs 1 (golden hour) to 0 (night).
import * as THREE from 'three';

export const TIMES = ['night', 'sunset', 'cycle'];
export const TIME_LABEL = { night: 'Night', sunset: 'Sunset', cycle: 'Sunset to night' };
const CYCLE_S = 300, SUNSET_TOD = 0.88;
// keyed gradient: [tod, zenith, horizon]. Kept under ~0.45 luminance so the auto-iris does not close on the sky.
const KEYS = [[0, 0x000000, 0x000000], [0.25, 0x02030a, 0x0b0820], [0.5, 0x080d28, 0x63233b], [0.75, 0x14264c, 0xb5522e], [1, 0x23406e, 0xc47a3c]]
  .map(k => [k[0], new THREE.Color(k[1]), new THREE.Color(k[2])]);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Sky {
  constructor(stage, stars) {
    this.stage = stage; this.stars = stars; this.mode = 'night'; this.tod = 0; this.goal = 0; this.cycleT = 0;
    this.top = new THREE.Color(); this.hor = new THREE.Color(); this.sunDir = new THREE.Vector3(0.22, 0, -1);
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(2400, 32, 16), new THREE.ShaderMaterial({
      uniforms: { uTop: { value: this.top }, uHor: { value: this.hor }, uSun: { value: new THREE.Vector3() }, uSunK: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vDir; uniform vec3 uTop, uHor, uSun; uniform float uSunK;
        void main() { vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0);
          vec3 c = mix(uHor, uTop, pow(h, 0.42));
          float s = max(0.0, dot(d, normalize(uSun)));
          c += uSunK * (vec3(1.0, 0.5, 0.2) * pow(s, 10.0) * 0.32 * (1.0 - h) + vec3(1.0, 0.78, 0.5) * smoothstep(0.9993, 0.9997, s) * 1.6);
          c *= smoothstep(-0.1, 0.02, d.y) * 0.6 + 0.4;
          gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
    }));
    this.dome.renderOrder = -10; this.dome.frustumCulled = false; this.dome.visible = false;
    stage.scene.add(this.dome);
    this.sun = new THREE.DirectionalLight(0xffb070, 0); this.sun.position.set(0.22, 0.2, -1).multiplyScalar(1000); stage.scene.add(this.sun); stage.scene.add(this.sun.target);
    if (stars) { stars.material.transparent = true; stars.material.depthWrite = false; }
    this.base = { amb: stage.ambLight.intensity, ambC: stage.ambLight.color.clone(), hemi: stage.hemiLight.intensity, hemiC: stage.hemiLight.color.clone(), hemiG: stage.hemiLight.groundColor.clone() };
    this.dayAmb = new THREE.Color(0x8a7f9a); this.daySky = new THREE.Color(0x7f93c8); this.dayGround = new THREE.Color(0x3a2a22); this.crowdDay = new THREE.Color();
  }

  setMode(mode, snap = false) {
    this.mode = TIMES.includes(mode) ? mode : 'night';
    if (this.mode === 'cycle') { this.cycleT = 0; this.goal = 1; } else this.goal = this.mode === 'sunset' ? SUNSET_TOD : 0;
    if (snap) this.tod = this.goal;
    return this.mode;
  }

  update(dt, camera) {
    if (this.mode === 'cycle') { this.cycleT += dt; this.goal = Math.max(0, 1 - Math.max(0, this.cycleT - 8) / CYCLE_S); }
    const d = this.goal - this.tod, rate = this.mode === 'cycle' && this.cycleT > 8 ? 1 : 0.22;
    this.tod += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    const tod = this.tod, st = this.stage, on = tod > 0.002;
    if (!on && !this.dome.visible && this._clean) return;
    let i = 1; while (i < KEYS.length - 1 && KEYS[i][0] < tod) i++;
    const a = KEYS[i - 1], b = KEYS[i], f = (tod - a[0]) / (b[0] - a[0]);
    this.top.copy(a[1]).lerp(b[1], f); this.hor.copy(a[2]).lerp(b[2], f);
    const elev = (-9 + 17 * tod) * Math.PI / 180, U = this.dome.material.uniforms;
    this.sunDir.set(0.22, Math.tan(elev), -1).normalize(); U.uSun.value.copy(this.sunDir); U.uSunK.value = smooth(0.3, 0.7, tod);
    this.dome.visible = on; this.dome.position.copy(camera.position);
    if (this.stars) { this.stars.material.opacity = 1 - smooth(0.15, 0.55, tod); this.stars.visible = this.stars.material.opacity > 0.01; }
    const day = smooth(0.2, 0.95, tod), B = this.base;
    st.ambLight.intensity = B.amb + 0.75 * day; st.ambLight.color.copy(B.ambC).lerp(this.dayAmb, day);
    st.hemiLight.intensity = B.hemi + 1.1 * day; st.hemiLight.color.copy(B.hemiC).lerp(this.daySky, day); st.hemiLight.groundColor.copy(B.hemiG).lerp(this.dayGround, day);
    this.sun.intensity = 1.5 * smooth(0.4, 0.9, tod); this.sun.position.copy(this.sunDir).multiplyScalar(1000).add(camera.position); this.sun.target.position.copy(camera.position);
    st.scene.fog.color.copy(this.hor).multiplyScalar(0.3 * day);
    this.crowdDay.setRGB(0.2, 0.16, 0.15).multiplyScalar(day);
    this._clean = !on;
  }
}
