"use strict";

    // ============================================================================
    // 1. WGSL SHADERS (SKY PASS + INSTANCED 3D PBR/BLINN-PHONG & VFX PASS)
    // ============================================================================
    const WGSL_SHADER_CODE = /* wgsl */`
      struct SceneUniforms {
        viewProj     : mat4x4<f32>,
        invViewProj  : mat4x4<f32>,
        cameraPos    : vec4<f32>, // xyz = camera pos, w = time
        sunDir       : vec4<f32>, // xyz = normalized direction to sun, w = aspect
        jetShadowPos : vec4<f32>, // xyz = aircraft world pos for contact shadow, w = muzzleFlashBoost
        skyParams    : vec4<f32>, // x = camRoll, y = camPitch, z = speedFactor, w = reducedMotion
      };

      struct InstanceData {
        modelMatrix  : mat4x4<f32>,
        colorTint    : vec4<f32>, // rgb = tint/albedo override, a = opacity / alpha
        extraParams  : vec4<f32>, // x = matModeOverride, y = emissiveBoost, z = isAircraftFlag, w = hitFlash
      };

      @group(0) @binding(0) var<uniform> scene : SceneUniforms;
      @group(0) @binding(1) var<storage, read> instances : array<InstanceData>;

      // --------------------------------------------------------------------------
      // FULLSCREEN ATMOSPHERIC SKY SHADER
      // --------------------------------------------------------------------------
      struct SkyVSOut {
        @builtin(position) pos : vec4<f32>,
        @location(0) uv : vec2<f32>,
      };

      @vertex
      fn vs_sky(@builtin(vertex_index) vid : u32) -> SkyVSOut {
        // Fullscreen triangle covering [-1, 1] clip space at far depth 0.9999
        var positions = array<vec2<f32>, 3>(
          vec2<f32>(-1.0, -1.0),
          vec2<f32>( 3.0, -1.0),
          vec2<f32>(-1.0,  3.0)
        );
        let p = positions[vid];
        var out : SkyVSOut;
        out.pos = vec4<f32>(p.x, p.y, 0.9999, 1.0);
        out.uv = p;
        return out;
      }

      @fragment
      fn fs_sky(in : SkyVSOut) -> @location(0) vec4<f32> {
        // Unproject clip coordinate to world ray direction
        let farClip = vec4<f32>(in.uv.x, in.uv.y, 1.0, 1.0);
        let worldH = scene.invViewProj * farClip;
        let worldPos = worldH.xyz / worldH.w;
        let rayDir = normalize(worldPos - scene.cameraPos.xyz);

        // Elevation angle
        let y = clamp(rayDir.y, -0.35, 1.0);

        // Deep stratospheric blue at zenith -> vibrant azure mid-sky -> warm atmospheric horizon haze
        let zenithColor  = vec3<f32>(0.035, 0.085, 0.21);
        let midSkyColor  = vec3<f32>(0.11,  0.29,  0.56);
        let horizonColor = vec3<f32>(0.48,  0.67,  0.86);
        let groundHaze   = vec3<f32>(0.16,  0.25,  0.40);

        var col = mix(horizonColor, midSkyColor, pow(clamp(y * 2.2, 0.0, 1.0), 0.65));
        col = mix(col, zenithColor, pow(clamp(y, 0.0, 1.0), 0.85));

        if (y < 0.0) {
          col = mix(horizonColor, groundHaze, clamp(-y * 4.0, 0.0, 1.0));
        }

        // Horizon atmospheric glow band
        let horizonBand = exp(-abs(rayDir.y) * 14.0);
        col += vec3<f32>(0.24, 0.30, 0.36) * horizonBand * 0.55;

        // Directional Sun Disc & Mie Scattering Corona
        let sunDir = normalize(scene.sunDir.xyz);
        let sunDot = max(dot(rayDir, sunDir), 0.0);
        let sunCorona = pow(sunDot, 10.0) * 0.28 + pow(sunDot, 64.0) * 0.45;
        let sunDisc = smoothstep(0.9991, 0.9997, sunDot);
        col += vec3<f32>(1.0, 0.76, 0.52) * sunCorona;
        col += vec3<f32>(1.0, 0.96, 0.88) * sunDisc * 1.4;

        return vec4<f32>(col, 1.0);
      }

      // --------------------------------------------------------------------------
      // MAIN 3D GEOMETRY SHADER (AIRCRAFT, DRONES, TERRAIN, PROJECTILES)
      // --------------------------------------------------------------------------
      struct VSIn {
        @location(0) position : vec3<f32>,
        @location(1) normal   : vec3<f32>,
        @location(2) color    : vec3<f32>,
        @location(3) matProps : vec3<f32>, // x = matID, y = roughness, z = metallic
        @builtin(instance_index) instIdx : u32,
      };

      struct VSOut {
        @builtin(position) clipPos : vec4<f32>,
        @location(0) worldPos      : vec3<f32>,
        @location(1) worldNormal   : vec3<f32>,
        @location(2) localPos      : vec3<f32>,
        @location(3) baseColor     : vec4<f32>,
        @location(4) matProps      : vec3<f32>,
        @location(5) extraParams   : vec4<f32>,
      };

      @vertex
      fn vs_main(in : VSIn) -> VSOut {
        let inst = instances[in.instIdx];
        let worldPos4 = inst.modelMatrix * vec4<f32>(in.position, 1.0);

        // Transform normal using upper 3x3 of modelMatrix
        let m0 = inst.modelMatrix[0].xyz;
        let m1 = inst.modelMatrix[1].xyz;
        let m2 = inst.modelMatrix[2].xyz;
        let nMat = mat3x3<f32>(m0, m1, m2);
        let worldN = normalize(nMat * in.normal);

        var out : VSOut;
        out.clipPos = scene.viewProj * worldPos4;
        out.worldPos = worldPos4.xyz;
        out.worldNormal = worldN;
        out.localPos = in.position;

        // Combine vertex color with instance tint
        let finalRGB = in.color * inst.colorTint.rgb;
        out.baseColor = vec4<f32>(finalRGB, inst.colorTint.a);
        out.matProps = in.matProps;
        out.extraParams = inst.extraParams;
        return out;
      }

      // Pure analytical helper for anti-aliased aircraft panel lines (receives precomputed uniform fwidth)
      fn computePanelSeams(localPos : vec3<f32>, fwLocal : vec3<f32>) -> f32 {
        let gx = abs(fract(localPos.x * 1.15 + 0.5) - 0.5);
        let gz = abs(fract(localPos.z * 0.85 + 0.5) - 0.5);
        let dx = max(fwLocal.x * 1.15, 0.002);
        let dz = max(fwLocal.z * 0.85, 0.002);
        let lineX = 1.0 - smoothstep(dx * 0.7, dx * 2.1, gx);
        let lineZ = 1.0 - smoothstep(dz * 0.7, dz * 2.1, gz);
        return clamp(max(lineX, lineZ), 0.0, 1.0);
      }

      @fragment
      fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
        // CRITICAL WGSL COMPLIANCE: Evaluate screen-space derivatives (fwidth) unconditionally
        // at the very top of fs_main in strict uniform control flow before any branches or returns.
        let fwLocal = fwidth(in.localPos);
        let panelSeam = computePanelSeams(in.localPos, fwLocal);

        let matID     = in.matProps.x;
        let roughness = clamp(in.matProps.y, 0.04, 1.0);
        let metallic  = clamp(in.matProps.z, 0.0, 1.0);
        let emissiveBoost = in.extraParams.y;
        let isAircraft    = in.extraParams.z;
        let hitFlash      = in.extraParams.w;

        let N = normalize(in.worldNormal);
        let V = normalize(scene.cameraPos.xyz - in.worldPos);
        let L = normalize(scene.sunDir.xyz);
        let H = normalize(V + L);

        var albedo = in.baseColor.rgb;
        var alpha  = in.baseColor.a;

        // Pure emissive material (matID >= 3.5: afterburners, projectiles, muzzle flashes, drone cores)
        if (matID >= 3.5) {
          var glowCol = albedo * (1.35 + emissiveBoost);
          // Core edge hot-white boost
          let ndotv = max(dot(N, V), 0.0);
          glowCol += vec3<f32>(0.55, 0.45, 0.35) * pow(ndotv, 2.0) * emissiveBoost * 0.5;
          if (hitFlash > 0.01) {
            glowCol = mix(glowCol, vec3<f32>(2.0, 1.9, 1.7), hitFlash);
          }
          return vec4<f32>(glowCol, alpha);
        }

        // Subtle hard-surface panel lines & surface detail on the fighter aircraft
        if (isAircraft > 0.5 && matID < 1.8) {
          albedo = albedo * (1.0 - panelSeam * 0.16);
        }

        // Hemisphere ambient lighting (sky blue from above, cool canyon bounce from below)
        let skyAmb    = vec3<f32>(0.36, 0.52, 0.78);
        let groundAmb = vec3<f32>(0.11, 0.15, 0.24);
        let hemiFactor = N.y * 0.5 + 0.5;
        let ambient = mix(groundAmb, skyAmb, hemiFactor);

        // Directional Sun diffuse
        let ndotl = max(dot(N, L), 0.0);
        let sunColor = vec3<f32>(1.05, 0.96, 0.86);

        // Blinn-Phong / Metallic specular highlight
        let shininess = mix(16.0, 140.0, 1.0 - roughness);
        let ndoth = max(dot(N, H), 0.0);
        let specPower = pow(ndoth, shininess);
        let specStrength = mix(0.18, 1.35, metallic) * (1.0 - roughness * 0.65);
        let specColor = mix(vec3<f32>(1.0, 0.98, 0.95), albedo + vec3<f32>(0.35), metallic * 0.6);

        // Fresnel rim reflection (strong on cockpit canopy glass matID == 2.0 and metallic hull)
        let fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.5);
        var rimLight = vec3<f32>(0.45, 0.70, 1.0) * fresnel * mix(0.22, 0.75, metallic);

        // Cockpit canopy glass specialized shading (matID roughly 2.0)
        if (matID > 1.8 && matID < 2.5) {
          let skyReflect = mix(vec3<f32>(0.15, 0.35, 0.65), vec3<f32>(0.95, 0.78, 0.50), pow(max(reflect(-V, N).y, 0.0), 1.5));
          albedo = mix(albedo, skyReflect, 0.45 + fresnel * 0.45);
          rimLight += vec3<f32>(0.9, 0.85, 0.7) * pow(ndoth, 220.0) * 2.2;
        }

        // Point light contribution on aircraft from twin afterburners & muzzle flashes
        var dynamicLight = vec3<f32>(0.0);
        if (isAircraft > 0.5) {
          // Warm orange engine glow on rear stabilizers/nozzles
          let rearDist = length(in.localPos - vec3<f32>(0.0, 0.0, 4.3));
          let engineGlow = exp(-rearDist * 0.85) * 0.65;
          dynamicLight += vec3<f32>(1.0, 0.42, 0.12) * engineGlow;

          // Muzzle flash illumination on forward fuselage/wings when firing
          if (scene.jetShadowPos.w > 0.01) {
            let gunDist = length(in.localPos - vec3<f32>(0.0, -0.1, -2.5));
            dynamicLight += vec3<f32>(1.0, 0.65, 0.25) * exp(-gunDist * 0.45) * scene.jetShadowPos.w * 1.4;
          }
        }

        // Combine diffuse, ambient, specular, rim
        let diffuse = albedo * (ambient * mix(0.85, 0.45, metallic) + sunColor * ndotl * mix(0.85, 0.55, metallic));
        var litColor = diffuse + specColor * specPower * specStrength + rimLight + dynamicLight;

        // Terrain contact shadow directly underneath the aircraft (matID > 2.6 && matID < 3.2 is terrain)
        if (matID > 2.6 && matID < 3.2) {
          let dx = (in.worldPos.x - scene.jetShadowPos.x) * 0.22;
          let dz = (in.worldPos.z - scene.jetShadowPos.z) * 0.16;
          let shadowDist2 = dx * dx + dz * dz;
          let altFactor = clamp(1.0 - (scene.jetShadowPos.y - in.worldPos.y) * 0.022, 0.15, 0.85);
          let shadowMask = exp(-shadowDist2 * 1.6) * altFactor * 0.62;
          litColor *= (1.0 - shadowMask);
        }

        // Hit flash override when a drone takes damage
        if (hitFlash > 0.01) {
          litColor = mix(litColor, vec3<f32>(1.8, 1.35, 0.9), clamp(hitFlash, 0.0, 1.0));
        }

        // Atmospheric distance fog matching the horizon color seamlessly
        let camDist = length(in.worldPos - scene.cameraPos.xyz);
        let fogFactor = clamp(1.0 - exp(-pow(max(camDist - 35.0, 0.0) * 0.0042, 1.45)), 0.0, 1.0);
        let horizonFogColor = vec3<f32>(0.45, 0.64, 0.84);
        litColor = mix(litColor, horizonFogColor, fogFactor);

        return vec4<f32>(litColor, alpha);
      }
    `;

