import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Stage, Layer, Rect, Circle, Text, Line, Transformer, Label, Tag } from 'react-konva';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import randomColor from 'randomcolor';

// --- НАСТРОЙКИ ---
// Используем useMemo или объявляем вне компонента, чтобы объекты не пересоздавались
const ydoc = new Y.Doc();
const ROOM_NAME = 'project-whiteboard-v2-unique'; // Смени имя, если хочешь чистую доску
const ymap = ydoc.getMap('elements');
const USER_COLOR = randomColor();

export default function App() {
  const [elements, setElements] = useState([]);
  const [cursors, setCursors] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState('select');
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState(1);
  const [username, setUsername] = useState('');
  const [isJoined, setIsJoined] = useState(false);

  const isDrawing = useRef(false);
  const stageRef = useRef(null);
  const transformerRef = useRef(null);

  // Провайдер создаем один раз
  const provider = useMemo(() => {
    return new WebsocketProvider(
      'wss://demos.yjs.dev', // Публичный тестовый сервер (для обучения)
      ROOM_NAME,
      ydoc
    );
  }, []);

  useEffect(() => {
    // 1. Подписка на изменения элементов в Y.Map
    const updateElements = () => {
      setElements(Array.from(ymap.values()));
    };
    ymap.observe(updateElements);
    updateElements();

    // 2. Логика курсоров (Awareness)
    const awareness = provider.awareness;
    
    const updateCursors = () => {
      const states = Array.from(awareness.getStates().entries());
      const others = states
        .filter(([clientId, state]) => clientId !== awareness.clientID && state.user)
        .map(([clientId, state]) => ({ ...state.user, id: clientId }));
      setCursors(others);
    };

    awareness.on('change', updateCursors);

    // Удаление по кнопке
    const handleKeyDown = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        ymap.delete(selectedId);
        setSelectedId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      ymap.unobserve(updateElements);
      awareness.off('change', updateCursors);
    };
  }, [selectedId, provider]);

  // Трансформер (рамка выделения)
  useEffect(() => {
    if (selectedId && transformerRef.current) {
      const selectedNode = stageRef.current.findOne('.' + selectedId);
      if (selectedNode) {
        transformerRef.current.nodes([selectedNode]);
        transformerRef.current.getLayer().batchDraw();
      } else {
        transformerRef.current.nodes([]);
      }
    }
  }, [selectedId, elements]);

  const handleJoin = () => {
    if (!username.trim()) return alert("Введите имя!");
    setIsJoined(true);
    
    // Устанавливаем начальное состояние пользователя
    provider.awareness.setLocalStateField('user', { 
      name: username, 
      color: USER_COLOR, 
      x: 0, 
      y: 0 
    });
  };

  const getRelativePointerPosition = (node) => {
    const transform = node.getAbsoluteTransform().copy().invert();
    const pos = node.getStage().getPointerPosition();
    return transform.point(pos);
  };

  const handleWheel = (e) => {
    e.evt.preventDefault();
    const scaleBy = 1.1;
    const stage = stageRef.current;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    setStageScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const handleMouseDown = (e) => {
    const stage = e.target.getStage();
    if (tool === 'select' && e.target === stage) {
      setSelectedId(null);
      return;
    }
    const pos = getRelativePointerPosition(stage);
    const id = `el_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    if (tool === 'pencil') {
      isDrawing.current = id;
      ymap.set(id, {
        id, type: 'line', points: [pos.x, pos.y], color: USER_COLOR, strokeWidth: 5,
      });
    } else if (tool !== 'select') {
      const newShape = {
        id, type: tool, x: pos.x, y: pos.y, width: 100, height: 100, rotation: 0, color: USER_COLOR, text: tool === 'text' ? 'Текст' : '',
      };
      if (tool === 'text') {
        const txt = prompt("Текст:");
        if (!txt) return;
        newShape.text = txt;
        newShape.width = undefined; newShape.height = undefined;
      }
      ymap.set(id, newShape);
      setTool('select');
      setSelectedId(id);
    }
  };

  const handleMouseMove = (e) => {
    if (!isJoined) return;
    const stage = stageRef.current;
    const pos = getRelativePointerPosition(stage);
    
    // Обновляем положение курсора для других
    if(pos) {
      provider.awareness.setLocalStateField('user', { 
        name: username, color: USER_COLOR, x: pos.x, y: pos.y 
      });
    }

    if (tool === 'pencil' && isDrawing.current) {
      const id = isDrawing.current;
      const line = ymap.get(id);
      if (line) {
        ymap.set(id, { ...line, points: [...line.points, pos.x, pos.y] });
      }
    }
  };

  const handleMouseUp = () => { isDrawing.current = false; };

  const handleDragEnd = (e, id) => {
    const shape = ymap.get(id);
    if (shape) ymap.set(id, { ...shape, x: e.target.x(), y: e.target.y() });
  };

  const handleTransformEnd = (e) => {
    const node = e.target;
    const id = node.id();
    const shape = ymap.get(id);
    if (!shape) return;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1); node.scaleY(1);

    const updates = { ...shape, x: node.x(), y: node.y(), rotation: node.rotation() };
    if (shape.type === 'text') updates.fontSize = (shape.fontSize || 20) * scaleX;
    else if (shape.type === 'line') { updates.scaleX = scaleX; updates.scaleY = scaleY; }
    else { 
        updates.width = Math.max(5, node.width() * scaleX); 
        updates.height = Math.max(5, node.height() * scaleY); 
    }
    ymap.set(id, updates);
  };

  if (!isJoined) {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column', 
        alignItems: 'center', justifyContent: 'center', background: '#222', color: 'white', fontFamily: 'sans-serif'
      }}>
        <h1>🎨 Live Whiteboard</h1>
        <input 
          type="text" 
          placeholder="Ваше имя..." 
          value={username}
          onChange={e => setUsername(e.target.value)}
          style={{padding: 10, fontSize: 18, borderRadius: 5, border: 'none', marginBottom: 10}}
          onKeyDown={e => e.key === 'Enter' && handleJoin()}
        />
        <button onClick={handleJoin} style={{padding: '10px 20px', fontSize: 18, background: '#007bff', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer'}}>Войти</button>
      </div>
    );
  }

  return (
    <div style={{width: '100vw', height: '100vh', overflow: 'hidden', background: '#f0f0f0'}}>
      <div style={{ 
        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', 
        zIndex: 100, background: 'white', padding: '10px 20px', 
        borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', gap: 10
      }}>
        <button onClick={() => setTool('select')} style={{background: tool==='select'?'#ddd':'white', border:'1px solid #ccc', cursor:'pointer', padding:8, borderRadius:4}}>👆</button>
        <button onClick={() => setTool('pencil')} style={{background: tool==='pencil'?'#ddd':'white', border:'1px solid #ccc', cursor:'pointer', padding:8, borderRadius:4}}>✏️</button>
        <button onClick={() => setTool('rect')} style={{background: tool==='rect'?'#ddd':'white', border:'1px solid #ccc', cursor:'pointer', padding:8, borderRadius:4}}>⬜</button>
        <button onClick={() => setTool('circle')} style={{background: tool==='circle'?'#ddd':'white', border:'1px solid #ccc', cursor:'pointer', padding:8, borderRadius:4}}>🔵</button>
        <button onClick={() => setTool('text')} style={{background: tool==='text'?'#ddd':'white', border:'1px solid #ccc', cursor:'pointer', padding:8, borderRadius:4}}>📝</button>
      </div>
      
      <div style={{position: 'absolute', bottom: 10, left: 10, color: '#666', fontSize: 12, pointerEvents: 'none', zIndex: 10}}>
        Вы: <b>{username}</b> | Комната: {ROOM_NAME}
      </div>

      <Stage 
        width={window.innerWidth} height={window.innerHeight} ref={stageRef}
        x={stagePos.x} y={stagePos.y} scaleX={stageScale} scaleY={stageScale}
        draggable={tool === 'select'}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <Layer>
          {elements.map((el) => {
            const common = {
              key: el.id, id: el.id, name: el.id, x: el.x, y: el.y, rotation: el.rotation,
              draggable: tool === 'select',
              onClick: () => tool === 'select' && setSelectedId(el.id),
              onDragEnd: (e) => handleDragEnd(e, el.id),
              onTransformEnd: handleTransformEnd,
            };
            if (el.type === 'rect') return <Rect {...common} width={el.width} height={el.height} fill={el.color} cornerRadius={10} stroke={selectedId === el.id ? 'blue' : ''} />;
            if (el.type === 'circle') return <Circle {...common} width={el.width} height={el.height} fill={el.color} stroke={selectedId === el.id ? 'blue' : ''} />;
            if (el.type === 'text') return <Text {...common} text={el.text} fontSize={el.fontSize || 20} fill={el.color} />;
            if (el.type === 'line') return <Line {...common} points={el.points} stroke={el.color} strokeWidth={el.strokeWidth} tension={0.5} lineCap="round" lineJoin="round" />;
            return null;
          })}
          <Transformer ref={transformerRef} />
          
          {cursors.map((c) => (
             <Label key={c.id} x={c.x} y={c.y}>
               <Tag fill={c.color} pointerDirection="down" pointerWidth={10} pointerHeight={10} cornerRadius={5} />
               <Text text={c.name} padding={5} fill="white" fontSize={12} fontStyle="bold" />
             </Label>
          ))}
        </Layer>
      </Stage>
    </div>
  );
}