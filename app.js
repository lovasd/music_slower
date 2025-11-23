document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const fileInput = document.getElementById('audio-upload');
    const fileNameDisplay = document.getElementById('file-name');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const playIcon = document.querySelector('.play-icon');
    const pauseIcon = document.querySelector('.pause-icon');
    const youtubeUrlInput = document.getElementById('youtube-url');
    const loadYoutubeBtn = document.getElementById('load-youtube-btn');

    // Knobs
    const speedKnob = document.getElementById('speed-knob');
    const speedValue = document.getElementById('speed-value');
    const reverbKnob = document.getElementById('reverb-knob');
    const reverbValue = document.getElementById('reverb-value');

    const canvas = document.getElementById('waveform');
    const seekSlider = document.getElementById('seek-slider');
    const ctx = canvas.getContext('2d');
    const loadingOverlay = document.getElementById('loading-overlay');
    const currentTimeDisplay = document.getElementById('current-time');
    const totalDurationDisplay = document.getElementById('total-duration');

    // --- Audio Context & State ---
    let audioCtx;
    let audioBuffer = null;
    let sourceNode = null;
    let gainNode = null;
    let reverbNode = null;
    let dryNode = null;
    let wetNode = null;

    let isPlaying = false;
    let startTime = 0;
    let pausedAt = 0;
    let playbackRate = 1.0;
    let reverbAmount = 0;
    let wasPlaying = false;

    // --- Initialization ---
    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileUpload);
    playPauseBtn.addEventListener('click', togglePlayPause);
    loadYoutubeBtn.addEventListener('click', handleYoutubeLoad);

    // Knob Interactions
    setupKnob(speedKnob, 0.5, 1.5, 1.0, (val) => {
        handleSpeedChange(val);
        speedValue.textContent = val.toFixed(2) + 'x';
    });

    setupKnob(reverbKnob, 0, 1, 0, (val) => {
        handleReverbChange(val);
        reverbValue.textContent = Math.round(val * 100) + '%';
    });

    // Seek Slider Interactions
    seekSlider.addEventListener('mousedown', handleSeekStart);
    seekSlider.addEventListener('touchstart', handleSeekStart);
    seekSlider.addEventListener('input', handleSeek);
    seekSlider.addEventListener('change', handleSeekEnd);
    seekSlider.addEventListener('mouseup', handleSeekEnd);
    seekSlider.addEventListener('touchend', handleSeekEnd);

    // Resize canvas
    function resizeCanvas() {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        if (audioBuffer) drawWaveform();
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // --- File Handling ---
    async function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        initAudio();

        // Reset state
        stopAudio();
        fileNameDisplay.textContent = file.name;
        loadingOverlay.classList.remove('hidden');
        disableControls(true);

        try {
            const arrayBuffer = await file.arrayBuffer();
            audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

            // Setup Reverb Impulse
            await setupReverb();

            // Update UI
            const duration = audioBuffer.duration;
            totalDurationDisplay.textContent = formatTime(duration);

            seekSlider.max = duration;
            seekSlider.value = 0;

            drawWaveform();
            disableControls(false);
            loadingOverlay.classList.add('hidden');
        } catch (err) {
            console.error("Error loading audio:", err);
            alert("Error loading audio file. Please try another one.");
            loadingOverlay.classList.add('hidden');
        }
    }

    async function handleYoutubeLoad() {
        const url = youtubeUrlInput.value.trim();
        if (!url) return;

        initAudio();
        stopAudio();

        loadingOverlay.classList.remove('hidden');
        disableControls(true);
        fileNameDisplay.textContent = "Loading YouTube Audio...";

        try {
            const response = await fetch(`/api/process-youtube?url=${encodeURIComponent(url)}`);
            if (!response.ok) throw new Error('Failed to fetch audio');

            const arrayBuffer = await response.arrayBuffer();
            audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

            await setupReverb();

            const duration = audioBuffer.duration;
            totalDurationDisplay.textContent = formatTime(duration);

            seekSlider.max = duration;
            seekSlider.value = 0;

            drawWaveform();
            disableControls(false);
            loadingOverlay.classList.add('hidden');
            fileNameDisplay.textContent = "YouTube Audio Loaded";

        } catch (err) {
            console.error("Error loading YouTube audio:", err);
            alert("Error loading YouTube audio. Please check the URL and try again.");
            loadingOverlay.classList.add('hidden');
            fileNameDisplay.textContent = "Error loading file";
        }
    }

    // --- Audio Engine ---
    async function setupReverb() {
        // Create a simple impulse response for reverb
        const sampleRate = audioCtx.sampleRate;
        const length = sampleRate * 2.0; // 2 seconds
        const impulse = audioCtx.createBuffer(2, length, sampleRate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);

        for (let i = 0; i < length; i++) {
            const decay = Math.pow(1 - i / length, 2); // Exponential decay
            left[i] = (Math.random() * 2 - 1) * decay;
            right[i] = (Math.random() * 2 - 1) * decay;
        }

        reverbNode = audioCtx.createConvolver();
        reverbNode.buffer = impulse;

        dryNode = audioCtx.createGain();
        wetNode = audioCtx.createGain();
        gainNode = audioCtx.createGain();

        updateReverbMix();
    }

    function playAudio() {
        if (!audioBuffer) return;

        // Ensure context is running (browser policy)
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.playbackRate.value = playbackRate;

        // Routing:
        // Source -> Dry -> Output
        // Source -> Reverb -> Wet -> Output

        sourceNode.connect(dryNode);
        sourceNode.connect(reverbNode);
        reverbNode.connect(wetNode);

        dryNode.connect(gainNode);
        wetNode.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        // Calculate start time
        startTime = audioCtx.currentTime - (pausedAt / playbackRate);
        // Note: startTime is "when would the song have started to be at pausedAt right now?"
        // If we want to start AT pausedAt (seconds into buffer), we use the offset arg in start().
        // BUT, we need to track `startTime` for `getCurrentTime()` logic.
        // Logic: currentTime = (audioCtx.currentTime - startTime) * playbackRate
        // So: pausedAt = (audioCtx.currentTime - startTime) * playbackRate
        // => startTime = audioCtx.currentTime - (pausedAt / playbackRate)

        // However, sourceNode.start(when, offset) takes offset in SECONDS (buffer time).
        // We start playing NOW (when=0) from OFFSET (pausedAt).

        // Let's stick to the previous working logic or fix it properly.
        // Previous logic: startTime = audioCtx.currentTime - pausedAt; (Assuming rate=1 for calc?)
        // If rate != 1, the math gets complex if we change rate mid-stream.
        // Let's simplify:
        // We just need to know "when did we start playing this segment".

        startTime = audioCtx.currentTime;
        // We are starting playback at 'pausedAt' offset in the buffer.

        sourceNode.start(0, pausedAt);

        isPlaying = true;
        updatePlayButton();
        requestAnimationFrame(updateProgress);
    }

    function pauseAudio() {
        if (sourceNode) {
            try { sourceNode.stop(); } catch (e) { }
            sourceNode.disconnect();
            sourceNode = null;
        }
        // Save current position
        // We need to know how much time passed since we started this segment.
        const elapsedWallTime = audioCtx.currentTime - startTime;
        pausedAt += elapsedWallTime * playbackRate;

        // Clamp
        if (pausedAt > audioBuffer.duration) pausedAt = audioBuffer.duration;

        isPlaying = false;
        updatePlayButton();
    }

    function stopAudio() {
        if (sourceNode) {
            try { sourceNode.stop(); } catch (e) { }
            sourceNode.disconnect();
            sourceNode = null;
        }
        isPlaying = false;
        pausedAt = 0;
        startTime = 0;
        updatePlayButton();
        seekSlider.value = 0;
        drawWaveform();
    }

    function togglePlayPause() {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        if (isPlaying) {
            pauseAudio();
        } else {
            playAudio();
        }
    }

    // Internal pause for seeking (doesn't recalculate pausedAt, we set it manually)
    function internalPause() {
        if (sourceNode) {
            try { sourceNode.stop(); } catch (e) { }
            sourceNode.disconnect();
            sourceNode = null;
        }
        isPlaying = false;
        updatePlayButton();
    }

    function getCurrentTime() {
        if (!isPlaying) return pausedAt;
        const elapsed = audioCtx.currentTime - startTime;
        let time = pausedAt + (elapsed * playbackRate);
        if (time > audioBuffer.duration) {
            time = audioBuffer.duration;
            stopAudio();
        }
        return time;
    }

    function handleSpeedChange(val) {
        const newRate = val;

        if (isPlaying) {
            // We need to seamlessly switch rate.
            // Best way with Web Audio API is to just set the param if we don't want to restart.
            // BUT our time tracking relies on constant rate for the segment.
            // So we MUST restart the segment tracking.

            // 1. Calculate where we are NOW.
            const currentBufferTime = getCurrentTime();

            // 2. Update state to appear as if we just started playing from here.
            pausedAt = currentBufferTime;
            startTime = audioCtx.currentTime;

            // 3. Update the node immediately
            if (sourceNode) {
                sourceNode.playbackRate.setValueAtTime(newRate, audioCtx.currentTime);
            }
        }

        playbackRate = newRate;
    }

    function handleReverbChange(val) {
        reverbAmount = val;
        updateReverbMix();
    }

    function updateReverbMix() {
        if (!dryNode || !wetNode) return;
        dryNode.gain.value = 1 - reverbAmount;
        wetNode.gain.value = reverbAmount * 2;
    }

    // --- Seek Logic ---
    function handleSeekStart() {
        if (isPlaying) {
            wasPlaying = true;
            internalPause();
            // We pause audio processing but keep 'wasPlaying' true so we know to resume.
            // internalPause sets isPlaying=false, so UI updates.
        }
    }

    function handleSeek(e) {
        if (!audioBuffer) return;
        const seekTime = parseFloat(e.target.value);

        // Update state but don't play yet
        pausedAt = seekTime;

        // Update Visuals
        currentTimeDisplay.textContent = formatTime(seekTime);
        // We don't redraw waveform here as it's static, but if we had a playhead on canvas we would.
        // The slider thumb IS the playhead now.
    }

    function handleSeekEnd(e) {
        // When drag ends
        if (wasPlaying) {
            playAudio();
            wasPlaying = false;
        }
    }

    // --- Visualization ---
    function drawWaveform() {
        if (!audioBuffer) return;

        const width = canvas.width;
        const height = canvas.height;
        const data = audioBuffer.getChannelData(0);
        const step = Math.ceil(data.length / width);
        const amp = height / 2;

        ctx.clearRect(0, 0, width, height);

        ctx.beginPath();
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 2;

        for (let i = 0; i < width; i++) {
            let min = 1.0;
            let max = -1.0;

            for (let j = 0; j < step; j++) {
                const datum = data[(i * step) + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }

            ctx.moveTo(i, (1 + min) * amp);
            ctx.lineTo(i, (1 + max) * amp);
        }
        ctx.stroke();
    }

    function updateProgress() {
        if (!isPlaying) return;

        const currentPos = getCurrentTime();
        seekSlider.value = currentPos;
        currentTimeDisplay.textContent = formatTime(currentPos);

        requestAnimationFrame(updateProgress);
    }

    // --- Helpers ---
    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function updatePlayButton() {
        if (isPlaying) {
            playIcon.classList.add('hidden');
            pauseIcon.classList.remove('hidden');
        } else {
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
        }
    }

    function disableControls(disabled) {
        playPauseBtn.disabled = disabled;

        if (disabled) {
            speedKnob.classList.add('disabled');
            reverbKnob.classList.add('disabled');
            seekSlider.disabled = true;
        } else {
            speedKnob.classList.remove('disabled');
            reverbKnob.classList.remove('disabled');
            seekSlider.disabled = false;
        }
    }

    // --- Knob Logic ---
    function setupKnob(element, min, max, initialValue, onChange) {
        let currentValue = initialValue;
        let isDragging = false;
        let startY = 0;
        let startValue = 0;

        updateKnobVisual(element, currentValue, min, max);
        onChange(currentValue);

        element.addEventListener('mousedown', (e) => {
            if (element.classList.contains('disabled')) return;
            isDragging = true;
            startY = e.clientY;
            startValue = currentValue;
            document.body.style.cursor = 'ns-resize';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const deltaY = startY - e.clientY;
            const sensitivity = 0.005 * (max - min);

            let newValue = startValue + (deltaY * sensitivity);

            if (newValue < min) newValue = min;
            if (newValue > max) newValue = max;

            currentValue = newValue;
            updateKnobVisual(element, currentValue, min, max);
            onChange(currentValue);
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = 'default';
            }
        });
    }

    function updateKnobVisual(element, value, min, max) {
        const percent = (value - min) / (max - min);
        const angle = -135 + (percent * 270);

        const indicator = element.querySelector('.knob-indicator');
        indicator.style.transform = `translateX(-50%) rotate(${angle}deg)`;
    }
});
