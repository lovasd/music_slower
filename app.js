document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const fileInput = document.getElementById('audio-upload');
    const fileNameDisplay = document.getElementById('file-name');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const playIcon = document.querySelector('.play-icon');
    const pauseIcon = document.querySelector('.pause-icon');
    const speedSlider = document.getElementById('speed-slider');
    const speedValue = document.getElementById('speed-value');
    const reverbSlider = document.getElementById('reverb-slider');
    const reverbValue = document.getElementById('reverb-value');
    const canvas = document.getElementById('waveform');
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
    speedSlider.addEventListener('input', handleSpeedChange);
    reverbSlider.addEventListener('input', handleReverbChange);
    canvas.addEventListener('click', handleScrub);
    
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
        pausedAt = (audioCtx.currentTime - startTime) * playbackRate; // Adjust for speed? No, currentTime is real time.
        // Actually, if playbackRate changes, simple subtraction doesn't work perfectly for seeking if rate varied. 
        // But for simple pause/resume with constant rate, we need to track "audio time".
        // Let's rely on a more robust tracking if we change speed mid-stream.
        // For now, let's assume pausedAt is "offset in buffer".
        
        // Correct calculation:
        // We played for (audioCtx.currentTime - startTime) seconds of WALL clock time.
        // Audio advanced by (wall_time * playbackRate).
        // BUT, if we change rate while playing, this breaks.
        // Ideally we just restart from the last known position.
        // Let's simplify: When changing speed, we don't restart, we just update the param.
        // When pausing, we calculate where we are.
        
        // However, sourceNode.playbackRate is a k-rate param.
        // Let's recalculate pausedAt based on elapsed time * current rate? 
        // No, that's only if rate was constant.
        
        // Better approach for accurate seeking/pausing with variable speed:
        // We can't easily query "current buffer position" from a BufferSource.
        // We have to track it.
        // Let's just use the simple approximation for now, assuming rate doesn't change wildly every frame.
        // Actually, if we change rate, we should update startTime so the math holds.
        // See handleSpeedChange.
        
        isPlaying = false;
        updatePlayButton();
    }
    
    function stopAudio() {
        if (sourceNode) {
            try { sourceNode.stop(); } catch(e){}
            sourceNode.disconnect();
            sourceNode = null;
        }
        isPlaying = false;
        pausedAt = 0;
        startTime = 0;
        updatePlayButton();
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
            // We already updated pausedAt above, but pauseAudio logic was slightly different.
            // Let's fix pauseAudio to NOT recalculate if we do it here, or unify.
            // Let's make pauseAudio just stop.
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

    // Redefine play/pause logic to be robust
    // We track `pausedAt` as the offset in the buffer (seconds).
    // `startTime` is the audioCtx.currentTime when we hit play.
    
    // When playing: currentOffset = pausedAt + (audioCtx.currentTime - startTime) * playbackRate
    
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

    function handleSpeedChange(e) {
        const newRate = parseFloat(e.target.value);
        
        if (isPlaying) {
            // We need to adjust startTime so that the jump in time doesn't happen.
            // Current position shouldn't change.
            const currentBufferTime = getCurrentTime();
            
            // Reset anchor
            pausedAt = currentBufferTime;
            startTime = audioCtx.currentTime;
            
            if (sourceNode) {
                sourceNode.playbackRate.setValueAtTime(newRate, audioCtx.currentTime);
            }
        }
        
        playbackRate = newRate;
        speedValue.textContent = newRate.toFixed(2) + 'x';
    }

    function handleReverbChange(e) {
        reverbAmount = parseFloat(e.target.value);
        reverbValue.textContent = Math.round(reverbAmount * 100) + '%';
        updateReverbMix();
    }

    function updateReverbMix() {
        if (!dryNode || !wetNode) return;
        // Equal power crossfade or linear? Linear is fine for simple wet/dry.
        // Dry: 1 - amount, Wet: amount
        dryNode.gain.value = 1 - reverbAmount;
        wetNode.gain.value = reverbAmount * 2; // Boost wet a bit as reverb can be quiet
    }

    function handleScrub(e) {
        if (!audioBuffer) return;
        
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;
        const clickPercent = x / width;
        
        const seekTime = clickPercent * audioBuffer.duration;
        
        if (isPlaying) {
            internalPause();
            pausedAt = seekTime;
            playAudio();
        } else {
            pausedAt = seekTime;
            drawWaveform(); // Update cursor
        }
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

        // Draw Playhead
        const currentPos = getCurrentTime();
        const percent = currentPos / audioBuffer.duration;
        const x = percent * width;

        ctx.fillStyle = '#fff';
        ctx.fillRect(x, 0, 2, height);
        
        // Update Time Display
        currentTimeDisplay.textContent = formatTime(currentPos);
    }

    function updateProgress() {
        if (!isPlaying) return;
        drawWaveform();
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
        speedSlider.disabled = disabled;
        reverbSlider.disabled = disabled;
    }
});
