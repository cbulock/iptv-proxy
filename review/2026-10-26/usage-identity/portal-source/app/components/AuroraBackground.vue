<script setup lang="ts">
const canvas = ref<HTMLCanvasElement | null>(null);
const INTENSITY = 0.35;
const SPEED = 1.7;
const COLORS = ['145,181,104', '78,166,159', '132,113,181'];
let cleanup: (() => void) | undefined;

onMounted(() => {
  const surface = canvas.value;
  const context = surface?.getContext('2d');
  if (!surface || !context) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0;
  let height = 0;
  let time = 8;
  let previousTime = 0;
  let frame = 0;
  let ribbons: CanvasGradient[] = [];

  function glow(x: number, y: number, radius: number, color: string, alpha: number) {
    const gradient = context!.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${color},${alpha})`);
    gradient.addColorStop(0.35, `rgba(${color},${alpha * 0.5})`);
    gradient.addColorStop(1, `rgba(${color},0)`);
    context!.fillStyle = gradient;
    context!.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function draw() {
    context!.clearRect(0, 0, width, height);
    context!.globalCompositeOperation = 'lighter';
    glow(width * 0.05, height * 0.25, width * 0.65, COLORS[0]!, INTENSITY * 0.33);
    glow(width * 0.96, height * 0.64, width * 0.5, COLORS[1]!, INTENSITY * 0.3);

    for (let band = 0; band < COLORS.length; band++) {
      context!.strokeStyle = ribbons[band]!;
      context!.lineWidth = height * 0.025;
      const offset = band * 1.9;
      for (let layer = 0; layer < 20; layer++) {
        context!.beginPath();
        for (let point = 0; point <= 70; point++) {
          const progress = point / 70;
          const x = progress * width * 1.3 - width * 0.15;
          const y = height * (0.22 + band * 0.25)
            + Math.sin(progress * 5 + time * 0.13 + offset) * height * 0.17
            + Math.sin(progress * 9 - time * 0.09 + offset) * height * 0.055
            + (layer - 10) * height * 0.007;
          if (point === 0) context!.moveTo(x, y);
          else context!.lineTo(x, y);
        }
        context!.stroke();
      }
    }
    context!.globalCompositeOperation = 'source-over';
  }

  function resize() {
    width = Math.max(window.innerWidth, 1);
    height = Math.max(window.innerHeight, 1);
    // Limit the backing buffer on large/high-DPI screens without changing the paths.
    const scale = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(4_000_000 / (width * height)));
    surface!.width = Math.round(width * scale);
    surface!.height = Math.round(height * scale);
    context!.setTransform(scale, 0, 0, scale, 0, 0);
    ribbons = COLORS.map(color => {
      const gradient = context!.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, `rgba(${color},${INTENSITY * 0.036})`);
      gradient.addColorStop(0.42, `rgba(${color},${INTENSITY * 0.008})`);
      gradient.addColorStop(1, `rgba(${color},${INTENSITY * 0.043})`);
      return gradient;
    });
    draw();
  }

  function tick(now: number) {
    frame = 0;
    if (document.hidden || reducedMotion.matches) return;
    // Approximately 30 fps is enough for this slow background movement.
    if (!previousTime || now - previousTime >= 32) {
      time += Math.min((now - (previousTime || now)) / 1000, 0.08) * SPEED;
      previousTime = now;
      draw();
    }
    frame = requestAnimationFrame(tick);
  }

  function syncMotion() {
    cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
    if (document.hidden) return;
    draw();
    if (!reducedMotion.matches) frame = requestAnimationFrame(tick);
  }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', syncMotion);
  reducedMotion.addEventListener('change', syncMotion);
  cleanup = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', syncMotion);
    reducedMotion.removeEventListener('change', syncMotion);
  };
  resize();
  syncMotion();
});

onBeforeUnmount(() => cleanup?.());
</script>

<template>
  <div class="aurora-background" aria-hidden="true">
    <canvas ref="canvas" />
  </div>
</template>

<style scoped>
.aurora-background {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
.aurora-background canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.aurora-background::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 42%, #1013177a, transparent 80%);
}
</style>
