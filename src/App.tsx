/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';

declare var cv: any;

const ROWS = 5;
const COLS = 4;

export default function App() {
  const [cvReady, setCvReady] = useState(false);
  const [status, setStatus] = useState("Loading OpenCV...");
  const [isProcessing, setIsProcessing] = useState(false);
  const [margins, setMargins] = useState({ top: 10, bottom: 10, side: 10 });
  const [detectedSteps, setDetectedSteps] = useState<number[]>(new Array(ROWS * COLS).fill(0));
  const [currentTool, setCurrentTool] = useState('memory');

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const procCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const checkCv = setInterval(() => {
      if (typeof cv !== 'undefined' && cv.Mat) {
        setCvReady(true);
        setStatus("Ready. Upload video.");
        clearInterval(checkCv);
      }
    }, 500);
    return () => clearInterval(checkCv);
  }, []);

  useEffect(() => {
    drawGridOverlay();
  }, [margins, cvReady]);

  const getDimensions = () => {
    if (!videoRef.current) return { w: 0, h: 0, startX: 0, endX: 0, startY: 0, endY: 0 };
    const w = videoRef.current.videoWidth;
    const h = videoRef.current.videoHeight;
    const topPct = margins.top / 100;
    const botPct = margins.bottom / 100;
    const sidePct = margins.side / 100;
    const startX = w * sidePct;
    const endX = w * (1 - sidePct);
    const startY = h * topPct;
    const endY = h * (1 - botPct);
    return { w, h, startX, endX, startY, endY };
  };

  const drawGridOverlay = () => {
    if (isProcessing || !videoRef.current?.videoWidth || !overlayCanvasRef.current) return;
    const d = getDimensions();
    const ctx = overlayCanvasRef.current.getContext('2d');
    if (!ctx) return;
    overlayCanvasRef.current.width = d.w;
    overlayCanvasRef.current.height = d.h;
    ctx.clearRect(0, 0, d.w, d.h);
    const boxW = (d.endX - d.startX) / COLS;
    const boxH = (d.endY - d.startY) / ROWS;
    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        let x = d.startX + (c * boxW);
        let y = d.startY + (r * boxH);
        ctx.rect(x, y, boxW, boxH);
      }
    }
    ctx.stroke();
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const url = URL.createObjectURL(e.target.files[0]);
      if (videoRef.current) {
        videoRef.current.src = url;
        videoRef.current.onloadedmetadata = () => {
          drawGridOverlay();
          setStatus("Adjust lines, then Click Start.");
        };
      }
    }
  };

  const startAnalysis = async () => {
    if (!cvReady || !videoRef.current || !procCanvasRef.current) return;
    setIsProcessing(true);
    setStatus("Processing...");
    setDetectedSteps(new Array(ROWS * COLS).fill(0));

    const d = getDimensions();
    procCanvasRef.current.width = d.w;
    procCanvasRef.current.height = d.h;
    const procCtx = procCanvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!procCtx) return;

    const boxW = (d.endX - d.startX) / COLS;
    const boxH = (d.endY - d.startY) / ROWS;
    const zones: any[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        zones.push({
          id: (r * COLS) + c,
          x: Math.floor(d.startX + (c * boxW) + (boxW * 0.1)),
          y: Math.floor(d.startY + (r * boxH) + (boxH * 0.1)),
          w: Math.floor(boxW * 0.8),
          h: Math.floor(boxH * 0.8),
          locked: false
        });
      }
    }

    let cap = new cv.VideoCapture(videoRef.current);
    let frame = new cv.Mat(d.h, d.w, cv.CV_8UC4);
    let gray = new cv.Mat();
    let prevGray = new cv.Mat();
    let diff = new cv.Mat();
    let cooldown = 0;
    let stepCount = 1;
    const interval = 1 / 15;
    let currentTime = 0;
    const duration = videoRef.current.duration;

    const loop = async () => {
      if (currentTime >= duration) {
        setStatus("Complete!");
        setIsProcessing(false);
        frame.delete(); gray.delete(); prevGray.delete(); diff.delete();
        return;
      }

      videoRef.current!.currentTime = currentTime;
      await new Promise(r => {
        const h = () => { videoRef.current!.removeEventListener('seeked', h); r(null); };
        videoRef.current!.addEventListener('seeked', h);
      });

      procCtx.drawImage(videoRef.current!, 0, 0, d.w, d.h);
      
      // Update overlay for locked zones
      const overlayCtx = overlayCanvasRef.current!.getContext('2d')!;
      overlayCtx.clearRect(0, 0, d.w, d.h);
      overlayCtx.strokeStyle = "red";
      overlayCtx.lineWidth = 2;
      zones.filter(z => z.locked).forEach(z => {
        overlayCtx.strokeRect(z.x, z.y, z.w, z.h);
        overlayCtx.fillStyle = "red";
        overlayCtx.font = "30px Arial";
        overlayCtx.fillText("Done", z.x + 10, z.y + 30);
      });

      let src = cv.imread(procCanvasRef.current!);
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      if (!prevGray.empty() && cooldown <= 0) {
        cv.absdiff(gray, prevGray, diff);
        cv.threshold(diff, diff, 45, 255, cv.THRESH_BINARY);
        let changedZones = [];
        for (let z of zones) {
          if (z.locked) continue;
          let roi = diff.roi(new cv.Rect(z.x, z.y, z.w, z.h));
          let count = cv.countNonZero(roi);
          let area = z.w * z.h;
          if (count > (area * 0.15)) {
            changedZones.push(z);
          }
          roi.delete();
        }

        if (changedZones.length > 0 && changedZones.length <= 2) {
          let z = changedZones[0];
          z.locked = true;
          setDetectedSteps(prev => {
            const next = [...prev];
            next[z.id] = stepCount;
            return next;
          });
          stepCount++;
          cooldown = 4;
        }
      }

      if (cooldown > 0) cooldown--;
      gray.copyTo(prevGray);
      src.delete();
      currentTime += interval;
      requestAnimationFrame(loop);
    };

    loop();
  };

  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const downloadKeyMapperJSON = () => {
    const d = getDimensions();
    const boxW = (d.endX - d.startX) / COLS;
    const boxH = (d.endY - d.startY) / ROWS;
    
    let steps: any[] = [];
    detectedSteps.forEach((stepNum, idx) => {
      if (stepNum > 0) {
        const r = Math.floor(idx / COLS);
        const c = idx % COLS;
        const x = Math.floor(d.startX + (c * boxW) + (boxW / 2));
        const y = Math.floor(d.startY + (r * boxH) + (boxH / 2));
        steps.push({ step: stepNum, x, y });
      }
    });

    steps.sort((a, b) => a.step - b.step);
    if (steps.length === 0) {
      alert("Please analyze the video first to find steps!");
      return;
    }

    let actionList = steps.map(s => ({
      "type": "TAP_COORDINATE",
      "data": `${s.x},${s.y}`,
      "flags": 0,
      "uid": generateUUID(),
      "extras": [
        { "id": "extra_coordinate_description", "data": `Step ${s.step}` },
        { "id": "extra_delay_before_next_action", "data": "400" }
      ]
    }));

    const keyMapperData = {
      "app_version": 63,
      "keymap_db_version": 13,
      "fingerprint_map_list": [
        { "action_list": [], "constraints": [], "constraint_mode": 1, "extras": [], "flags": 0, "id": 0, "enabled": true },
        { "action_list": [], "constraints": [], "constraint_mode": 1, "extras": [], "flags": 0, "id": 1, "enabled": true }
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
  };

  return (
    <div className="main-container">
      <div className="nav-header">
        <h2>StepByStep Analyzer</h2>
        <div className="nav-links">
          <a href="#" className={currentTool === 'memory' ? 'active' : ''} onClick={() => setCurrentTool('memory')}>Memory Pattern</a>
          <a href="#" className={currentTool === 'flip' ? 'active' : ''} onClick={() => setCurrentTool('flip')}>Same Image Flip</a>
          <a href="#" className={currentTool === 'diff' ? 'active' : ''} onClick={() => setCurrentTool('diff')}>Image Different</a>
          <a href="#" className={currentTool === 'sudoku' ? 'active' : ''} onClick={() => setCurrentTool('sudoku')}>Sudoku Solver</a>
          <a href="#" className={currentTool === 'treasure' ? 'active' : ''} onClick={() => setCurrentTool('treasure')}>Treasure Map</a>
        </div>
      </div>

      <div className="preview-wrapper">
        <video ref={videoRef} controls style={{ width: '100%' }} />
        <canvas ref={overlayCanvasRef} id="overlayCanvas" />
      </div>

      <div className="control-panel">
        <div id="status">{status}</div>
        <input type="file" id="videoInput" accept="video/*" onChange={handleVideoUpload} />
        
        <div className="slider-row">
          <div className="slider-header">
            <label>Top Margin</label>
            <span className="val-badge">{margins.top}%</span>
          </div>
          <input type="range" min="0" max="100" value={margins.top} onChange={(e) => setMargins({ ...margins, top: parseInt(e.target.value) })} />
        </div>
        <div className="slider-row">
          <div className="slider-header">
            <label>Bottom Margin</label>
            <span className="val-badge">{margins.bottom}%</span>
          </div>
          <input type="range" min="0" max="100" value={margins.bottom} onChange={(e) => setMargins({ ...margins, bottom: parseInt(e.target.value) })} />
        </div>
        <div className="slider-row">
          <div className="slider-header">
            <label>Side Margin</label>
            <span className="val-badge">{margins.side}%</span>
          </div>
          <input type="range" min="0" max="100" value={margins.side} onChange={(e) => setMargins({ ...margins, side: parseInt(e.target.value) })} />
        </div>

        <button className="action-btn" disabled={!cvReady || isProcessing} onClick={startAnalysis}>
          {isProcessing ? "Processing..." : "Start Analysis"}
        </button>
        <button className="action-btn" style={{ marginTop: '10px' }} onClick={downloadKeyMapperJSON}>
          Download KeyMapper JSON
        </button>
      </div>

      <div className="results-grid">
        {detectedSteps.map((step, i) => (
          <div key={i} className={`cell ${step > 0 ? 'detected' : ''}`}>
            {step > 0 ? step : ''}
          </div>
        ))}
      </div>
      
      <canvas ref={procCanvasRef} style={{ display: 'none' }} />
    </div>
  );
}
