document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const fileInput = document.getElementById('audio-upload');
    const fileNameDisplay = document.getElementById('file-name');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const playIcon = document.querySelector('.play-icon');
    const pauseIcon = document.querySelector('.pause-icon');

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

    // --- Initialization ---
    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileUpload);
    playPauseBtn.addEventListener('click', togglePlayPause);

    // Knob Interactions
    setupKnob(speedKnob, 0.5, 1.5, 1.0, (val) => {
        handleSpeedChange(val);
        speedValue.textContent = val.toFixed(2) + 'x';
    });

    setupKnob(reverbKnob, 0, 1, 0, (val) => {
        handleReverbChange(val);
        reverbValue.textContent = Math.round(val * 100) + '%';
    });

    seekSlider.addEventListener('input', handleSeek);
    seekSlider.addEventListener('change', handleSeekEnd);

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
        startTime = audioCtx.currentTime - pausedAt;
        sourceNode.start(0, pausedAt);

        isPlaying = true;
        updatePlayButton();
        requestAnimationFrame(updateProgress);
    }

    function pauseAudio() {
        if (sourceNode) {
            sourceNode.stop();
            sourceNode.disconnect();
            sourceNode = null;
        }
        // Save current position
        pausedAt = (audioCtx.currentTime - startTime) * playbackRate;

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
        drawWaveform(); // Reset cursor
    }

    function togglePlayPause() {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        if (isPlaying) {
            // Calculate where we are before stopping
            const elapsedWallTime = audioCtx.currentTime - startTime;
            pausedAt += elapsedWallTime * playbackRate;
            pauseAudio();
        } else {
            playAudio();
        }
    }

    // Override pauseAudio to be simpler, logic moved to toggle/seek
    function internalPause() {
        if (sourceNode) {
            sourceNode.stop();
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
            stopAudio(); // Auto stop at end
        }
        return time;
    }

    function handleSpeedChange(val) {
        const newRate = val;

        if (isPlaying) {
            const currentBufferTime = getCurrentTime();
            pausedAt = currentBufferTime;
            startTime = audioCtx.currentTime;

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
        // Dry: 1 - amount, Wet: amount
        dryNode.gain.value = 1 - reverbAmount;
        wetNode.gain.value = reverbAmount * 2; // Boost wet a bit as reverb can be quiet
    }

    function handleSeek(e) {
        if (!audioBuffer) return;
        const seekTime = parseFloat(e.target.value);

        if (isPlaying) {
            internalPause();
            pausedAt = seekTime;
            playAudio();
        } else {
            pausedAt = seekTime;
            drawWaveform();
        }
        currentTimeDisplay.textContent = formatTime(seekTime);
    }

    function handleSeekEnd(e) {
        // Ensure we are at the right spot
    }

    // --- Visualization ---
    function drawWaveform() {
        if (!audioBuffer) return;

        const width = canvas.width;
        const height = canvas.height;
        const data = audioBuffer.getChannelData(0); // Left channel
        const step = Math.ceil(data.length / width);
        const amp = height / 2;

        ctx.clearRect(0, 0, width, height);

        // Draw Waveform
        ctx.beginPath();
        ctx.strokeStyle = '#8b5cf6'; // Primary color
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

        // Draw Playhead - Handled by Slider now?
        // Actually, we still want to draw the playhead on the canvas OR rely on the slider thumb.
        // The slider thumb is styled to look like a playhead.
        // So we DON'T draw the rect on canvas anymore, to avoid double playheads.

        // Update Time Display
        // currentTimeDisplay.textContent = formatTime(currentPos); // Done in updateProgress
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

        // Initial visual update
        updateKnobVisual(element, currentValue, min, max);
        onChange(currentValue); // Trigger initial change for value display

        element.addEventListener('mousedown', (e) => {
            if (element.classList.contains('disabled')) return;
            isDragging = true;
            startY = e.clientY;
            startValue = currentValue;
            document.body.style.cursor = 'ns-resize';
            e.preventDefault(); // Prevent text selection
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const deltaY = startY - e.clientY; // Drag up = positive
            const sensitivity = 0.005 * (max - min); // Adjust sensitivity based on range

            let newValue = startValue + (deltaY * sensitivity);

            // Clamp
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
        // Map value to angle (-135deg to +135deg)
        const percent = (value - min) / (max - min);
        const angle = -135 + (percent * 270);

        const indicator = element.querySelector('.knob-indicator');
        indicator.style.transform = `translateX(-50%) rotate(${angle}deg)`;
    }
});
