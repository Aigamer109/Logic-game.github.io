export async function loadGates() {
  try {
    const response = await fetch('gates.json');
    return await response.json();
  } catch (error) {
    console.error("Configuration system read failure:", error);
    return [];
  }
}

export function evaluateGate(type, inputA, inputB) {
  const a = inputA === 1;
  const b = inputB === 1;
  switch (type.toLowerCase()) {
    case 'and':  return (a && b) ? 1 : 0;
    case 'or':   return (a || b) ? 1 : 0;
    case 'xor':  return (a !== b) ? 1 : 0;
    case 'nand': return !(a && b) ? 1 : 0;
    case 'not':  return !a ? 1 : 0;
    case 'xnor': return (a === b) ? 1 : 0;
    default:     return 0;
  }
}

export function tickCircuitSimulation(gridData) {
  const nextStates = {};
  
  for (let key in gridData) {
    nextStates[key] = {
      ...gridData[key],
      incomingSignals: [],
      state: gridData[key].state
    };
  }

  const orthoDirections = [
    { dx: 1, dy: 0, from: 'left' },   
    { dx: -1, dy: 0, from: 'right' }, 
    { dx: 0, dy: 1, from: 'top' },    
    { dx: 0, dy: -1, from: 'bottom' } 
  ];

  // PASS 1: Calculate power distribution vector maps
  for (let key in gridData) {
    const [r, c] = key.split('_').map(Number);
    const cell = gridData[key];

    if ((cell.id === 'switch' || cell.id === 'button') && cell.state === 1) {
      orthoDirections.forEach(d => {
        const neighborKey = `${r + d.dy}_${c + d.dx}`;
        if (nextStates[neighborKey]) {
          nextStates[neighborKey].incomingSignals.push({ val: 1, dx: d.dx, dy: d.dy });
        }
      });
    }
    else if ((cell.id === 'conduct' || cell.id === 'toggle') && cell.state === 1) {
      let backDx = 0;
      let backDy = 0;
      
      if (cell.incomingSignals && cell.incomingSignals.length > 0) {
        backDx = -cell.incomingSignals[0].dx;
        backDy = -cell.incomingSignals[0].dy;
      }

      orthoDirections.forEach(d => {
        if (d.dx === backDx && d.dy === backDy) return; 
        const targetKey = `${r + d.dy}_${c + d.dx}`;
        if (nextStates[targetKey]) {
          nextStates[targetKey].incomingSignals.push({ val: 1, dx: d.dx, dy: d.dy });
        }
      });
    }
    else if (cell.id === 'oneway' && cell.state === 1) {
      let receivedValidSignal = false;
      if (cell.incomingSignals && cell.incomingSignals.length > 0) {
        cell.incomingSignals.forEach(sig => {
          if (sig && sig.dx === cell.dx && sig.dy === cell.dy) {
            receivedValidSignal = true;
          }
        });
      }

      if (receivedValidSignal) {
        const targetKey = `${r + cell.dy}_${c + cell.dx}`;
        if (nextStates[targetKey]) {
          nextStates[targetKey].incomingSignals.push({ val: 1, dx: cell.dx, dy: cell.dy });
        }
      }
    }
    else if (cell.type === 'gate' && cell.id !== 'oneway' && cell.state === 1) {
      const gateId = cell.id.toLowerCase();
      
      // SARGICAL CHANGE: If it is an inverting gate, bypass directional inputs and populate all 4 directions
      if (gateId === 'not' || gateId === 'nand' || gateId === 'xnor') {
        orthoDirections.forEach(d => {
          const targetKey = `${r + d.dy}_${c + d.dx}`;
          if (nextStates[targetKey]) {
            nextStates[targetKey].incomingSignals.push({ val: 1, dx: d.dx, dy: d.dy });
          }
        });
      } else {
        // Keeps your exact original logic for directional gates (AND, OR, XOR)
        const activeInputs = cell.activeInputDirections || [];
        const targetOutputs = [];

        if (activeInputs.includes('left'))   targetOutputs.push({dx: 1, dy: 0}, {dx: 1, dy: -1}, {dx: 1, dy: 1});
        if (activeInputs.includes('right'))  targetOutputs.push({dx: -1, dy: 0}, {dx: -1, dy: -1}, {dx: -1, dy: 1});
        if (activeInputs.includes('top'))    targetOutputs.push({dx: 0, dy: 1}, {dx: -1, dy: 1}, {dx: 1, dy: 1});
        if (activeInputs.includes('bottom')) targetOutputs.push({dx: 0, dy: -1}, {dx: -1, dy: -1}, {dx: 1, dy: -1});

        const uniqueOutputs = Array.from(new Set(targetOutputs.map(o => `${o.dx}_${o.dy}`)))
          .map(str => {
            const [dx, dy] = str.split('_').map(Number);
            return { dx, dy };
          });

        uniqueOutputs.forEach(d => {
          const targetKey = `${r + d.dy}_${c + d.dx}`;
          if (nextStates[targetKey]) {
            nextStates[targetKey].incomingSignals.push({ val: 1, dx: d.dx, dy: d.dy });
          }
        });
      }
    }
  }

  // PASS 2: Poll structural inputs and commit transitions
  for (let key in gridData) {
    const [r, c] = key.split('_').map(Number);
    const current = nextStates[key];

    if (current.id === 'switch') continue;

    if (current.id === 'button') {
      gridData[key].state = 0; 
      continue;
    }

    if (current.type === 'gate' && current.id !== 'oneway') {
      const activeSides = [];

      if (current.incomingSignals && current.incomingSignals.length > 0) {
        current.incomingSignals.forEach(sig => {
          if (sig.dx === 1 && sig.dy === 0) activeSides.push('left');   
          if (sig.dx === -1 && sig.dy === 0) activeSides.push('right'); 
          if (sig.dx === 0 && sig.dy === 1) activeSides.push('top');    
          if (sig.dx === 0 && sig.dy === -1) activeSides.push('bottom');
        });
      }

      gridData[key].activeInputDirections = Array.from(new Set(activeSides));

      const inputCount = gridData[key].activeInputDirections.length;
      const inputA = inputCount > 0 ? 1 : 0;
      const inputB = inputCount > 1 ? 1 : 0;

      gridData[key].state = evaluateGate(current.id, inputA, inputB);
    }
    
    if (current.id === 'conduct' || current.id === 'bulb' || current.id === 'oneway') {
      let isPowered = false;
      if (current.id === 'oneway') {
        isPowered = current.incomingSignals.some(sig => sig && sig.dx === current.dx && sig.dy === current.dy);
      } else {
        isPowered = current.incomingSignals.length > 0;
      }

      gridData[key].state = isPowered ? 1 : 0;
      gridData[key].incomingSignals = current.incomingSignals; 
    }

    if (current.id === 'toggle') {
      const activeSides = [];
      if (current.incomingSignals && current.incomingSignals.length > 0) {
        current.incomingSignals.forEach(sig => {
          if (sig.dx === 1 && sig.dy === 0) activeSides.push('left');
          if (sig.dx === -1 && sig.dy === 0) activeSides.push('right');
          if (sig.dx === 0 && sig.dy === 1) activeSides.push('top');
          if (sig.dx === 0 && sig.dy === -1) activeSides.push('bottom');
        });
      }

      const isPoweredNow = current.incomingSignals.length > 0;
      
      if (isPoweredNow && !gridData[key].wasSignaled) {
        gridData[key].state = gridData[key].state === 1 ? 0 : 1;
      }
      
      gridData[key].wasSignaled = isPoweredNow;
      gridData[key].activeInputDirections = Array.from(new Set(activeSides));

      if (isPoweredNow && current.incomingSignals.length > 0) {
        gridData[key].incomingSignals = current.incomingSignals;
      }
    }
  }

  return gridData;
}
