(() => {
  const promptEl = document.getElementById('prompt');
  const styleEl = document.getElementById('style');
  const aspectEl = document.getElementById('aspect');
  const generateBtn = document.getElementById('generateBtn');
  const surpriseBtn = document.getElementById('surpriseBtn');
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const errorMsgEl = document.getElementById('errorMessage');
  const resultEl = document.getElementById('result');
  const originalPromptEl = document.getElementById('originalPrompt');
  const imgEl = document.getElementById('generatedImage');
  const newBtn = document.getElementById('newGenerationBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const apiStatus = document.getElementById('apiStatus');
  const cursorLight = document.getElementById('cursorLight');

  const setStatus = (color, text) => {
    if (!apiStatus) return;
    const icon = apiStatus.querySelector('i');
    const span = apiStatus.querySelector('span');
    icon.style.color = color;
    span.textContent = text;
  };

  async function checkApi() {
    setStatus('#999', 'Checking API status...');
    try {
      // Lightweight HEAD/OPTIONS probe isn't available because of rewrites; do a trivial POST with invalid body
      const resp = await fetch('/api/generateImage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: '' })
      });
      if (resp.status === 400 || resp.status === 405) {
        setStatus('#22c55e', 'API ready');
      } else {
        setStatus('#f59e0b', 'API reachable');
      }
    } catch (e) {
      setStatus('#ef4444', 'API unreachable');
    }
  }

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  async function generate() {
    hide(errorEl); hide(resultEl);
    show(loadingEl);
    if (generateBtn) {
      generateBtn.disabled = true;
      generateBtn.classList.add('is-loading');
    }

    const prompt = (promptEl.value || '').trim();
    const style = (styleEl && styleEl.value) || '';
    const aspectRatio = (aspectEl && aspectEl.value) || '';

    if (!prompt) {
      hide(loadingEl);
      errorMsgEl.textContent = 'Please enter a prompt.';
      show(errorEl);
      if (generateBtn) {
        generateBtn.disabled = false;
        generateBtn.classList.remove('is-loading');
      }
      return;
    }

    try {
      const resp = await fetch('/api/generateImage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, style: style || undefined, aspectRatio: aspectRatio || undefined })
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.error || `Request failed (${resp.status})`);
      }

      const { imageBase64, mimeType } = data;
      if (!imageBase64) throw new Error('No imageBase64 in response');

      imgEl.src = `data:${mimeType || 'image/png'};base64,${imageBase64}`;
      originalPromptEl.textContent = prompt;

      hide(loadingEl);
      show(resultEl);
    } catch (err) {
      hide(loadingEl);
      errorMsgEl.textContent = err.message || String(err);
      show(errorEl);
    }
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.classList.remove('is-loading');
    }
  }

  if (generateBtn) generateBtn.addEventListener('click', generate);
  if (newBtn) newBtn.addEventListener('click', () => {
    hide(resultEl);
    promptEl.focus();
  });

  if (downloadBtn) downloadBtn.addEventListener('click', () => {
    if (!imgEl || !imgEl.src) return;
    const a = document.createElement('a');
    a.href = imgEl.src;
    a.download = 'nanobanana.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  const samples = [
    'A nano-banana dessert plated like fine dining, dramatic lighting, 50mm lens, bokeh background',
    'Cartoon nano-banana superhero flying over a neon city at night, comic style, vibrant colors',
    'Minimalist poster of a nano-banana with geometric shapes, clean lines, negative space',
    'Futuristic nano-banana robot chef in a glossy kitchen, reflections, ultra-detailed',
    'Vintage still-life photo of a nano-banana on a wooden table, soft morning light, film grain'
  ];
  if (surpriseBtn) surpriseBtn.addEventListener('click', () => {
    const pick = samples[Math.floor(Math.random() * samples.length)];
    promptEl.value = pick;
    promptEl.focus();
  });

  checkApi();

  // Cursor-following light with smoothing
  try {
    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!prefersReduced && cursorLight) {
      let targetX = window.innerWidth / 2;
      let targetY = window.innerHeight / 2;
      let currentX = targetX;
      let currentY = targetY;
      let raf = null;

      const animate = () => {
        currentX += (targetX - currentX) * 0.15;
        currentY += (targetY - currentY) * 0.15;
        cursorLight.style.transform = `translate(-50%, -50%) translate3d(${currentX}px, ${currentY}px, 0)`;
        raf = requestAnimationFrame(animate);
      };

      window.addEventListener('mousemove', (e) => {
        targetX = e.clientX;
        targetY = e.clientY;
        if (!raf) raf = requestAnimationFrame(animate);
      }, { passive: true });

      // Start centered
      raf = requestAnimationFrame(animate);
    }
  } catch (_) {}
})();
