import React, { useEffect, useState, useRef } from 'react';
import { Stage, Layer, Rect, Circle, Text, Line, Transformer, Label, Tag } from 'react-konva';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import randomColor from 'randomcolor';

// --- НАСТРОЙКИ ---
const ydoc = new Y.Doc();
// Используем уникальное имя комнаты, чтобы не пересекаться с чужими тестами
const ROOM_NAME = 'project-whiteboard-final-v1'; 
const provider = new WebrtcProvider(ROOM_NAME, ydoc, {
  signaling: [
    'wss://signaling.yjs.dev', 
    'wss://y-webrtc-signaling-eu.herokuapp.com'
  ]
});
const ymap = ydoc.getMap('elements');
const USER_COLOR = randomColor();

export default function App() {
  // --- СОСТОЯНИЯ ---
  const [elements, setElements] = useState([]);
  const [cursors, setCursors] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState('select'); 
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState(1);
  
  // ЛОГИН
  const [username, setUsername] = useState('');
  const [isJoined, setIsJoined] = useState(false); // Зашел ли юзер?

  const isDrawing = useRef(false);
  const stageRef = useRef(null);
  const transformerRef = useRef(null);

  // --- ЛОГИКА ВХОДА ---
  const handleJoin = () => {
    if (!username.trim()) return alert("Введите имя!");
    setIsJoined(true);
    
    // Сразу сообщаем всем, что мы зашли
    provider.awareness.setLocalStateField('user', { 
      name: username, 
      color: USER_COLOR, 
      x: 0, 
      y: 0 
    });
  };

  // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
  const getRelativePointerPosition = (node) => {
    const transform = node.getAbsoluteTransform().copy();
    transform.invert();
    const pos = node.getStage().getPointerPosition();
    return transform.point(pos);
  };

  useEffect(() => {
    const update = () => setElements(Array.from(ymap.values()));
    ymap.observe(update);
    update();

    const awareness = provider.awareness;
    
    // Слушаем движения других
    awareness.on('change', () => {
      const states = Array.from(awareness.getStates().values());
      // Показываем только тех, у кого есть ID клиента (clientID) и это не мы
      const others = states.filter(s => s.user && s.client !== awareness.clientID && s.user.color !== USER_COLOR);
      setCursors(others);
    });

    const handleKeyDown = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        ymap.delete(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId]);

  useEffect(() => {
    if (selectedId && transformerRef.current && stageRef.current) {
      const selectedNode = stageRef.current.findOne('.' + selectedId);
      if (selectedNode) {
        transformerRef.current.nodes([selectedNode]);
        transformerRef.current.getLayer().batchDraw();
      } else {
        transformerRef.current.nodes([]);
      }
    } else {
      if (transformerRef.current) transformerRef.current.nodes([]);
    }
  }, [selectedId, elements]);

  // --- ОБРАБОТЧИКИ СОБЫТИЙ ---
  const handleWheel = (e) => {
    e.evt.preventDefault();
    const scaleBy = 1.1;
    const stage = e.target.getStage();
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
    const id = Date.now().toString();

    if (tool === 'pencil') {
      isDrawing.current = id;
      const newLine = {
        id, type: 'line', points: [pos.x, pos.y], color: USER_COLOR, strokeWidth: 5,
      };
      ymap.set(id, newLine);
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
    if (!isJoined) return; // Не шлем данные, пока не вошли

    const stage = e.target.getStage();
    const pos = getRelativePointerPosition(stage);
    
    // Обновляем свое положение и ИМЯ
    if(pos) {
      provider.awareness.setLocalStateField('user', { 
        name: username, // <-- Отправляем имя
        color: USER_COLOR, 
        x: pos.x, 
        y: pos.y 
      });
    }

    if (tool === 'pencil' && isDrawing.current) {
      const id = isDrawing.current;
      const line = ymap.get(id);
      if (line) {
        const newPoints = line.points.concat([pos.x, pos.y]);
        ymap.set(id, { ...line, points: newPoints });
      }
    }
  };

  const handleMouseUp = () => isDrawing.current = false;

  const handleDragEnd = (e, id) => {
    const shape = ymap.get(id);
    ymap.set(id, { ...shape, x: e.target.x(), y: e.target.y() });
  };

  const handleTransformEnd = (e) => {
    const node = e.target;
    const id = node.id();
    const shape = ymap.get(id);
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1); node.scaleY(1);

    const updates = { ...shape, x: node.x(), y: node.y(), rotation: node.rotation() };
    if (shape.type === 'text') updates.fontSize = (shape.fontSize || 20) * scaleX;
    else if (shape.type === 'line') { updates.scaleX = scaleX; updates.scaleY = scaleY; }
    else { updates.width = Math.max(5, node.width() * scaleX); updates.height = Math.max(5, node.height() * scaleY); }
    ymap.set(id, updates);
  };

  // --- ЭКРАН ВХОДА (Если еще не ввели ник) ---
  if (!isJoined) {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column', 
        alignItems: 'center', justifyContent: 'center', background: '#222', color: 'white'
      }}>
        <h1>🎨 Совместная доска</h1>
        <input 
          type="text" 
          placeholder="Твое имя..." 
          value={username}
          onChange={e => setUsername(e.target.value)}
          style={{padding: 10, fontSize: 18, borderRadius: 5, border: 'none', marginBottom: 10}}
          onKeyDown={e => e.key === 'Enter' && handleJoin()}
        />
        <button 
          onClick={handleJoin}
          style={{padding: '10px 20px', fontSize: 18, background: '#007bff', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer'}}
        >
          Войти
        </button>
      </div>
    );
  }

  // --- ОСНОВНОЙ ИНТЕРФЕЙС ---
  return (
    <div style={{width: '100vw', height: '100vh', overflow: 'hidden'}}>
      {/* ПАНЕЛЬ */}
      <div style={{ 
        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', 
        zIndex: 100, background: 'white', padding: '10px 20px', 
        borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', gap: 10
      }}>
        <button onClick={() => setTool('select')} style={{background: tool==='select'?'#ddd':'white', padding:8, borderRadius:4}}>👆</button>
        <button onClick={() => setTool('pencil')} style={{background: tool==='pencil'?'#ddd':'white', padding:8, borderRadius:4}}>✏️</button>
        <button onClick={() => setTool('rect')} style={{background: tool==='rect'?'#ddd':'white', padding:8, borderRadius:4}}>⬜</button>
        <button onClick={() => setTool('circle')} style={{background: tool==='circle'?'#ddd':'white', padding:8, borderRadius:4}}>🔵</button>
        <button onClick={() => setTool('text')} style={{background: tool==='text'?'#ddd':'white', padding:8, borderRadius:4}}>📝</button>
      </div>
      
      <div style={{position: 'absolute', bottom: 10, left: 10, color: '#aaa', fontSize: 12, pointerEvents: 'none'}}>
        Ты: <b>{username}</b>
      </div>

      <Stage 
        width={window.innerWidth} height={window.innerHeight} ref={stageRef}
        x={stagePos.x} y={stagePos.y} scaleX={stageScale} scaleY={stageScale}
        draggable={tool === 'select'}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown} onTouchMove={handleMouseMove} onTouchEnd={handleMouseUp}
      >
        <Layer>
          {elements.map((el) => {
            const common = {
              key: el.id, id: el.id, name: el.id, x: el.x, y: el.y, rotation: el.rotation,
              draggable: tool === 'select',
              onClick: () => tool === 'select' && setSelectedId(el.id),
              onTap: () => tool === 'select' && setSelectedId(el.id),
              onDragEnd: (e) => handleDragEnd(e, el.id),
              onTransformEnd: handleTransformEnd,
            };
            if (el.type === 'rect') return <Rect {...common} width={el.width} height={el.height} fill={el.color} cornerRadius={10} />;
            if (el.type === 'circle') return <Circle {...common} width={el.width} height={el.height} fill={el.color} />;
            if (el.type === 'text') return <Text {...common} text={el.text} fontSize={el.fontSize || 20} fill={el.color} />;
            if (el.type === 'line') return <Line {...common} points={el.points} stroke={el.color} strokeWidth={el.strokeWidth} tension={0.5} lineCap="round" x={el.x||0} y={el.y||0} scaleX={el.scaleX||1} scaleY={el.scaleY||1} />;
            return null;
          })}
          <Transformer ref={transformerRef} />
          
          {/* КУРСОРЫ ДРУЗЕЙ С ИМЕНАМИ */}
          {cursors.map((c, i) => (
             <Label key={i} x={c.user.x} y={c.user.y}>
               <Tag fill={c.user.color} pointerDirection="down" pointerWidth={10} pointerHeight={10} lineJoin="round" cornerRadius={5} />
               <Text text={c.user.name || 'Анон'} padding={5} fill="white" fontSize={12} fontStyle="bold" />
             </Label>
          ))}
        </Layer>
      </Stage>
    </div>
  );
}