const express = require('express');
const cors = require('cors');
const ytdl = require('ytdl-core');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static(path.join(__dirname)));

app.get('/api/process-youtube', async (req, res) => {
    try {
        const videoURL = req.query.url;
        if (!ytdl.validateURL(videoURL)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        const info = await ytdl.getInfo(videoURL);
        const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });

        res.header('Content-Disposition', `attachment; filename="audio.mp3"`);
        ytdl(videoURL, { format: format }).pipe(res);

    } catch (error) {
        console.error('Error processing YouTube URL:', error);
        res.status(500).json({ error: 'Failed to process video' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
