let cvReady = false;
const ROWS = 5;
const COLS = 4;
let zones = []; 
let currentStep = 1;
let isProcessing = false;

// Initialize Grid UI
const gridEl = document.getElementById('grid');
if (gridEl) {
    for(let i=0; i<20; i++) {
        let d = document.createElement('div');
        d.className = 'cell';
        d.id = `c-${i}`;
        gridEl.appendChild(d);
    }
}

window.onOpenCvReadyScript = function() {
    cvReady = true;
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.innerText = "Ready. Upload video.";
    const btn = document.getElementById('processBtn');
    if (btn) btn.disabled = false;
};

// Elements
const videoInput = document.getElementById('videoInput');
const videoPlayer = document.getElementById('videoPlayer');
const overlayCanvas = document.getElementById('overlayCanvas');
const overlayCtx = overlayCanvas ? overlayCanvas.getContext('2d') : null;
const procCanvas = document.getElementById('procCanvas');
const procCtx = procCanvas ? procCanvas.getContext('2d', {willReadFrequently: true}) : null;

// Sliders
const sliderTop = document.getElementById('marginTop');
const sliderBottom = document.getElementById('marginBottom');
const sliderSide = document.getElementById('marginSide');

if (sliderTop && sliderBottom && sliderSide) {
    [sliderTop, sliderBottom, sliderSide].forEach(s => {
        s.addEventListener('input', drawGridOverlay);
    });
}

if (videoInput) {
    videoInput.addEventListener('change', (e) => {
        if(e.target.files[0]) {
            const url = URL.createObjectURL(e.target.files[0]);
            videoPlayer.src = url;

            videoPlayer.onloadedmetadata = () => {
                 overlayCanvas.width = videoPlayer.videoWidth;
                 overlayCanvas.height = videoPlayer.videoHeight;
                 procCanvas.width = videoPlayer.videoWidth;
                 procCanvas.height = videoPlayer.videoHeight;
                 drawGridOverlay();
                 document.getElementById('status').innerText = "Adjust lines, then Click Start.";
            };
        }
    });
}

function getDimensions() {
    const w = videoPlayer.videoWidth;
    const h = videoPlayer.videoHeight;

    const topPct = parseInt(sliderTop.value) / 100;
    const botPct = parseInt(sliderBottom.value) / 100;
    const sidePct = parseInt(sliderSide.value) / 100;

    const startX = w * sidePct;
    const endX = w * (1 - sidePct);
    const startY = h * topPct;
    const endY = h * (1 - botPct);

    return { w, h, startX, endX, startY, endY };
}

function drawGridOverlay() {
    if(isProcessing || !videoPlayer.videoWidth || !overlayCtx) return;

    const d = getDimensions();
    overlayCtx.clearRect(0, 0, d.w, d.h);

    const boxW = (d.endX - d.startX) / COLS;
    const boxH = (d.endY - d.startY) / ROWS;

    overlayCtx.strokeStyle = "#00ff00"; 
    overlayCtx.lineWidth = 3;
    overlayCtx.beginPath();

    for(let r=0; r<ROWS; r++) {
        for(let c=0; c<COLS; c++) {
            let x = d.startX + (c * boxW);
            let y = d.startY + (r * boxH);
            overlayCtx.rect(x, y, boxW, boxH);
        }
    }
    overlayCtx.stroke();
}

const processBtn = document.getElementById('processBtn');
if (processBtn) {
    processBtn.addEventListener('click', startAnalysis);
}

async function startAnalysis() {
    if(!cvReady) return;
    isProcessing = true;

    document.getElementById('processBtn').disabled = true;

    zones = [];
    const d = getDimensions();
    const boxW = (d.endX - d.startX) / COLS;
    const boxH = (d.endY - d.startY) / ROWS;

    for(let r=0; r<ROWS; r++) {
        for(let c=0; c<COLS; c++) {
            zones.push({
                id: (r*COLS) + c,
                x: Math.floor(d.startX + (c * boxW) + (boxW * 0.1)),
                y: Math.floor(d.startY + (r * boxH) + (boxH * 0.1)),
                w: Math.floor(boxW * 0.8),
                h: Math.floor(boxH * 0.8),
                locked: false
            });
        }
    }

    let cap = new cv.VideoCapture(videoPlayer);
    let frame = new cv.Mat(d.h, d.w, cv.CV_8UC4);
    let gray = new cv.Mat();
    let prevGray = new cv.Mat();
    let diff = new cv.Mat();

    let cooldown = 0;
    currentStep = 1;

    document.querySelectorAll('.cell').forEach(c => {
        c.classList.remove('detected'); 
        c.innerHTML = '';
    });

    const interval = 1/15;
    let currentTime = 0;
    const duration = videoPlayer.duration;

    async function loop() {
        if(currentTime >= duration) {
            document.getElementById('status').innerText = "Complete!";
            isProcessing = false;
            document.getElementById('processBtn').disabled = false;
            frame.delete(); gray.delete(); prevGray.delete(); diff.delete();
            return;
        }

        videoPlayer.currentTime = currentTime;
        await new Promise(r => {
             const h = () => { videoPlayer.removeEventListener('seeked', h); r(); };
             videoPlayer.addEventListener('seeked', h);
        });

        procCtx.drawImage(videoPlayer, 0, 0, d.w, d.h);

        overlayCtx.clearRect(0, 0, d.w, d.h);
        overlayCtx.strokeStyle = "red";
        overlayCtx.lineWidth = 2;
        zones.filter(z => z.locked).forEach(z => {
             overlayCtx.strokeRect(z.x, z.y, z.w, z.h);
             overlayCtx.fillStyle = "red";
             overlayCtx.font = "30px Arial";
             overlayCtx.fillText("Done", z.x + 10, z.y + 30);
        });

        let src = cv.imread(procCanvas);
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        if(!prevGray.empty() && cooldown <= 0) {
            cv.absdiff(gray, prevGray, diff);
            cv.threshold(diff, diff, 45, 255, cv.THRESH_BINARY);

            let changedZones = [];

            zones.forEach(z => {
                if(z.locked) return;

                let roi = diff.roi(new cv.Rect(z.x, z.y, z.w, z.h));
                let count = cv.countNonZero(roi);
                let area = z.w * z.h;

                if(count > (area * 0.15)) {
                    changedZones.push(z);
                }
                roi.delete();
            });

            if(changedZones.length > 0 && changedZones.length <= 2) {
                let z = changedZones[0];
                z.locked = true;

                const cell = document.getElementById(`c-${z.id}`);
                if (cell) {
                    cell.classList.add('detected');
                    cell.innerText = currentStep;
                }

                currentStep++;
                cooldown = 4;
            }
        }

        if(cooldown > 0) cooldown--;

        gray.copyTo(prevGray);
        src.delete();
        currentTime += interval;
        requestAnimationFrame(loop);
    }

    loop();
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

window.downloadKeyMapperJSON = function() {
    let steps = [];
    zones.forEach(z => {
        if (z.locked) {
            let cell = document.getElementById(`c-${z.id}`);
            let stepNum = parseInt(cell.innerText);

            let centerX = Math.floor(z.x + (z.w / 2));
            let centerY = Math.floor(z.y + (z.h / 2));

            steps.push({ step: stepNum, x: centerX, y: centerY });
        }
    });

    steps.sort((a, b) => a.step - b.step);

    if (steps.length === 0) {
        alert("Please analyze the video first to find steps!");
        return;
    }

    let actionList = steps.map(s => {
        return {
            "type": "TAP_COORDINATE",
            "data": `${s.x},${s.y}`,
            "flags": 0,
            "uid": generateUUID(),
            "extras": [
                {
                    "id": "extra_coordinate_description",
                    "data": `Step ${s.step}`
                },
                {
                    "id": "extra_delay_before_next_action",
                    "data": "400"
                }
            ]
        };
    });

    const keyMapperData = {
        "app_version": 63,
        "keymap_db_version": 13,
        "fingerprint_map_list": [
            {"action_list":[],"constraints":[],"constraint_mode":1,"extras":[],"flags":0,"id":0,"enabled":true},
            {"action_list":[],"constraints":[],"constraint_mode":1,"extras":[],"flags":0,"id":1,"enabled":true}
        ],
        "keymap_list": [
            {
                "id": 1,
                "uid": generateUUID(),
                "isEnabled": true,
                "flags": 0,
                "constraintMode": 1,
                "constraintList": [],
                "trigger": {
                    "mode": 2, 
                    "flags": 0,
                    "extras": [],
                    "keys": [
                        {
                            "keyCode": 24, 
                            "clickType": 2,
                            "flags": 0,
                            "deviceId": "io.github.sds100.keymapper.THIS_DEVICE",
                            "uid": generateUUID()
                        }
                    ]
                },
                "actionList": actionList
            }
        ]
    };

    const blob = new Blob([JSON.stringify(keyMapperData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'KeyMapper_MemorySolve.json';
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
}
