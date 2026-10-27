import { loadGates, tickCircuitSimulation } from './gates.js';

let currentTool = null;
let isEraserMode = false;
let scale = 0.6; 
let panX = 0, panY = 0;
let isDragging = false;
let startX, startY;
let initialPinchDist = 0;
let initialScale = 1.0;
const GRID_SIZE = 512; 
let gridData = {};

let simulationIntervalId = null;
let currentSpeedMultiplier = 10;
const BASE_TICK_MS = 150; 

let interactionMode = 'normal';

let isSelecting = false;
let selStartR = 0, selStartC = 0;
let selEndR = 0, selEndC = 0;
let currentSelectionBounds = null;

let isMovingSelection = false;
let moveStartR = 0, moveStartC = 0;
let moveOriginalData = null;

let copiedData = null;
let isPasting = false;
let pasteTargetR = null, pasteTargetC = null;
let pasteItemNode = null;

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
const modeBtn = document.getElementById('mode-btn');

const selectionBox = document.getElementById('selection-box');
const selectionOverlay = document.getElementById('selection-overlay');
const selectionMenu = document.getElementById('selection-menu');
const selCopyBtn = document.getElementById('sel-copy-btn');
const selCutBtn = document.getElementById('sel-cut-btn');
const selMoveBtn = document.getElementById('sel-move-btn');

const pastePreviewBox = document.getElementById('paste-preview-box');

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
            
            const cellEl = document.getElementById(`cell-${key}`);
            if (cellEl) {
              renderCellVisual(cellEl, gridData[key]);
              
              gridData[key]._lastState = gridData[key].state;
              gridData[key]._lastDx = gridData[key].dx;
              gridData[key]._lastDy = gridData[key].dy;
            }
          }
          
          processStepTick();
        } catch (err) {
          console.error(err);
        }
      };
      reader.readAsText(file);
    });

    fileInput.click();
  });
}

if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    if (Object.keys(gridData).length === 0) return;
    
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
  gridData = {};
  document.querySelectorAll('.cell').forEach(cell => cell.remove());
  clearSelection();
  cancelPaste();
  processStepTick();
}

function updateTransform() {
  container.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  viewport.style.backgroundPosition = `${panX}px ${panY}px`;
  viewport.style.backgroundSize = `${64 * scale}px ${64 * scale}px`;
  updateSelectionMenuPosition();
}

function getPinchDistance(e) {
  if (e.touches.length < 2) return 0;
  return Math.sqrt(Math.pow(e.touches[0].clientX - e.touches[1].clientX, 2) + Math.pow(e.touches[0].clientY - e.touches[1].clientY, 2));
}

function getGridCoords(clientX, clientY) {
  const rect = grid.getBoundingClientRect();
  const clickX = clientX - rect.left;
  const clickY = clientY - rect.top;
  const c = Math.floor(clickX / (64 * scale));
  const r = Math.floor(clickY / (64 * scale));
  return { r, c };
}

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomFactor = 1.15;
  const oldScale = scale;
  scale = e.deltaY < 0 ? Math.min(scale * zoomFactor, 2.5) : Math.max(scale / zoomFactor, 0.02);
  const rect = viewport.getBoundingClientRect();
  panX = (e.clientX - rect.left) - ((e.clientX - rect.left) - panX) * (scale / oldScale);
  panY = (e.clientY - rect.top) - ((e.clientY - rect.top) - panY) * (scale / oldScale);
  updateTransform();
}, { passive: false });

viewport.addEventListener('mousedown', (e) => {
  if (e.target.closest('#tray') || e.target.closest('#top-toolbar') || e.target.closest('#selection-menu')) return;
  
  if (interactionMode === 'select') {
    const { r, c } = getGridCoords(e.clientX, e.clientY);
    if (isMovingSelection && currentSelectionBounds) {
      if (r >= currentSelectionBounds.minR && r <= currentSelectionBounds.maxR &&
          c >= currentSelectionBounds.minC && c <= currentSelectionBounds.maxC) {
        isDragging = true;
        moveStartR = r;
        moveStartC = c;
        return;
      } else {
        isMovingSelection = false;
      }
    }
    
    isSelecting = true;
    selStartR = r;
    selStartC = c;
    selEndR = r;
    selEndC = c;
    clearSelectionUI();
    updateSelectionBoxUI();
  } else {
    isDragging = true;
    startX = e.clientX - panX;
    startY = e.clientY - panY;
  }
});

viewport.addEventListener('touchstart', (e) => {
  if (e.target.closest('#tray') || e.target.closest('#top-toolbar') || e.target.closest('#selection-menu')) return;
  
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    if (interactionMode === 'select') {
      const { r, c } = getGridCoords(touch.clientX, touch.clientY);
      if (isMovingSelection && currentSelectionBounds) {
        if (r >= currentSelectionBounds.minR && r <= currentSelectionBounds.maxR &&
            c >= currentSelectionBounds.minC && c <= currentSelectionBounds.maxC) {
          isDragging = true;
          moveStartR = r;
          moveStartC = c;
          return;
        } else {
          isMovingSelection = false;
        }
      }
      isSelecting = true;
      selStartR = r;
      selStartC = c;
      selEndR = r;
      selEndC = c;
      clearSelectionUI();
      updateSelectionBoxUI();
    } else {
      isDragging = true;
      startX = touch.clientX - panX;
      startY = touch.clientY - panY;
    }
  } else if (e.touches.length === 2) {
    e.preventDefault(); 
    isDragging = false;
    isSelecting = false;
    initialPinchDist = getPinchDistance(e);
    initialScale = scale;
  }
}, { passive: false });

window.addEventListener('mousemove', (e) => {
  if (isSelecting) {
    const { r, c } = getGridCoords(e.clientX, e.clientY);
    selEndR = r;
    selEndC = c;
    updateSelectionBoxUI();
    return;
  }
  
  if (isMovingSelection && isDragging) {
    const { r, c } = getGridCoords(e.clientX, e.clientY);
    const dr = r - moveStartR;
    const dc = c - moveStartC;
    if (dr !== 0 || dc !== 0) {
      applyMoveDelta(dr, dc);
      moveStartR = r;
      moveStartC = c;
    }
    return;
  }

  if (isPasting) {
    const { r, c } = getGridCoords(e.clientX, e.clientY);
    updatePastePreview(r, c);
    return;
  }

  if (!isDragging) return;
  panX = e.clientX - startX;
  panY = e.clientY - startY;
  updateTransform();
});

window.addEventListener('touchmove', (e) => {
  if (isSelecting && e.touches.length === 1) {
    const touch = e.touches[0];
    const { r, c } = getGridCoords(touch.clientX, touch.clientY);
    selEndR = r;
    selEndC = c;
    updateSelectionBoxUI();
    return;
  }

  if (isMovingSelection && isDragging && e.touches.length === 1) {
    const touch = e.touches[0];
    const { r, c } = getGridCoords(touch.clientX, touch.clientY);
    const dr = r - moveStartR;
    const dc = c - moveStartC;
    if (dr !== 0 || dc !== 0) {
      applyMoveDelta(dr, dc);
      moveStartR = r;
      moveStartC = c;
    }
    return;
  }

  if (isPasting && e.touches.length === 1) {
    const touch = e.touches[0];
    const { r, c } = getGridCoords(touch.clientX, touch.clientY);
    updatePastePreview(r, c);
    return;
  }

  if (isDragging && e.touches.length === 1) {
    panX = e.touches[0].clientX - startX;
    panY = e.touches[0].clientY - startY;
    updateTransform();
  } else if (e.touches.length === 2) {
    e.preventDefault(); 
    const currentDist = getPinchDistance(e);
    if (initialPinchDist > 0) {
      const oldScale = scale;
      scale = Math.min(Math.max(initialScale * (currentDist / initialPinchDist), 0.02), 2.5);
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      panX = midX - (midX - panX) * (scale / oldScale);
      panY = midY - (midY - panY) * (scale / oldScale);
      updateTransform();
    }
  }
}, { passive: false });

function updateSelectionBoxUI() {
  const minR = Math.max(0, Math.min(selStartR, selEndR));
  const maxR = Math.min(GRID_SIZE - 1, Math.max(selStartR, selEndR));
  const minC = Math.max(0, Math.min(selStartC, selEndC));
  const maxC = Math.min(GRID_SIZE - 1, Math.max(selStartC, selEndC));

  selectionBox.style.display = 'block';
  selectionBox.style.top = `${minR * 64}px`;
  selectionBox.style.left = `${minC * 64}px`;
  selectionBox.style.width = `${(maxC - minC + 1) * 64}px`;
  selectionBox.style.height = `${(maxR - minR + 1) * 64}px`;
}

function finalizeSelection() {
  isSelecting = false;
  const minR = Math.max(0, Math.min(selStartR, selEndR));
  const maxR = Math.min(GRID_SIZE - 1, Math.max(selStartR, selEndR));
  const minC = Math.max(0, Math.min(selStartC, selEndC));
  const maxC = Math.min(GRID_SIZE - 1, Math.max(selStartC, selEndC));

  currentSelectionBounds = { minR, maxR, minC, maxC };

  selectionBox.style.display = 'none';
  selectionOverlay.style.display = 'block';
  selectionOverlay.style.top = `${minR * 64}px`;
  selectionOverlay.style.left = `${minC * 64}px`;
  selectionOverlay.style.width = `${(maxC - minC + 1) * 64}px`;
  selectionOverlay.style.height = `${(maxR - minR + 1) * 64}px`;

  selectionMenu.style.display = 'flex';
  selectionMenu.style.position = 'fixed';
  selectionMenu.style.gap = '6px';
  selectionMenu.style.zIndex = '1001';
  updateSelectionMenuPosition();
}

function updateSelectionMenuPosition() {
  if (!currentSelectionBounds || selectionMenu.style.display === 'none') return;
  const rect = grid.getBoundingClientRect();
  const topPx = rect.top + (currentSelectionBounds.minR * 64 * scale) - 35;
  const leftPx = rect.left + (currentSelectionBounds.minC * 64 * scale);
  selectionMenu.style.top = `${Math.max(65, topPx)}px`;
  selectionMenu.style.left = `${Math.max(10, leftPx)}px`;
}

function clearSelectionUI() {
  selectionBox.style.display = 'none';
  selectionOverlay.style.display = 'none';
  selectionMenu.style.display = 'none';
}

function clearSelection() {
  currentSelectionBounds = null;
  isMovingSelection = false;
  clearSelectionUI();
}

selCopyBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentSelectionBounds) return;
  
  const { minR, maxR, minC, maxC } = currentSelectionBounds;
  copiedData = {
    height: maxR - minR + 1,
    width: maxC - minC + 1,
    items: []
  };

  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const key = `${r}_${c}`;
      if (gridData[key]) {
        copiedData.items.push({
          relR: r - minR,
          relC: c - minC,
          data: JSON.parse(JSON.stringify(gridData[key]))
        });
      }
    }
  }

  addPasteItemToTray();
  clearSelection();
});

selCutBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentSelectionBounds) return;

  const { minR, maxR, minC, maxC } = currentSelectionBounds;
  copiedData = {
    height: maxR - minR + 1,
    width: maxC - minC + 1,
    items: []
  };

  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const key = `${r}_${c}`;
      if (gridData[key]) {
        copiedData.items.push({
          relR: r - minR,
          relC: c - minC,
          data: JSON.parse(JSON.stringify(gridData[key]))
        });
        delete gridData[key];
        const el = document.getElementById(`cell-${key}`);
        if (el) el.remove();
      }
    }
  }

  addPasteItemToTray();
  clearSelection();
  processStepTick();
});

selMoveBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentSelectionBounds) return;
  isMovingSelection = true;
  selectionMenu.style.display = 'none';
});

function applyMoveDelta(dr, dc) {
  if (!currentSelectionBounds) return;
  const { minR, maxR, minC, maxC } = currentSelectionBounds;
  
  const newMinR = minR + dr;
  const newMaxR = maxR + dr;
  const newMinC = minC + dc;
  const newMaxC = maxC + dc;

  if (newMinR < 0 || newMaxR >= GRID_SIZE || newMinC < 0 || newMaxC >= GRID_SIZE) return;

  const newGridData = {};
  const movedKeys = new Set();

  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      movedKeys.add(`${r}_${c}`);
    }
  }

  for (let key in gridData) {
    if (!movedKeys.has(key)) {
      newGridData[key] = gridData[key];
    }
  }

  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const oldKey = `${r}_${c}`;
      if (gridData[oldKey]) {
        const targetR = r + dr;
        const targetC = c + dc;
        newGridData[`${targetR}_${targetC}`] = gridData[oldKey];
      }
    }
  }

  document.querySelectorAll('.cell').forEach(el => el.remove());
  gridData = newGridData;

  for (let key in gridData) {
    const [r, c] = key.split('_').map(Number);
    createCellDOM(r, c);
    const cellEl = document.getElementById(`cell-${key}`);
    if (cellEl) renderCellVisual(cellEl, gridData[key]);
  }

  currentSelectionBounds = { minR: newMinR, maxR: newMaxR, minC: newMinC, maxC: newMaxC };
  
  selectionOverlay.style.top = `${newMinR * 64}px`;
  selectionOverlay.style.left = `${newMinC * 64}px`;

  processStepTick();
}

function addPasteItemToTray() {
  if (pasteItemNode) pasteItemNode.remove();

  pasteItemNode = document.createElement('div');
  pasteItemNode.classList.add('tray-item');
  pasteItemNode.style.width = '64px';
  pasteItemNode.style.height = '64px';
  pasteItemNode.style.background = '#e67e22';
  pasteItemNode.style.color = '#fff';
  pasteItemNode.style.display = 'inline-flex';
  pasteItemNode.style.alignItems = 'center';
  pasteItemNode.style.justifyContent = 'center';
  pasteItemNode.style.fontSize = '11px';
  pasteItemNode.style.fontWeight = 'bold';
  pasteItemNode.style.cursor = 'pointer';
  pasteItemNode.style.borderRadius = '8px';
  pasteItemNode.innerText = 'PASTE';

  pasteItemNode.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!copiedData) return;
    
    isEraserMode = false;
    eraserToggle.classList.remove('active');
    document.querySelectorAll('.tray-item').forEach(i => i.classList.remove('active'));
    pasteItemNode.classList.add('active');
    
    currentTool = null;
    isPasting = true;
  });

  trayScroller.appendChild(pasteItemNode);
}

function updatePastePreview(r, c) {
  if (!copiedData || !isPasting) return;
  if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return;

  pasteTargetR = r;
  pasteTargetC = c;

  pastePreviewBox.style.display = 'block';
  pastePreviewBox.style.top = `${r * 64}px`;
  pastePreviewBox.style.left = `${c * 64}px`;
  pastePreviewBox.style.width = `${copiedData.width * 64}px`;
  pastePreviewBox.style.height = `${copiedData.height * 64}px`;
}

function cancelPaste() {
  isPasting = false;
  pasteTargetR = null;
  pasteTargetC = null;
  pastePreviewBox.style.display = 'none';
  if (pasteItemNode) pasteItemNode.classList.remove('active');
}

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

  if (isPasting) {
    if (!copiedData) return;
    copiedData.items.forEach(item => {
      const targetR = r + item.relR;
      const targetC = c + item.relC;
      if (targetR < GRID_SIZE && targetC < GRID_SIZE) {
        const key = `${targetR}_${targetC}`;
        gridData[key] = JSON.parse(JSON.stringify(item.data));
        createCellDOM(targetR, targetC);
        const cellEl = document.getElementById(`cell-${key}`);
        if (cellEl) renderCellVisual(cellEl, gridData[key]);
      }
    });
    processStepTick();
    cancelPaste();
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
  if (e.target.closest('#tray') || e.target.closest('#top-toolbar') || e.target.closest('#selection-menu')) return;
  
  if (isSelecting) {
    finalizeSelection();
    return;
  }

  if (isMovingSelection) {
    isDragging = false;
    return;
  }

  const dragDistance = Math.sqrt(Math.pow((e.clientX - panX) - startX, 2) + Math.pow((e.clientY - panY) - startY, 2));
  isDragging = false;
  if (dragDistance < 6) {
    handleCanvasClick(e.clientX, e.clientY);
  }
});

window.addEventListener('touchend', (e) => {
  if (e.target.closest('#tray') || e.target.closest('#top-toolbar') || e.target.closest('#selection-menu')) return;
  
  if (isSelecting) {
    finalizeSelection();
    return;
  }

  if (isMovingSelection) {
    isDragging = false;
    return;
  }

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
    if (interactionMode === 'select') return;

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
  if (!itemData) return;

  let img = cellElement.querySelector('img');
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

  const newSrc = `./assets/${filename}`;
  
  if (!img) {
    img = document.createElement('img');
    img.onerror = () => { 
      cellElement.style.backgroundColor = itemData.state === 1 ? '#2ecc71' : '#e74c3c'; 
    };
    cellElement.appendChild(img);
  }

  if (!img.src.endsWith(newSrc)) {
    img.src = newSrc;
  }

  if (itemData.id === 'oneway') {
    let rot = '0deg';
    if (itemData.dx === 1 && itemData.dy === 0)   rot = '0deg';   
    if (itemData.dx === 0 && itemData.dy === 1)   rot = '90deg';  
    if (itemData.dx === -1 && itemData.dy === 0)  rot = '180deg'; 
    if (itemData.dx === 0 && itemData.dy === -1)  rot = '270deg';
    
    const transformVal = `rotate(${rot})`;
    if (img.style.transform !== transformVal) {
      img.style.transform = transformVal;
    }
  } else if (img.style.transform) {
    img.style.transform = '';
  }
}

function processStepTick() {
  tickCircuitSimulation(gridData);
  
  for (let key in gridData) {
    const cell = gridData[key];
    const cellEl = document.getElementById(`cell-${key}`);
    
    if (cellEl) {
      if (cell._lastState !== cell.state || cell._lastDx !== cell.dx || cell._lastDy !== cell.dy) {
        renderCellVisual(cellEl, cell);
        cell._lastState = cell.state;
        cell._lastDx = cell.dx;
        cell._lastDy = cell.dy;
      }
    }
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
  if (isEraserMode) { 
    currentTool = null; 
    document.querySelectorAll('.tray-item').forEach(i => i.classList.remove('active')); 
  }
});

modeBtn.addEventListener('click', () => {
  if (interactionMode === 'normal') {
    interactionMode = 'select';
    modeBtn.innerHTML = 'Mode:<br>Select';
    modeBtn.classList.add('select-mode');
  } else {
    interactionMode = 'normal';
    modeBtn.innerHTML = 'Mode:<br>Normal';
    modeBtn.classList.remove('select-mode');
    clearSelection();
  }
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
    
    btn.style.backgroundImage = `url('assets/${prefix}${fileExt}')`;
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      isEraserMode = false;
      eraserToggle.classList.remove('active');
      document.querySelectorAll('.tray-item').forEach(i => i.classList.remove('active'));
      btn.classList.add('active');
      currentTool = gate;
      cancelPaste();
    });
    trayScroller.insertBefore(btn, modeBtn);
  });
  updateSimulationInterval();
}

init();
