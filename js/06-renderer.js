"use strict";
    // ============================================================================
    // 5. WEBGPU RENDERER & INITIALIZATION
    // ============================================================================
    function showWebGPUError(detailMessage) {
      const overlay = document.getElementById('error-overlay');
      const detail  = document.getElementById('error-detail');
      if (detail) detail.textContent = detailMessage;
      if (overlay) overlay.classList.add('visible');
    }

    window.addEventListener('error', (ev) => {
      showWebGPUError(`Runtime Error: ${ev.message} (line ${ev.lineno})`);
    });

    window.addEventListener('unhandledrejection', (ev) => {
      showWebGPUError(`Unhandled Promise Rejection: ${ev.reason?.message || ev.reason}`);
    });

    async function initSkystrike() {
      // 1. Verify native WebGPU support honestly
      if (!navigator.gpu) {
        showWebGPUError('navigator.gpu is undefined in this browser.');
        return;
      }

      let adapter = null;
      try {
        adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      } catch (err) {
        showWebGPUError(`Failed to request WebGPU adapter: ${err.message}`);
        return;
      }

      if (!adapter) {
        showWebGPUError('No compatible WebGPU hardware adapter was found.');
        return;
      }

      let device = null;
      try {
        device = await adapter.requestDevice();
      } catch (err) {
        showWebGPUError(`Failed to request WebGPU device: ${err.message}`);
        return;
      }

      const canvas = document.getElementById('gpu-canvas');
      const context = canvas.getContext('webgpu');
      if (!context) {
        showWebGPUError('Failed to acquire WebGPU canvas context.');
        return;
      }

      const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
      context.configure({
        device,
        format: presentationFormat,
        alphaMode: 'opaque'
      });

      // 2. Compile WGSL Shaders & verify compilation
      const shaderModule = device.createShaderModule({
        label: 'Skystrike Unified WGSL Shader',
        code: WGSL_SHADER_CODE
      });

      if (shaderModule.getCompilationInfo) {
        const info = await shaderModule.getCompilationInfo();
        const hasError = info.messages.some(m => m.type === 'error');
        if (hasError) {
          const msg = info.messages.map(m => `${m.type} (line ${m.lineNum}): ${m.message}`).join('\n');
          showWebGPUError(`WGSL Shader compilation failed:\n${msg}`);
          return;
        }
      }

      // 3. Build all static 3D geometry ONCE and upload to reusable GPU buffers
      const staticGeo = buildAllStaticMeshes();

      const vertexBuffer = device.createBuffer({
        label: 'Static Geometry Vertex Buffer',
        size: staticGeo.vertexData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true
      });
      new Float32Array(vertexBuffer.getMappedRange()).set(staticGeo.vertexData);
      vertexBuffer.unmap();

      const indexBuffer = device.createBuffer({
        label: 'Static Geometry Index Buffer',
        size: staticGeo.indexData.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true
      });
      new Uint32Array(indexBuffer.getMappedRange()).set(staticGeo.indexData);
      indexBuffer.unmap();

      // 4. Create Uniform & Instance Storage Buffers
      const sceneUniformBuffer = device.createBuffer({
        label: 'Scene Uniform Buffer',
        size: 256,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });

      const instanceStorageBuffer = device.createBuffer({
        label: 'Instance Storage Buffer',
        size: MAX_INSTANCES * FLOATS_PER_INST * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      });

      // 5. Bind Group Layout & Bind Group
      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' }
          },
          {
            binding: 1,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: 'read-only-storage' }
          }
        ]
      });

      const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      });

      const sceneBindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: sceneUniformBuffer } },
          { binding: 1, resource: { buffer: instanceStorageBuffer } }
        ]
      });

      // 6. Render Pipelines (4x MSAA for crisp hard-surface edges, created asynchronously)
      const sampleCount = 4;

      let skyPipeline, meshPipeline, vfxPipeline;
      try {
        // Pipeline A: Fullscreen Atmospheric Sky
        skyPipeline = await device.createRenderPipelineAsync({
          label: 'Atmospheric Sky Pipeline',
          layout: pipelineLayout,
          vertex: {
            module: shaderModule,
            entryPoint: 'vs_sky'
          },
          fragment: {
            module: shaderModule,
            entryPoint: 'fs_sky',
            targets: [{ format: presentationFormat }]
          },
          primitive: {
            topology: 'triangle-list'
          },
          depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: false,
            depthCompare: 'less-equal'
          },
          multisample: { count: sampleCount }
        });

        const vertexBufferLayout = {
          arrayStride: 12 * 4, // 48 bytes per vertex
          attributes: [
            { shaderLocation: 0, offset: 0,  format: 'float32x3' }, // position
            { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
            { shaderLocation: 2, offset: 24, format: 'float32x3' }, // color
            { shaderLocation: 3, offset: 36, format: 'float32x3' }  // matProps
          ]
        };

        // Pipeline B: Opaque 3D Geometry (Aircraft, Drones, Terrain)
        meshPipeline = await device.createRenderPipelineAsync({
          label: 'Opaque 3D Mesh Pipeline',
          layout: pipelineLayout,
          vertex: {
            module: shaderModule,
            entryPoint: 'vs_main',
            buffers: [vertexBufferLayout]
          },
          fragment: {
            module: shaderModule,
            entryPoint: 'fs_main',
            targets: [{ format: presentationFormat }]
          },
          primitive: {
            topology: 'triangle-list',
            cullMode: 'none'
          },
          depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: true,
            depthCompare: 'less'
          },
          multisample: { count: sampleCount }
        });

        // Pipeline C: Additive / Emissive VFX (Afterburners, Projectiles, Muzzle Flashes, Explosions)
        vfxPipeline = await device.createRenderPipelineAsync({
          label: 'Additive VFX Pipeline',
          layout: pipelineLayout,
          vertex: {
            module: shaderModule,
            entryPoint: 'vs_main',
            buffers: [vertexBufferLayout]
          },
          fragment: {
            module: shaderModule,
            entryPoint: 'fs_main',
            targets: [{
              format: presentationFormat,
              blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
              }
            }]
          },
          primitive: {
            topology: 'triangle-list',
            cullMode: 'none'
          },
          depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: false,
            depthCompare: 'less-equal'
          },
          multisample: { count: sampleCount }
        });
      } catch (pipeErr) {
        showWebGPUError(`WebGPU RenderPipeline creation failed: ${pipeErr.message || pipeErr}`);
        return;
      }

      // 7. Canvas Resizing & MSAA / Depth Attachment Management
      let msaaColorTexture = null;
      let msaaColorView    = null;
      let depthTexture     = null;
      let depthView        = null;
      let currentTexWidth  = 0;
      let currentTexHeight = 0;
      let canvasAspect     = 16 / 9;

      function ensureRenderTargetSizes(forceWidth, forceHeight) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cssW = canvas.clientWidth || window.innerWidth || 1280;
        const cssH = canvas.clientHeight || window.innerHeight || 720;
        const width  = forceWidth  || Math.max(1, Math.floor(cssW * dpr));
        const height = forceHeight || Math.max(1, Math.floor(cssH * dpr));

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width  = width;
          canvas.height = height;
        }
        canvasAspect = width / height;

        if (currentTexWidth === width && currentTexHeight === height && depthView && msaaColorView) {
          return;
        }

        currentTexWidth  = width;
        currentTexHeight = height;

        if (msaaColorTexture) msaaColorTexture.destroy();
        if (depthTexture) depthTexture.destroy();

        msaaColorTexture = device.createTexture({
          size: [width, height, 1],
          sampleCount,
          format: presentationFormat,
          usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        msaaColorView = msaaColorTexture.createView();

        depthTexture = device.createTexture({
          size: [width, height, 1],
          sampleCount,
          format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        depthView = depthTexture.createView();
      }

      ensureRenderTargetSizes();
      window.addEventListener('resize', () => ensureRenderTargetSizes());

      // 8. WebGPU Initialization Succeeded! Reveal WEBGPU · LIVE badge
      document.getElementById('webgpu-badge')?.classList.add('active');

      // 9. Instantiate Simulation & Bind Desktop + Mobile Controls
      const sim = new SkystrikeSimulation();

      function handleKey(e, isDown) {
        const code = e.code;

        if (sim.gameOver) {
          if (isDown && !e.repeat && code === 'KeyR') sim.reset();
          return;
        }

        if (code === 'KeyA' || code === 'ArrowLeft')  { sim.keys.left    = isDown; e.preventDefault(); }
        if (code === 'KeyD' || code === 'ArrowRight') { sim.keys.right   = isDown; e.preventDefault(); }
        if (code === 'KeyW' || code === 'ArrowUp')    { sim.keys.up      = isDown; e.preventDefault(); }
        if (code === 'KeyS' || code === 'ArrowDown')  { sim.keys.down    = isDown; e.preventDefault(); }
        if (code === 'Space')                         { sim.keys.fire    = isDown; e.preventDefault(); }
        if (code === 'KeyQ')                          { sim.keys.missile = isDown; e.preventDefault(); }
        if (code === 'KeyE')                          { sim.keys.swarm   = isDown; e.preventDefault(); }

        if (isDown && !e.repeat) {
          if (code === 'KeyP' || code === 'Escape') {
            sim.togglePause();
          } else if (code === 'KeyR') {
            sim.reset();
          } else if (code === 'KeyF') {
            sim.toggleSwarmRole();
          }
        }
      }

      window.addEventListener('keydown', e => handleKey(e, true), { passive: false });
      window.addEventListener('keyup',   e => handleKey(e, false), { passive: false });
      window.addEventListener('blur', () => {
        sim.keys.left = sim.keys.right = sim.keys.up = sim.keys.down = sim.keys.fire = sim.keys.missile = sim.keys.swarm = false;
      });

      const restartMission = () => {
        sim.reset();
        resetStick();
      };

      document.getElementById('pause-btn').addEventListener('click', () => sim.togglePause());
      document.getElementById('restart-btn').addEventListener('click', restartMission);
      document.getElementById('gameover-restart-btn').addEventListener('click', restartMission);
      document.getElementById('swarm-mode-btn').addEventListener('click', () => sim.toggleSwarmRole());

      // Mobile Virtual Stick & Fire Multitouch Handlers
      const stickZone  = document.getElementById('touch-stick');
      const stickNub   = document.getElementById('touch-nub');
      const fireBtn    = document.getElementById('touch-fire');
      const missileBtn = document.getElementById('touch-missile');
      const swarmBtn   = document.getElementById('touch-swarm');
      let stickPointerId = null;

      function updateStickFromEvent(e) {
        const rect = stickZone.getBoundingClientRect();
        const cx = rect.left + rect.width * 0.5;
        const cy = rect.top + rect.height * 0.5;
        const maxR = rect.width * 0.42;

        let dx = e.clientX - cx;
        let dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > maxR) {
          dx = (dx / dist) * maxR;
          dy = (dy / dist) * maxR;
        }

        stickNub.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
        sim.touchInput.x = dx / maxR;
        sim.touchInput.y = -dy / maxR; // Up on screen = positive pitch/climb
        sim.touchInput.active = true;
      }

      function resetStick() {
        stickPointerId = null;
        stickNub.style.transform = 'translate(0px, 0px)';
        sim.touchInput.x = 0;
        sim.touchInput.y = 0;
        sim.touchInput.active = false;
      }

      stickZone.addEventListener('pointerdown', e => {
        e.preventDefault();
        stickPointerId = e.pointerId;
        stickZone.setPointerCapture(e.pointerId);
        updateStickFromEvent(e);
      });

      stickZone.addEventListener('pointermove', e => {
        if (e.pointerId === stickPointerId) {
          e.preventDefault();
          updateStickFromEvent(e);
        }
      });

      stickZone.addEventListener('pointerup', e => {
        if (e.pointerId === stickPointerId) resetStick();
      });
      stickZone.addEventListener('pointercancel', e => {
        if (e.pointerId === stickPointerId) resetStick();
      });

      fireBtn.addEventListener('pointerdown', e => {
        e.preventDefault();
        fireBtn.setPointerCapture(e.pointerId);
        sim.touchInput.fire = true;
        fireBtn.classList.add('active');
      });

      const endTouchFire = () => {
        sim.touchInput.fire = false;
        fireBtn.classList.remove('active');
      };
      fireBtn.addEventListener('pointerup', endTouchFire);
      fireBtn.addEventListener('pointercancel', endTouchFire);

      missileBtn.addEventListener('pointerdown', e => {
        e.preventDefault();
        missileBtn.setPointerCapture(e.pointerId);
        sim.touchInput.missile = true;
        missileBtn.classList.add('active');
      });

      const endTouchMissile = () => {
        sim.touchInput.missile = false;
        missileBtn.classList.remove('active');
      };
      missileBtn.addEventListener('pointerup', endTouchMissile);
      missileBtn.addEventListener('pointercancel', endTouchMissile);

      swarmBtn.addEventListener('pointerdown', e => {
        e.preventDefault();
        swarmBtn.setPointerCapture(e.pointerId);
        sim.touchInput.swarm = true;
        swarmBtn.classList.add('active');
      });

      const endTouchSwarm = () => {
        sim.touchInput.swarm = false;
        swarmBtn.classList.remove('active');
      };
      swarmBtn.addEventListener('pointerup', endTouchSwarm);
      swarmBtn.addEventListener('pointercancel', endTouchSwarm);

      const swarmModeBtn = document.getElementById('touch-swarm-mode');
      swarmModeBtn.addEventListener('pointerdown', e => {
        e.preventDefault();
        swarmModeBtn.classList.add('active');
        sim.toggleSwarmRole();
      });

      const endTouchSwarmMode = () => swarmModeBtn.classList.remove('active');
      swarmModeBtn.addEventListener('pointerup', endTouchSwarmMode);
      swarmModeBtn.addEventListener('pointercancel', endTouchSwarmMode);

      // 10. Main Fixed-Timestep Simulation & WebGPU Render Loop
      const FIXED_DT = 1.0 / 60.0;
      let accumulator = 0.0;
      let lastFrameTime = performance.now();

      const meshes = staticGeo.meshes;

      function frame(now) {
        const frameDelta = Math.min((now - lastFrameTime) * 0.001, 0.1);
        lastFrameTime = now;

        accumulator += frameDelta;
        let substeps = 0;
        while (accumulator >= FIXED_DT && substeps < 4) {
          sim.step(FIXED_DT);
          accumulator -= FIXED_DT;
          substeps++;
        }

        // Prepare matrices & instance data buffer
        ensureRenderTargetSizes();
        const currentCanvasTexture = context.getCurrentTexture();
        if (currentCanvasTexture.width !== currentTexWidth || currentCanvasTexture.height !== currentTexHeight) {
          ensureRenderTargetSizes(currentCanvasTexture.width, currentCanvasTexture.height);
        }

        const renderInfo = sim.prepareRenderData(canvasAspect);

        device.queue.writeBuffer(sceneUniformBuffer, 0, sim.sceneUniformData.buffer, 0, 256);
        if (renderInfo.totalInstances > 0) {
          device.queue.writeBuffer(
            instanceStorageBuffer,
            0,
            sim.instanceBufferData.buffer,
            0,
            renderInfo.totalInstances * FLOATS_PER_INST * 4
          );
        }

        const commandEncoder = device.createCommandEncoder();
        const canvasTextureView = currentCanvasTexture.createView();

        const renderPass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: msaaColorView,
            resolveTarget: canvasTextureView,
            clearValue: { r: 0.04, g: 0.09, b: 0.21, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store'
          }],
          depthStencilAttachment: {
            view: depthView,
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'discard'
          }
        });

        renderPass.setBindGroup(0, sceneBindGroup);

        // Pass 1: Atmospheric Sky Background
        renderPass.setPipeline(skyPipeline);
        renderPass.draw(3, 1, 0, 0);

        // Pass 2: Opaque 3D Meshes (Terrain, Fighter Jet, Recon Drones, Heavy Gunships, Missiles, Allied Swarm)
        renderPass.setPipeline(meshPipeline);
        renderPass.setVertexBuffer(0, vertexBuffer);
        renderPass.setIndexBuffer(indexBuffer, 'uint32');

        const b = renderInfo.batches;
        if (b.terrain.count > 0) {
          renderPass.drawIndexed(meshes.terrain.indexCount, b.terrain.count, meshes.terrain.firstIndex, 0, b.terrain.first);
        }
        if (b.mothership.count > 0) {
          renderPass.drawIndexed(meshes.mothership.indexCount, b.mothership.count, meshes.mothership.firstIndex, 0, b.mothership.first);
        }
        if (b.fighter.count > 0) {
          renderPass.drawIndexed(meshes.fighter.indexCount, b.fighter.count, meshes.fighter.firstIndex, 0, b.fighter.first);
        }
        if (b.drone.count > 0) {
          renderPass.drawIndexed(meshes.drone.indexCount, b.drone.count, meshes.drone.firstIndex, 0, b.drone.first);
        }
        if (b.heavyDrone.count > 0) {
          renderPass.drawIndexed(meshes.heavyDrone.indexCount, b.heavyDrone.count, meshes.heavyDrone.firstIndex, 0, b.heavyDrone.first);
        }
        if (b.shieldDrone.count > 0) {
          renderPass.drawIndexed(meshes.shieldDrone.indexCount, b.shieldDrone.count, meshes.shieldDrone.firstIndex, 0, b.shieldDrone.first);
        }
        if (b.missile.count > 0) {
          renderPass.drawIndexed(meshes.missile.indexCount, b.missile.count, meshes.missile.firstIndex, 0, b.missile.first);
        }
        if (b.swarmDrone.count > 0) {
          renderPass.drawIndexed(meshes.swarmDrone.indexCount, b.swarmDrone.count, meshes.swarmDrone.firstIndex, 0, b.swarmDrone.first);
        }

        // Pass 3: Additive / Emissive VFX (Projectiles, Afterburners, Muzzle Flashes, Explosions, Speed Lines)
        renderPass.setPipeline(vfxPipeline);
        if (b.projectile.count > 0) {
          renderPass.drawIndexed(meshes.projectile.indexCount, b.projectile.count, meshes.projectile.firstIndex, 0, b.projectile.first);
        }
        if (b.plume.count > 0) {
          renderPass.drawIndexed(meshes.plume.indexCount, b.plume.count, meshes.plume.firstIndex, 0, b.plume.first);
        }
        if (b.shard.count > 0) {
          renderPass.drawIndexed(meshes.shard.indexCount, b.shard.count, meshes.shard.firstIndex, 0, b.shard.first);
        }
        if (b.shieldPanel.count > 0) {
          renderPass.drawIndexed(meshes.shieldPanel.indexCount, b.shieldPanel.count, meshes.shieldPanel.firstIndex, 0, b.shieldPanel.first);
        }
        if (b.shieldRing.count > 0) {
          renderPass.drawIndexed(meshes.shieldRing.indexCount, b.shieldRing.count, meshes.shieldRing.firstIndex, 0, b.shieldRing.first);
        }

        renderPass.end();
        device.queue.submit([commandEncoder.finish()]);

        requestAnimationFrame(frame);
      }

      requestAnimationFrame(frame);
    }

    window.addEventListener('load', initSkystrike);
