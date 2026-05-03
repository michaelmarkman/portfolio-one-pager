import * as THREE from 'three'

/**
 * Builds a ShaderMaterial that simulates a CRT screen: barrel distortion of
 * the sampled DOM texture, chromatic aberration, scanlines, slot mask,
 * vignette, slow rolling shutter, and a diagonal glass glare highlight.
 *
 * `uMap`: the live DOM CanvasTexture
 * `uTime`: animated by useFrame
 * `uBarrel`: how strong the barrel bulge is (0 = none, 0.3 = strong)
 */
export function createCrtMaterial(texture) {
  return new THREE.ShaderMaterial({
    transparent: false,
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: texture },
      uTime: { value: 0 },
      uBarrel: { value: 0.09 },
      uChromatic: { value: 0.0011 },
      uScanlineStrength: { value: 0.18 },
      uScanlineFreq: { value: 720.0 },
      uVignetteStrength: { value: 0.55 },
      uGlareStrength: { value: 0.0 },
      uRollSpeed: { value: 0.08 },
      // Cursor effect: position in source texture UV (0..1), z = active
      // (1) / off-screen (0). Drives a phosphor halo + soft ripple.
      uCursorUV: { value: new THREE.Vector3(-1, -1, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;

      uniform sampler2D uMap;
      uniform float uTime;
      uniform float uBarrel;
      uniform float uChromatic;
      uniform float uScanlineStrength;
      uniform float uScanlineFreq;
      uniform float uVignetteStrength;
      uniform float uGlareStrength;
      uniform float uRollSpeed;
      uniform vec3 uCursorUV;

      // Barrel-distort UV around (0.5, 0.5). Positive k bulges outward.
      vec2 barrel(vec2 uv, float k) {
        vec2 c = uv - 0.5;
        float r2 = dot(c, c);
        return 0.5 + c * (1.0 + k * r2);
      }

      // Slot mask — RGB stripe pattern faking a CRT shadow mask
      vec3 slotMask(vec2 uv) {
        float n = mod(floor(uv.x * 1200.0), 3.0);
        vec3 m = vec3(0.0);
        if (n < 1.0) m = vec3(1.0, 0.55, 0.55);
        else if (n < 2.0) m = vec3(0.55, 1.0, 0.55);
        else m = vec3(0.55, 0.55, 1.0);
        return mix(vec3(1.0), m, 0.18);
      }

      void main() {
        // 1. Barrel-distort the lookup. If outside [0,1], render the bezel
        //    color so the screen edges feel like real glass curvature.
        vec2 uv = barrel(vUv, uBarrel);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
          gl_FragColor = vec4(0.012, 0.012, 0.012, 1.0);
          return;
        }

        // 2. Chromatic aberration — sample R and B at slightly offset UVs
        vec2 dir = normalize(uv - 0.5 + 1e-4);
        float r = texture2D(uMap, uv - dir * uChromatic).r;
        float g = texture2D(uMap, uv).g;
        float b = texture2D(uMap, uv + dir * uChromatic).b;
        vec3 col = vec3(r, g, b);

        // 3. Slot mask
        col *= slotMask(uv);

        // 4. Horizontal scanlines (every other row dimmed)
        float scan = sin(uv.y * uScanlineFreq) * 0.5 + 0.5;
        col *= 1.0 - uScanlineStrength * (1.0 - scan);

        // 5. Slow rolling shutter band
        float roll = mod(uv.y - uTime * uRollSpeed, 1.0);
        float band = smoothstep(0.0, 0.02, roll) * smoothstep(0.08, 0.06, roll);
        col += vec3(0.04, 0.06, 0.04) * band;

        // 6. Phosphor green tint at mid-low brightness — give the off-pixels
        //    a subtle green glow
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, col * vec3(0.9, 1.05, 0.85), 0.25);
        col += vec3(0.0, 0.02, 0.0) * (1.0 - lum);

        // 6.5. Cursor phosphor halo — only when the cursor is over the
        //      screen (uCursorUV.z == 1). Very subtle.
        if (uCursorUV.z > 0.5) {
          float cd = distance(uv, uCursorUV.xy);
          float halo = smoothstep(0.10, 0.0, cd);
          col += vec3(0.04, 0.20, 0.04) * halo * 0.24;
        }

        // 7. Vignette (radial darkening)
        float vDist = distance(vUv, vec2(0.5));
        float vig = smoothstep(0.85, 0.4, vDist);
        col *= mix(1.0, vig, uVignetteStrength);

        // 8. Glass glare — diagonal highlight, fixed in screen space
        vec2 glareDir = normalize(vec2(0.6, 1.0));
        float gp = dot(glareDir, vUv - vec2(0.5));
        float glare = smoothstep(0.05, 0.0, abs(gp - 0.05)) * uGlareStrength;
        col += vec3(0.6, 0.8, 1.0) * glare * 0.18;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}
