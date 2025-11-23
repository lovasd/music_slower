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

    // Knob Interactions
    setupKnob(speedKnob, 0.5, 1.5, 1.0, (val) => {
        handleSpeedChange(val);
        speedValue.textContent = val.toFixed(2) + 'x';
    });
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
