import { loadGates, tickCircuitSimulation } from './gates.js';

let currentTool = null;
let isEraserMode = false;
let scale = 0.6; 
let panX = 0, panY = 0;
let isDragging = false;
let startX, startY;
let initialPinchDist = 0;
let initialScale = 1.0;
const GRID_SIZE = 128; 
let gridData = {};

let simulationIntervalId = null;
let currentSpeedMultiplier = 1;
const BASE_TICK_MS = 150; 

const viewport = document.getElementById('viewport');
const container = document.getElementById('canvas-container');
const grid = document.getElementById('grid');
const tray = document.getElementById('tray');
const trayScroller = document.getElementById('tray-scroller');

const trayToggle = document.getElementById('tray-toggle');
const eraserToggle = document.getElementById('eraser-toggle');
const exportBtn = document.getElementById('export-btn');
const importBtn = document.getElementById('import-btn');
const clearBtn = document.getElementById('clear-btn');
const speedSlider = document.getElementById('speed-slider');
const speedLabel = document.getElementById('speed-label');

if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    if (Object.keys(gridData).length === 0) {
      alert("The grid is empty! Build something first.");
      return;
    }
    
    const jsonString = JSON.stringify(gridData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `circuit_schematic_${Date.now()}.json`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  });
}

if (importBtn) {
  importBtn.addEventListener('click', () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const loadedData = JSON.parse(event.target.result);
          
          clearEntireGrid();
          Object.assign(gridData, loadedData);
          
          for (let key in gridData) {
            const [r, c] = key.split('_').map(Number);
            createCellDOM(r, c);
          }
          
          processStepTick();
          alert("JSON Schematic loaded successfully!");
        } catch (err) {
          alert("Invalid circuit JSON structural pattern.");
        }
      };
      reader.readAsText(file);
    });

    fileInput.click();
  });
}

if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    if (confirm("Clear your entire circuit layout?")) {
      clearEntireGrid();
    }
  });
}
    
grid.style.width = `${GRID_SIZE * 64}px`;
grid.style.height = `${GRID_SIZE * 64}px`;

function clearEntireGrid() {
  for (let key in gridData) {
    const cellEl = document.getElementById(`cell-${key}`);
    if (cellEl) cellEl.remove();
    delete gridData[key];
  }
  processStepTick();
}

function updateTransform() {
  container.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  viewport.style.backgroundPosition = `${panX}px ${panY}px`;
  viewport.style.backgroundSize = `${64 * scale}px ${64 * scale}px`;
}

function getPinchDistance(e) {
  if (e.touches.length < 2) return 0;
  return Math.sqrt(Math.pow(e.touches[0].clientX - e.touches[1].clientX, 2) + Math.pow(e.touches[0].clientY - e.touches[1].clientY, 2));
}

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomFactor = 1.15;
  const oldScale = scale;
  scale = e.deltaY < 0 ? Math.min(scale * zoomFactor, 2.5) : Math.max(scale / zoomFactor, 0.15);
  const rect = viewport.getBoundingClientRect();
  panX = (e.clientX - rect.left) - ((e.clientX - rect.left) - panX) * (scale / oldScale);
  panY = (e.clientY - rect.top) - ((e.clientY - rect.top) - panY) * (scale / oldScale);
  updateTransform();
}, { passive: false });

viewport.addEventListener('mousedown', (e) => {
  if (e.target.closest('#tray') || e.target.closest('#top-toolbar')) return;
  isDragging = true;
  startX = e.clientX - panX;
  startY = e.clientY - panY;
});

viewport.addEventListener('touchstart', (e) => {
  if (e.target.closest('#tray') || e.target.closest('#top-toolbar')) return;
  
  if (e.touches.length === 1) {
    isDragging = true;
    startX = e.touches[0].clientX - panX;
    startY = e.touches[0].clientY - panY;
  } else if (e.touches.length === 2) {
    e.preventDefault(); 
    isDragging = false;
    initialPinchDist = getPinchDistance(e);
    initialScale = scale;
  }
}, { passive: false });

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  panX = e.clientX - startX;
  panY = e.clientY - startY;
  updateTransform();
});

window.addEventListener('touchmove', (e) => {
  if (isDragging && e.touches.length === 1) {
    panX = e.touches[0].clientX - startX;
    panY = e.touches[0].clientY - startY;
    updateTransform();
  } else if (e.touches.length === 2) {
    e.preventDefault(); 
    const currentDist = getPinchDistance(e);
    if (initialPinchDist > 0) {
      const oldScale = scale;
      scale = Math.min(Math.max(initialScale * (currentDist / initialPinchDist), 0.15), 2.5);
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      panX = midX - (midX - panX) * (scale / oldScale);
      panY = midY - (midY - panY) * (scale / oldScale);
      updateTransform();
    }
  }
}, { passive: false });

function handleCanvasClick(clientX, clientY) {
  const rect = grid.getBoundingClientRect();
  const clickX = clientX - rect.left;
  const clickY = clientY - rect.top;
  const c = Math.floor(clickX / (64 * scale));
  const r = Math.floor(clickY / (64 * scale));

  if (c < 0 || c >= GRID_SIZE || r < 0 || r >= GRID_SIZE) return;
  const coordKey = `${r}_${c}`;

  if (isEraserMode) {
    if (gridData[coordKey]) {
      delete gridData[coordKey];
      const existingCell = document.getElementById(`cell-${coordKey}`);
      if (existingCell) existingCell.remove();
      processStepTick();
    }
    return;
  }

  if (!gridData[coordKey] && currentTool) {
    gridData[coordKey] = JSON.parse(JSON.stringify(currentTool));
    if (gridData[coordKey].id === 'oneway') {
      gridData[coordKey].dx = currentTool.dx !== undefined ? currentTool.dx : 1;
      gridData[coordKey].dy = currentTool.dy !== undefined ? currentTool.dy : 0;
    }
    if (gridData[coordKey].id === 'toggle') {
      gridData[coordKey].wasSignaled = false;
      gridData[coordKey].dx = 0;
      gridData[coordKey].dy = 0;
    }
    createCellDOM(r, c);
    processStepTick();
  }
}

window.addEventListener('mouseup', (e) => {
  if (e.target.closest('#tray') || e.target.closest('#top-toolbar')) return;
  const dragDistance = Math.sqrt(Math.pow((e.clientX - panX) - startX, 2) + Math.pow((e.clientY - panY) - startY, 2));
  isDragging = false;
  if (dragDistance < 6) {
    handleCanvasClick(e.clientX, e.clientY);
  }
});

window.addEventListener('touchend', (e) => {
  if (e.target.closest('#tray') || e.target.closest('#top-toolbar')) return;
  if (isDragging && e.touches.length === 0) {
    isDragging = false;
    const touch = e.changedTouches[0];
    const dragDistance = Math.sqrt(Math.pow((touch.clientX - panX) - startX, 2) + Math.pow((touch.clientY - panY) - startY, 2));
    if (dragDistance < 10) {
      handleCanvasClick(touch.clientX, touch.clientY);
    }
  }
  if (e.touches.length < 1) { isDragging = false; initialPinchDist = 0; }
});

function createCellDOM(r, c) {
  const coordKey = `${r}_${c}`;
  if (document.getElementById(`cell-${coordKey}`)) return;

  const cell = document.createElement('div');
  cell.classList.add('cell');
  cell.id = `cell-${coordKey}`;
  cell.style.top = `${r * 64}px`;
  cell.style.left = `${c * 64}px`;

  cell.addEventListener('click', (e) => {
    e.stopPropagation(); 
    if (isEraserMode) {
      delete gridData[coordKey];
      cell.remove();
      processStepTick();
      return;
    }

    if (gridData[coordKey]) {
      if (gridData[coordKey].id === 'switch' || gridData[coordKey].id === 'button') {
        gridData[coordKey].state = gridData[coordKey].state === 1 ? 0 : 1;
        processStepTick();
      }
      else if (gridData[coordKey].id === 'oneway') {
        const dx = gridData[coordKey].dx;
        const dy = gridData[coordKey].dy;
        gridData[coordKey].dx = -dy;
        gridData[coordKey].dy = dx;
        processStepTick();
      }
    }
  });

  grid.appendChild(cell); 
}

function renderCellVisual(cellElement, itemData) {
  cellElement.innerHTML = '';
  if (!itemData) return;

  const img = document.createElement('img');
  let filename = "";
  
  switch (itemData.id) {
    case 'switch':
      filename = itemData.state === 1 ? 'Switch_ON.png' : 'Switch_OFF.png';
      break;
    case 'button':
      filename = itemData.state === 1 ? 'Button_ON.png' : 'Button_OFF.png';
      break;
    case 'toggle':
      filename = itemData.state === 1 ? 'Memory_ON.png' : 'Memory_OFF.png';
      break;
    case 'oneway':
      filename = itemData.state === 1 ? 'OW_ON.png' : 'OW_OFF.png';
      break;
    case 'bulb':
      filename = itemData.state === 1 ? 'Bulb_ON.png' : 'Bulb_OFF.png';
      break;
    case 'conduct':
      filename = itemData.state === 1 ? 'Conduct_ON.png' : 'Conduct_OFF.png';
      break;
    case 'insulate':
      filename = 'Insulate.png';
      break;
    default:
      const gatePrefix = itemData.id.toUpperCase();
      filename = itemData.state === 1 ? `${gatePrefix}_ON.png` : `${gatePrefix}_OFF.png`;
      break;
  }

  img.src = `./assets/${filename}`;
  img.onerror = () => { 
    cellElement.style.backgroundColor = itemData.state === 1 ? '#2ecc71' : '#e74c3c'; 
  };


   if (itemData.id === 'oneway') {
    if (itemData.dx === 1 && itemData.dy === 0)   img.style.transform = 'rotate(0deg)';   
    if (itemData.dx === 0 && itemData.dy === 1)   img.style.transform = 'rotate(90deg)';  
    if (itemData.dx === -1 && itemData.dy === 0)  img.style.transform = 'rotate(180deg)'; 
    if (itemData.dx === 0 && itemData.dy === -1)  img.style.transform = 'rotate(270deg)'; 
  }

  cellElement.appendChild(img);
}

function processStepTick() {
  tickCircuitSimulation(gridData);
  for (let key in gridData) {
    const cellEl = document.getElementById(`cell-${key}`);
    if (cellEl) renderCellVisual(cellEl, gridData[key]);
  }
}

function updateSimulationInterval() {
  if (simulationIntervalId) clearInterval(simulationIntervalId);
  simulationIntervalId = setInterval(processStepTick, BASE_TICK_MS / currentSpeedMultiplier);
}

speedSlider.addEventListener('input', (e) => {
  currentSpeedMultiplier = parseInt(e.target.value);
  speedLabel.innerText = `Speed: ${currentSpeedMultiplier}x`;
  updateSimulationInterval();
});

trayToggle.addEventListener('click', () => tray.classList.toggle('open'));
eraserToggle.addEventListener('click', () => {
  isEraserMode = !isEraserMode;
  eraserToggle.classList.toggle('active', isEraserMode);
  if (isEraserMode) { currentTool = null; document.querySelectorAll('.tray-item').forEach(i => i.classList.remove('active')); }
});

async function init() {
  const gates = await loadGates();
  
  panX = (window.innerWidth - (GRID_SIZE * 64 * scale)) / 2;
  panY = (window.innerHeight - (GRID_SIZE * 64 * scale)) / 2;
  updateTransform();

    gates.forEach(gate => {
    const btn = document.createElement('div');
    btn.classList.add('tray-item');
    
    btn.style.width = '64px';
    btn.style.height = '64px';
    btn.style.backgroundSize = 'contain';
    btn.style.backgroundRepeat = 'no-repeat';
    btn.style.backgroundPosition = 'center';
    btn.style.display = 'inline-block';
    btn.style.cursor = 'pointer';

    let prefix = gate.id.toUpperCase();
    if (gate.id === 'conduct') prefix = 'Conduct';
    if (gate.id === 'insulate') prefix = 'Insulate';
    if (gate.id === 'bulb') prefix = 'Bulb';
    if (gate.id === 'switch') prefix = 'Switch';
    if (gate.id === 'button') prefix = 'Button';
    if (gate.id === 'toggle') prefix = 'Memory';
    if (gate.id === 'oneway') prefix = 'OW';
    const fileExt = gate.id === 'insulate' ? '.png' : '_OFF.png';
    
    // REPLACE YOUR OLD LINE WITH THIS EXACTLY:
    btn.style.backgroundImage = `url('assets/${prefix}${fileExt}')`;
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      isEraserMode = false;
      eraserToggle.classList.remove('active');
      document.querySelectorAll('.tray-item').forEach(i => i.classList.remove('active'));
      btn.classList.add('active');
      currentTool = gate;
    });
    trayScroller.appendChild(btn);
  });
updateSimulationInterval();
}
init();
