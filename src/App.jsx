import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Stage, Layer, Rect, Circle, Text, Line, Transformer, Label, Tag } from 'react-konva';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import randomColor from 'randomcolor';

// Генерируем цвет один раз для текущей сессии
const USER_COLOR = randomColor();

export default function App() {
  // --- СОСТОЯНИЯ ---
  const [elements, setElements] = useState([]);
  const [cursors, setCursors] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState('select');
  const [username, setUsername] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [connected, setConnected] = useState(false);

  const stageRef = useRef(null);
  const transformerRef = useRef(null);
  const isDrawing = useRef(false);

  // --- ИНИЦИАЛИЗАЦИЯ YJS И ТВОЕГО СЕРВЕРА ---
  const { ymap, provider } = useMemo(() => {
    const doc = new Y.Doc();
    const map = doc.getMap('elements');
    
    // ВАЖНО: Оставьте это имя одинаковым у себя и у друга
    const ROOM_NAME = 'digicore-whiteboard-room-v1'; 

    const webrtcProvider = new WebrtcProvider(ROOM_NAME, doc, {
      signaling: [
        'wss://digicore-app.onrender.com' // ТВОЙ ЛИЧНЫЙ СЕРВЕР
      ],
      peerOpts: {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:global.relay.metered.ca:443' }
          ]
        }
      }
    });

    return { ymap: map, provider: webrtcProvider };
  }, []);

  // --- СИНХРОНИЗАЦИЯ ДАННЫХ ---
  useEffect(() => {
    // Слушаем изменения фигур
    const updateElements = () => {
      setElements(Array.from(ymap.values()));
    };
    ymap.observe(updateElements);
    updateElements();

    // Слушаем курсоры друзей
    const awareness = provider.awareness;
    const updateCursors = () => {
      const states = Array.from(awareness.getStates().entries());
      const others = states
        .filter(([clientId, state]) => clientId !== awareness.clientID && state.user)
        .map(([clientId, state]) => ({ ...state.user, id: clientId }));
      setCursors(others);
    };
    awareness.on('change', updateCursors);

    // Статус подключения
    provider.on('status', (e) => setConnected(e.connected));

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
  }, [ymap, provider, selectedId]);

  // Рамка выделения (Transformer)
  useEffect(() => {
    if (selectedId && transformerRef.current) {
      const node = stageRef.current.findOne('.' + selectedId);
      if (node) {
        transformerRef.current.nodes([node]);
      } else {
        transformerRef.current.nodes([]);
      }
      transformerRef.current.getLayer().batchDraw();
    }
  }, [selectedId, elements]);

  // --- ОБРАБОТЧИКИ СОБЫТИЙ ---
  const handleJoin = () => {
    if (!username.trim()) return alert("Введите имя!");
    setIsJoined(true);
    // Отправляем свои данные в сеть
    provider.awareness.setLocalStateField('user', { 
      name: username, color: USER_COLOR, x: 0, y: 0 
    });
  };

  const getPointerPos = (e) => {
    const stage = e.target.getStage();
    const transform = stage.getAbsoluteTransform().copy().invert();
    return transform.point(stage.getPointerPosition());
  };

  const handleMouseDown = (e) => {
    if (tool === 'select') {
      if (e.target === e.target.getStage()) setSelectedId(null);
      return;
    }

    const pos = getPointerPos(e);
    const id = `el_${Date.now()}`;

    if (tool === 'pencil') {
      isDrawing.current = id;
      ymap.set(id, { id, type: 'line', points: [pos.x, pos.y], color: USER_COLOR });
    } else {
      const shape = {
        id, type: tool, x: pos.x, y: pos.y, width: 100, height: 100, color: USER_COLOR, rotation: 0
      };
      ymap.set(id, shape);
      setTool('select');
      setSelectedId(id);
    }
  };

  const handleMouseMove = (e) => {
    if (!isJoined) return;
    const pos = getPointerPos(e);

    // Обновляем позицию своего курсора для других
    provider.awareness.setLocalStateField('user', { 
      name: username, color: USER_COLOR, x: pos.x, y: pos.y 
    });

    if (tool === 'pencil' && isDrawing.current) {
      const id = isDrawing.current;
      const line = ymap.get(id);
      if (line) {
        ymap.set(id, { ...line, points: [...line.points, pos.x, pos.y] });
      }
    }
  };

  const handleDragEnd = (e, id) => {
    const shape = ymap.get(id);
    if (shape) {
      ymap.set(id, { ...shape, x: e.target.x(), y: e.target.y() });
    }
  };

  const handleTransformEnd = (e) => {
    const node = e.target;
    const id = node.id();
    const shape = ymap.get(id);
    if (!shape) return;

    ymap.set(id, {
      ...shape,
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      width: node.width() * node.scaleX(),
      height: node.height() * node.scaleY(),
    });
    node.scaleX(1); node.scaleY(1);
  };

  // --- ИНТЕРФЕЙС ВХОДА ---
  if (!isJoined) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#121212', color: 'white', fontFamily: 'sans-serif' }}>
        <h1 style={{ marginBottom: 20 }}>🎨 Наша Доска</h1>
        <div style={{ background: '#1e1e1e', padding: 30, borderRadius: 15, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', textAlign: 'center' }}>
          <input 
            style={{ padding: 12, fontSize: 16, borderRadius: 8, border: '1px solid #333', background: '#252525', color: 'white', width: 250, marginBottom: 15 }} 
            placeholder="Введите ваше имя..." 
            value={username} 
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
          />
          <br />
          <button 
            style={{ padding: '12px 30px', fontSize: 16, borderRadius: 8, background: '#4CAF50', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold' }} 
            onClick={handleJoin}
          >
            Войти в комнату
          </button>
        </div>
      </div>
    );
  }

  // --- ОСНОВНОЙ ХОЛСТ ---
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#f5f5f5', overflow: 'hidden' }}>
      {/* ПАНЕЛЬ ИНСТРУМЕНТОВ */}
      <div style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 10, background: 'white', padding: '8px 15px', borderRadius: 12, display: 'flex', gap: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
        {['select', 'pencil', 'rect', 'circle'].map(t => (
          <button 
            key={t} 
            onClick={() => setTool(t)} 
            style={{ padding: '10px 15px', cursor: 'pointer', borderRadius: 8, border: 'none', background: tool === t ? '#4CAF50' : 'transparent', color: tool === t ? 'white' : '#333', transition: '0.2s' }}
          >
            {t === 'select' ? '👆' : t === 'pencil' ? '✏️' : t === 'rect' ? '⬜' : '⭕'}
          </button>
        ))}
      </div>

      {/* ИНДИКАТОР СЕТИ */}
      <div style={{ position: 'absolute', bottom: 20, right: 20, zIndex: 10, background: 'white', padding: '5px 12px', borderRadius: 20, fontSize: 13, boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
        {connected ? <span style={{ color: '#4CAF50' }}>● Онлайн</span> : <span style={{ color: '#f44336' }}>● Соединение...</span>}
      </div>

      <Stage 
        width={window.innerWidth} 
        height={window.innerHeight} 
        ref={stageRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => isDrawing.current = false}
        draggable={tool === 'select'}
      >
        <Layer>
          {elements.map((el) => {
            const common = {
              key: el.id, id: el.id, name: el.id, x: el.x, y: el.y, rotation: el.rotation,
              fill: el.color, draggable: tool === 'select',
              onClick: () => tool === 'select' && setSelectedId(el.id),
              onDragEnd: (e) => handleDragEnd(e, el.id),
              onTransformEnd: handleTransformEnd,
            };
            if (el.type === 'rect') return <Rect {...common} width={el.width} height={el.height} cornerRadius={8} />;
            if (el.type === 'circle') return <Circle {...common} width={el.width} height={el.height} />;
            if (el.type === 'line') return <Line key={el.id} points={el.points} stroke={el.color} strokeWidth={5} lineCap="round" lineJoin="round" tension={0.5} />;
            return null;
          })}
          
          <Transformer ref={transformerRef} />

          {/* КУРСОРЫ ДРУЗЕЙ */}
          {cursors.map((c) => (
            <Label key={c.id} x={c.x} y={c.y}>
              <Tag fill={c.color} pointerDirection="down" pointerWidth={8} pointerHeight={8} lineJoin="round" cornerRadius={4} />
              <Text text={c.name} padding={4} fill="white" fontSize={11} fontStyle="bold" />
            </Label>
          ))}
        </Layer>
      </Stage>
    </div>
  );
}